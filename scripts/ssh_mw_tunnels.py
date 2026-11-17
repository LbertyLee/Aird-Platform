#!/usr/bin/env python3
"""Keep SSH tunnels to production middleware open for local API dev.

Forwards localhost ports to Docker bridge IPs on the deploy host:
  5432  -> postgres
  6379  -> redis
  19530 -> milvus

Config: deploy/.env.deploy (same as deploy/deploy-to-server.py) or DEPLOY_* env vars.
"""

from __future__ import annotations

import os
import socket
import sys
import threading
import time
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("Missing dependency: pip install paramiko")
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_DIR = ROOT / "deploy"

LOCAL_FORWARDS: tuple[tuple[int, str, int], ...] = (
    (5432, "postgres", 5432),
    (6379, "redis", 6379),
    (19530, "milvus", 19530),
)


def emit(text: str) -> None:
    sys.stdout.buffer.write(text.encode("utf-8", "replace") + b"\n")
    sys.stdout.flush()


def load_dotenv_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def load_config() -> dict[str, str]:
    file_cfg = load_dotenv_file(DEPLOY_DIR / ".env.deploy")
    cfg = {
        "host": file_cfg.get("DEPLOY_HOST", "124.221.222.3"),
        "user": file_cfg.get("DEPLOY_USER", "ubuntu"),
        "password": file_cfg.get("DEPLOY_PASSWORD", ""),
        "remote_app": file_cfg.get(
            "DEPLOY_REMOTE_APP", "/home/ubuntu/Aird-Platform"
        ),
    }
    cfg["host"] = os.environ.get("DEPLOY_HOST", cfg["host"])
    cfg["user"] = os.environ.get("DEPLOY_USER", cfg["user"])
    cfg["password"] = os.environ.get("DEPLOY_PASSWORD", cfg["password"])
    cfg["remote_app"] = os.environ.get("DEPLOY_REMOTE_APP", cfg["remote_app"])
    if not cfg["password"]:
        emit(
            "Error: DEPLOY_PASSWORD not set. Copy deploy/server.deploy.example "
            "to deploy/.env.deploy and fill SSH credentials."
        )
        raise SystemExit(1)
    return cfg


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 60) -> tuple[int, str]:
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, (out + err).strip()


def resolve_container_ips(
    client: paramiko.SSHClient, remote_app: str
) -> dict[str, str]:
    """Map compose service name -> bridge IP on the deploy host."""
    script = (
        f"set -e; cd {remote_app}/deploy; "
        "for svc in postgres redis milvus; do "
        'cid=$(docker compose --env-file .env ps -q "$svc" 2>/dev/null | head -1); '
        'if [ -z "$cid" ]; then echo "missing:$svc" >&2; exit 2; fi; '
        'ip=$(docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}" "$cid"); '
        'echo "$svc=$ip"; '
        "done"
    )
    code, output = run(client, f"bash -lc {script!r}", timeout=90)
    if code != 0:
        emit(f"Failed to resolve container IPs (exit {code}):\n{output}")
        raise SystemExit(1)
    ips: dict[str, str] = {}
    for line in output.splitlines():
        if "=" not in line:
            continue
        svc, ip = line.split("=", 1)
        ips[svc.strip()] = ip.strip()
    for svc in ("postgres", "redis", "milvus"):
        if svc not in ips or not ips[svc]:
            emit(f"Missing IP for service {svc!r}")
            raise SystemExit(1)
    return ips


def forward(
    local_sock: socket.socket,
    transport: paramiko.Transport,
    remote_host: str,
    remote_port: int,
) -> None:
    try:
        chan = transport.open_channel(
            "direct-tcpip",
            (remote_host, remote_port),
            local_sock.getpeername(),
        )
    except Exception as exc:  # noqa: BLE001
        emit(f"[tunnel] open_channel failed {remote_host}:{remote_port}: {exc}")
        local_sock.close()
        return

    def pump(src, dst) -> None:
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
        except Exception:
            pass
        finally:
            for obj in (src, dst):
                try:
                    obj.close()
                except Exception:
                    pass

    threading.Thread(target=pump, args=(local_sock, chan), daemon=True).start()
    threading.Thread(target=pump, args=(chan, local_sock), daemon=True).start()


def listen(
    local_port: int,
    remote_host: str,
    remote_port: int,
    transport: paramiko.Transport,
) -> None:
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", local_port))
    srv.listen(32)
    emit(f"[tunnel] 127.0.0.1:{local_port} -> {remote_host}:{remote_port}")
    while True:
        client, _ = srv.accept()
        threading.Thread(
            target=forward,
            args=(client, transport, remote_host, remote_port),
            daemon=True,
        ).start()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    cfg = load_config()

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    emit(f"[tunnel] connecting {cfg['user']}@{cfg['host']} ...")
    client.connect(
        cfg["host"],
        username=cfg["user"],
        password=cfg["password"],
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    transport = client.get_transport()
    if transport is None:
        emit("[tunnel] no transport")
        return 1
    transport.set_keepalive(30)

    ips = resolve_container_ips(client, cfg["remote_app"])
    emit(f"[tunnel] remote IPs: {ips}")

    for local_port, service, remote_port in LOCAL_FORWARDS:
        remote_host = ips[service]
        threading.Thread(
            target=listen,
            args=(local_port, remote_host, remote_port, transport),
            daemon=True,
        ).start()

    emit("[tunnel] ready (Ctrl+C to stop)")
    try:
        while True:
            if not transport.is_active():
                emit("[tunnel] transport dead")
                return 1
            time.sleep(2)
    except KeyboardInterrupt:
        emit("[tunnel] stopped")
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
