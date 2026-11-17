"""Append/update Tencent SMS vars on remote deploy/.env and restart api."""
import re
import paramiko
from pathlib import Path

DEPLOY = Path(__file__).resolve().parent
cfg = {}
for raw in (DEPLOY / ".env.deploy").read_text(encoding="utf-8").splitlines():
    if "=" in raw and not raw.strip().startswith("#"):
        k, v = raw.split("=", 1)
        cfg[k.strip()] = v.strip().strip('"').strip("'")

SMS = {
    "TENCENT_SMS_SDK_APP_ID": "1401206853",
    "TENCENT_SMS_TEMPLATE_ID": "2749941",
    "TENCENT_SMS_SECRET_ID": "",
    "TENCENT_SMS_SECRET_KEY": "",
    "TENCENT_SMS_SIGN_NAME": "上海新思客智库",
    "TENCENT_SMS_REGION": "ap-guangzhou",
    "TENCENT_SMS_CODE_TTL_SEC": "300",
    "TENCENT_SMS_SEND_INTERVAL_SEC": "60",
    "TENCENT_SMS_PREVIEW_CODE": "1111",
    "TENCENT_SMS_FORCE_PREVIEW": "true",
}

# Optional local override (gitignored): deploy/.env.sms.local
local_sms = DEPLOY / ".env.sms.local"
if local_sms.is_file():
    for raw in local_sms.read_text(encoding="utf-8").splitlines():
        if "=" in raw and not raw.strip().startswith("#"):
            k, v = raw.split("=", 1)
            SMS[k.strip()] = v.strip()

remote_app = cfg["DEPLOY_REMOTE_APP"]
remote_env = f"{remote_app}/deploy/.env"

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(cfg["DEPLOY_HOST"], username=cfg["DEPLOY_USER"], password=cfg["DEPLOY_PASSWORD"], timeout=30)

sftp = client.open_sftp()
with sftp.open(remote_env, "r") as f:
    content = f.read().decode("utf-8")

for key, val in SMS.items():
    line = f"{key}={val}"
    pat = rf"^{re.escape(key)}=.*$"
    if re.search(pat, content, flags=re.MULTILINE):
        content = re.sub(pat, line, content, count=1, flags=re.MULTILINE)
    else:
        if "# Tencent SMS" not in content:
            content = content.rstrip() + "\n\n# Tencent SMS\n"
        content = content.rstrip() + "\n" + line + "\n"

client.exec_command(f"cp -a {remote_env} {remote_env}.bak-sms")[1].read()
with sftp.open(remote_env, "w") as f:
    f.write(content.encode("utf-8"))

# sync workstation deploy/.env
local = DEPLOY / ".env"
if local.is_file():
    text = local.read_text(encoding="utf-8")
    for key, val in SMS.items():
        line = f"{key}={val}"
        pat = rf"^{re.escape(key)}=.*$"
        if re.search(pat, text, flags=re.MULTILINE):
            text = re.sub(pat, line, text, count=1, flags=re.MULTILINE)
        else:
            if "# Tencent SMS" not in text:
                text = text.rstrip() + "\n\n# Tencent SMS\n"
            text = text.rstrip() + "\n" + line + "\n"
    local.write_text(text, encoding="utf-8")

cmd = f"cd {remote_app}/deploy && docker compose --env-file .env -f docker-compose.yml up -d --force-recreate api"
_, stdout, stderr = client.exec_command(cmd, timeout=600)
print(stdout.read().decode("utf-8", "replace"))
err = stderr.read().decode("utf-8", "replace")
if err.strip():
    print("stderr:", err)
client.close()
print("done")
