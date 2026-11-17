#!/usr/bin/env python3
"""一键部署 Aird-Platform 到远程服务器（同步代码 → 构建 → 启动 → 健康检查）。

用法（在项目根目录）：
  python deploy/deploy-to-server.py
  python deploy/deploy-to-server.py --services api
  python deploy/deploy-to-server.py --services api,admin,web --prune

依赖：pip install paramiko
配置：复制 deploy/server.deploy.example 为 deploy/.env.deploy 并填写 SSH 信息。
应用环境变量使用 deploy/.env（需已配置好数据库/Redis 等）。
"""

from __future__ import annotations

import argparse
import io
import sys
import tarfile
import time
from pathlib import Path

try:
    import paramiko
except ImportError:
    print("缺少依赖：请先执行  pip install paramiko")
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_DIR = ROOT / "deploy"
DEFAULT_SERVICES = ("api", "admin", "web")

EXCLUDE_DIR_NAMES = {
    "node_modules",
    ".git",
    ".pnpm-store",
    ".turbo",
    "dist",
    "coverage",
    ".codex-runtime",
    ".runlogs",
    ".tmp-stash-ref",
    "agent-transcripts",
    ".cursor",
    ".claude",
    ".agents",
}
EXCLUDE_FILE_SUFFIXES = {".log"}


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
        "remote_log": file_cfg.get(
            "DEPLOY_REMOTE_LOG",
            "/home/ubuntu/Aird-Platform/logs/deploy-latest.log",
        ),
        "api_host_port": file_cfg.get("API_HOST_PORT", "13000"),
        "admin_host_port": file_cfg.get("ADMIN_HOST_PORT", "13001"),
        "web_host_port": file_cfg.get("WEB_HOST_PORT", "13002"),
    }
    # 环境变量优先
    import os

    cfg["host"] = os.environ.get("DEPLOY_HOST", cfg["host"])
    cfg["user"] = os.environ.get("DEPLOY_USER", cfg["user"])
    cfg["password"] = os.environ.get("DEPLOY_PASSWORD", cfg["password"])
    cfg["remote_app"] = os.environ.get("DEPLOY_REMOTE_APP", cfg["remote_app"])
    cfg["remote_log"] = os.environ.get("DEPLOY_REMOTE_LOG", cfg["remote_log"])
    cfg["api_host_port"] = os.environ.get("API_HOST_PORT", cfg["api_host_port"])
    cfg["admin_host_port"] = os.environ.get("ADMIN_HOST_PORT", cfg["admin_host_port"])
    cfg["web_host_port"] = os.environ.get("WEB_HOST_PORT", cfg["web_host_port"])
    if not cfg["password"]:
        emit(
            "错误：未配置 DEPLOY_PASSWORD。"
            "请复制 deploy/server.deploy.example 为 deploy/.env.deploy 并填写密码。"
        )
        raise SystemExit(1)
    if not (DEPLOY_DIR / ".env").is_file():
        emit(
            "错误：缺少 deploy/.env（应用数据库/Redis 等配置）。"
            "请先从示例复制并填写。"
        )
        raise SystemExit(1)
    return cfg


def connect(cfg: dict[str, str]) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        cfg["host"],
        username=cfg["user"],
        password=cfg["password"],
        timeout=30,
        allow_agent=False,
        look_for_keys=False,
    )
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str]:
    _stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    return code, (out + err)


def should_exclude(rel: Path) -> bool:
    # 支付凭据通过受保护文件单独配置，不进入部署源码压缩包。
    if rel.as_posix().startswith(("apps/api/config/alipay/", "apps/api/config/wechat/")):
        return True
    if any(part in EXCLUDE_DIR_NAMES for part in rel.parts):
        return True
    if rel.suffix.lower() in EXCLUDE_FILE_SUFFIXES:
        return True
    # 上传应用配置；不上传本机 SSH 部署密钥文件
    if rel.as_posix() == "deploy/.env":
        return False
    if rel.as_posix() == "deploy/.env.deploy":
        return True
    if rel.name.startswith(".env") and rel.name != ".env.example":
        return True
    return False


def make_tarball() -> bytes:
    buf = io.BytesIO()
    count = 0
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in ROOT.rglob("*"):
            if not path.is_file():
                continue
            rel = path.relative_to(ROOT)
            if should_exclude(rel):
                continue
            tar.add(path, arcname=rel.as_posix())
            count += 1
    emit(f"[本地] 已打包 {count} 个文件，约 {buf.tell() / 1024 / 1024:.1f} MB")
    return buf.getvalue()


def sftp_put_bytes(client: paramiko.SSHClient, remote: str, data: bytes) -> None:
    sftp = client.open_sftp()
    try:
        with sftp.file(remote, "wb") as f:
            f.write(data)
    finally:
        sftp.close()


def sftp_put_text(client: paramiko.SSHClient, remote: str, text: str) -> None:
    sftp_put_bytes(client, remote, text.encode("utf-8"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="一键部署 Aird-Platform 到服务器")
    parser.add_argument(
        "--services",
        default="api,admin,web",
        help="要构建/重启的服务，逗号分隔。例：api 或 api,admin,web",
    )
    parser.add_argument(
        "--prune",
        action="store_true",
        help="构建前清理 Docker 缓存，释放磁盘",
    )
    parser.add_argument(
        "--skip-upload",
        action="store_true",
        help="跳过代码上传（仅远程重建，适合服务器代码已更新）",
    )
    parser.add_argument(
        "--timeout-min",
        type=int,
        default=90,
        help="等待构建完成的最长时间（分钟），默认 90",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    services = tuple(
        s.strip() for s in args.services.split(",") if s.strip() in DEFAULT_SERVICES
    )
    if not services:
        emit("错误：--services 至少包含 api / admin / web 之一")
        return 1

    cfg = load_config()
    remote_app = cfg["remote_app"]
    remote_log = cfg["remote_log"]
    services_str = " ".join(services)

    emit("========== Aird-Platform 一键部署 ==========")
    emit(f"目标服务器: {cfg['user']}@{cfg['host']}")
    emit(f"远程目录:   {remote_app}")
    emit(f"部署服务:   {', '.join(services)}")
    emit("==========================================")

    client = connect(cfg)

    emit("\n[1/6] 准备远程目录")
    run(
        client,
        f"mkdir -p {remote_app}/deploy {remote_app}/logs && df -h / | tail -1",
    )

    if args.prune:
        emit("\n[可选] 清理 Docker 缓存")
        run(
            client,
            "docker builder prune -af >/dev/null; docker image prune -af >/dev/null; "
            "df -h / | tail -1",
            timeout=300,
        )

    if not args.skip_upload:
        emit("\n[2/6] 上传最新代码（保留远程 deploy/.env 与 .git）")
        tarball = make_tarball()
        remote_tar = "/tmp/aird-platform-src.tgz"
        sftp_put_bytes(client, remote_tar, tarball)
        code, out = run(
            client,
            # 保留 .git 与生产 .env，避免毁掉服务器仓库和密钥
            f"test -f {remote_app}/deploy/.env && "
            f"cp -a {remote_app}/deploy/.env /tmp/aird-deploy.env.bak || true; "
            f"tar -xzf {remote_tar} -C {remote_app} && rm -f {remote_tar} && "
            f"if [ -f /tmp/aird-deploy.env.bak ]; then "
            f"cp -a /tmp/aird-deploy.env.bak {remote_app}/deploy/.env; fi && "
            f"test -f {remote_app}/deploy/.env && "
            f"ls {remote_app}/apps/api/prisma/migrations | tail -3",
            timeout=180,
        )
        if code != 0:
            emit(out)
            emit("错误：代码解压失败")
            client.close()
            return 1
        emit(out.strip()[-500:])
    else:
        emit("\n[2/6] 跳过上传（--skip-upload）")

    emit("\n[3/6] 规范化脚本换行并授权")
    run(
        client,
        f"sed -i 's/\\r$//' {remote_app}/deploy/entrypoint-api.sh "
        f"{remote_app}/deploy/nginx.admin.conf {remote_app}/deploy/nginx.web.conf "
        f"{remote_app}/deploy/.env "
        f"{remote_app}/deploy/run-on-server.sh 2>/dev/null || true; "
        f"chmod +x {remote_app}/deploy/entrypoint-api.sh "
        f"{remote_app}/deploy/run-on-server.sh 2>/dev/null || true",
    )

    emit("\n[4/6] 后台构建并启动（含数据库 migrate）")
    # 结束旧构建，避免并发抢锁
    run(
        client,
        "pkill -f 'docker compose build' 2>/dev/null || true; sleep 1",
        timeout=30,
    )
    build_cmd = (
        f"cd {remote_app}/deploy && "
        "export DOCKER_BUILDKIT=1 COMPOSE_DOCKER_CLI_BUILD=1 && "
        f"mkdir -p {remote_app}/logs && "
        f"nohup bash -c '"
        f"echo BUILD_START_TS=$(date -Iseconds) > {remote_log}; "
        f"docker compose --env-file .env build {services_str} --progress=plain "
        f">> {remote_log} 2>&1; "
        f"echo BUILD_EXIT:$? >> {remote_log}; "
        f"docker compose --env-file .env up -d --remove-orphans --force-recreate "
        f"{services_str} >> {remote_log} 2>&1; "
        f"echo UP_EXIT:$? >> {remote_log}; "
        f"docker compose --env-file .env ps -a >> {remote_log} 2>&1; "
        f"echo DEPLOY_FINISHED=$(date -Iseconds) >> {remote_log}"
        f"' >{remote_app}/logs/app-deploy-nohup.out 2>&1 & echo STARTED"
    )
    # 用独立 channel 启动后台任务，避免 SSH 超时打断
    transport = client.get_transport()
    assert transport is not None
    chan = transport.open_session()
    chan.exec_command(build_cmd)
    time.sleep(2)
    chan.close()
    time.sleep(3)
    _code, started = run(
        client,
        f"pgrep -af 'docker compose build' | grep -v grep || echo NO_BUILD; "
        f"tail -n 5 {remote_log}",
    )
    emit(started[-800:])

    emit("\n[5/6] 等待构建完成…")
    deadline = time.time() + args.timeout_min * 60
    finished = False
    while time.time() < deadline:
        time.sleep(20)
        _code, status = run(
            client,
            f"grep -E '^BUILD_EXIT:|^UP_EXIT:|^DEPLOY_FINISHED=' {remote_log} || true; "
            "echo BUILD_PROCS=$(pgrep -c -f 'docker compose build' 2>/dev/null || echo 0); "
            f"tail -n 4 {remote_log}; "
            "df -h / | awk 'NR==2{print \"DISK\",$4,$5}'",
            timeout=90,
        )
        emit(f"--- 进度 ---\n{status[-1200:]}")
        if "BUILD_EXIT:" in status and "UP_EXIT:" in status:
            finished = True
            break
        if "BUILD_EXIT:" not in status and "BUILD_PROCS=0" in status:
            emit("警告：构建进程已退出但未写完标记，继续检查日志…")
            time.sleep(5)
            _code, status2 = run(
                client,
                f"grep -E '^BUILD_EXIT:|^UP_EXIT:' {remote_log} || true; "
                f"tail -n 60 {remote_log}",
            )
            emit(status2[-3000:])
            if "BUILD_EXIT:" in status2:
                finished = "UP_EXIT:" in status2
                break
            emit("错误：构建异常中断")
            client.close()
            return 1

    if not finished:
        emit("错误：等待超时。请查看服务器日志：")
        emit(f"  tail -n 100 {remote_log}")
        client.close()
        return 1

    _code, markers = run(
        client, f"grep -E '^BUILD_EXIT:|^UP_EXIT:' {remote_log}"
    )
    emit(markers)
    if "BUILD_EXIT:0" not in markers or "UP_EXIT:0" not in markers:
        emit("错误：构建或启动失败，请查看完整日志")
        _code, tail = run(client, f"tail -n 80 {remote_log}")
        emit(tail[-4000:])
        client.close()
        return 1

    emit("\n[6/6] 健康检查")
    ok_http = False
    # The compose file allows custom host ports; probe the same values that
    # were deployed instead of assuming the defaults.
    api_port = cfg.get("api_host_port", "13000")
    admin_port = cfg.get("admin_host_port", "13001")
    web_port = cfg.get("web_host_port", "13002")
    for i in range(36):
        time.sleep(5)
        _code, verify = run(
            client,
            f"cd {cfg['remote_app']}/deploy && docker compose --env-file .env ps -a; "
            f"curl --noproxy '*' -s -o /dev/null -w 'api:%{{http_code}}\\n' http://127.0.0.1:{api_port}/api/v1 || true; "
            f"curl --noproxy '*' -s -o /dev/null -w 'admin:%{{http_code}}\\n' http://127.0.0.1:{admin_port}/index.html || true; "
            f"curl --noproxy '*' -s -o /dev/null -w 'web:%{{http_code}}\\n' http://127.0.0.1:{web_port}/index.html || true; "
            f"cd {cfg['remote_app']}/deploy && docker compose --env-file .env logs --tail 15 api admin web 2>&1 | tail -n 45 || true",
            timeout=60,
        )
        emit(f"检查 {(i + 1) * 5}s\n{verify[-1500:]}")
        api_ok = "api:200" in verify or "api:404" in verify
        front_ok = True
        if "admin" in services:
            front_ok = front_ok and "admin:200" in verify
        if "web" in services:
            front_ok = front_ok and "web:200" in verify
        if "api" in services and "P3009" in verify and "successfully applied" not in verify:
            # 迁移仍失败
            if i > 6 and "Error: P3009" in verify:
                emit("错误：数据库迁移失败（P3009）。请检查 prisma migrations。")
                client.close()
                return 1
        if api_ok and front_ok and "healthy" in verify:
            ok_http = True
            break
        if api_ok and front_ok and "Nest application successfully" in verify:
            ok_http = True
            break

    client.close()

    host = cfg["host"]
    emit("\n==========================================")
    if ok_http:
        emit("部署成功！")
        emit(f"  用户端:  http://{host}:13002")
        emit(f"  管理端:  http://{host}:13001")
        emit(f"  API:     http://{host}:13000/api/v1")
        emit(f"  文档:    http://{host}:13000/docs")
        emit("  超管账号: netsoil / 123456")
        emit("==========================================")
        return 0

    emit("构建已完成，但健康检查未完全通过。")
    emit("请稍等 1～2 分钟后刷新页面，或查看：")
    emit(f"  cd {cfg['remote_app']}/deploy && docker compose --env-file .env ps -a")
    emit(f"  cd {cfg['remote_app']}/deploy && docker compose --env-file .env logs --tail 100 api admin web")
    emit("==========================================")
    return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        emit("\n已取消")
        raise SystemExit(130)
