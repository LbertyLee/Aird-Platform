#!/usr/bin/env bash
# 在服务器本机执行的一键部署脚本。
#
# 用法（必须先进入 deploy 目录，或用绝对路径）：
#   cd ~/Aird-Platform/deploy
#   bash run-on-server.sh
#   bash run-on-server.sh api
#   bash run-on-server.sh --prune api admin web
#
# 自动识别两种环境：
#   - 有 forge 中间件网络 → 使用 docker-compose.app.yml（只部署应用）
#   - 否则 → 使用完整栈 docker-compose.yml（含 Postgres/Redis/MinIO/Milvus）
#
# API 启动时仅应用尚未执行的 Prisma migrations；seed 需显式手动运行。

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOG_DIR="${APP_ROOT}/logs"
LOG_FILE="${LOG_DIR}/deploy-latest.log"
COMPOSE_APP="${SCRIPT_DIR}/docker-compose.app.yml"
COMPOSE_FULL="${SCRIPT_DIR}/docker-compose.yml"
ENV_FILE="${SCRIPT_DIR}/.env"
FORGE_NET="insight-forge-middleware_forge-net"

mkdir -p "${LOG_DIR}"
cd "${SCRIPT_DIR}"

# docker 权限：ubuntu 用户通常需要 sudo
DOCKER=(docker)
if ! docker info >/dev/null 2>&1; then
  if sudo -n docker info >/dev/null 2>&1; then
    DOCKER=(sudo docker)
  else
    echo "错误: 当前用户无法执行 docker，请使用有权限的账号，或配置 sudo。"
    exit 1
  fi
fi

compose() {
  "${DOCKER[@]}" compose "$@"
}

PRUNE=0
SERVICES=()
for arg in "$@"; do
  case "${arg}" in
    --prune) PRUNE=1 ;;
    api|admin|web) SERVICES+=("${arg}") ;;
    -h|--help)
      echo "用法: bash run-on-server.sh [--prune] [api] [admin] [web]"
      echo "请在 deploy 目录执行，例如："
      echo "  cd ~/Aird-Platform/deploy && bash run-on-server.sh"
      exit 0
      ;;
    *)
      echo "未知参数: ${arg}"
      echo "用法: bash run-on-server.sh [--prune] [api] [admin] [web]"
      exit 1
      ;;
  esac
done

if [ "${#SERVICES[@]}" -eq 0 ]; then
  SERVICES=(api admin web)
fi

if [ ! -f "${ENV_FILE}" ]; then
  echo "错误: 缺少 ${ENV_FILE}"
  echo "请先: cp .env.example .env 并填写配置"
  exit 1
fi

# The deployment files may be edited on Windows and arrive with CRLF. Bash
# cannot source those values until the carriage returns are removed.
sed -i 's/\r$//' "${ENV_FILE}"

# Keep health checks aligned with the ports exposed by compose. Do not source
# .env here: values such as BACKUP_CRON=0 2 * * * are valid Compose settings
# but are not valid shell assignments.
env_value() {
  sed -n "s/^${1}=//p" "${ENV_FILE}" | head -n 1 | tr -d '\r'
}
API_HOST_PORT="$(env_value API_HOST_PORT)"
ADMIN_HOST_PORT="$(env_value ADMIN_HOST_PORT)"
WEB_HOST_PORT="$(env_value WEB_HOST_PORT)"
API_HOST_PORT="${API_HOST_PORT:-13000}"
ADMIN_HOST_PORT="${ADMIN_HOST_PORT:-13001}"
WEB_HOST_PORT="${WEB_HOST_PORT:-13002}"

# 选择编排文件
COMPOSE_ARGS=(-f "${COMPOSE_FULL}")
DEPLOY_MODE="full-stack"
if "${DOCKER[@]}" network inspect "${FORGE_NET}" >/dev/null 2>&1; then
  if [ -f "${COMPOSE_APP}" ]; then
    COMPOSE_ARGS=(-f "${COMPOSE_APP}")
    DEPLOY_MODE="app-only (forge middleware)"
  fi
fi

# 去掉 Windows 换行
sed -i 's/\r$//' "${SCRIPT_DIR}/run-on-server.sh" \
  "${SCRIPT_DIR}/entrypoint-api.sh" \
  "${SCRIPT_DIR}/nginx.admin.conf" \
  "${SCRIPT_DIR}/nginx.web.conf" 2>/dev/null || true
chmod +x "${SCRIPT_DIR}/entrypoint-api.sh" "${SCRIPT_DIR}/run-on-server.sh" 2>/dev/null || true

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST_IP="${HOST_IP:-127.0.0.1}"

echo "========== Aird-Platform 服务器部署 =========="
echo "目录:   ${APP_ROOT}"
echo "模式:   ${DEPLOY_MODE}"
echo "服务:   ${SERVICES[*]}"
echo "数据库: API 启动时仅应用尚未执行的迁移（不自动运行 seed）"
echo "日志:   ${LOG_FILE}"
echo "时间:   $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================================="

if [ "${PRUNE}" = "1" ]; then
  echo "[1/4] 清理 Docker 缓存..."
  "${DOCKER[@]}" builder prune -af >/dev/null || true
  "${DOCKER[@]}" image prune -af >/dev/null || true
  df -h / | tail -1
else
  echo "[1/4] 跳过清理（需要时加 --prune）"
fi

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

{
  echo "==== BUILD START $(date -Iseconds) ===="
  echo "MODE=${DEPLOY_MODE}"
  echo "SERVICES=${SERVICES[*]}"
} > "${LOG_FILE}"

echo "[2/4] 构建镜像: ${SERVICES[*]}"
echo "      （较慢，日志: ${LOG_FILE}）"
set +e
compose "${COMPOSE_ARGS[@]}" --env-file .env build "${SERVICES[@]}" --progress=plain >>"${LOG_FILE}" 2>&1
BUILD_EXIT=$?
set -e
echo "BUILD_EXIT:${BUILD_EXIT}" >>"${LOG_FILE}"
if [ "${BUILD_EXIT}" -ne 0 ]; then
  echo "构建失败，请查看: tail -n 100 ${LOG_FILE}"
  tail -n 40 "${LOG_FILE}" || true
  exit "${BUILD_EXIT}"
fi

echo "[3/4] 启动服务（API 启动时仅应用尚未执行的 Prisma migrations）"
set +e
compose "${COMPOSE_ARGS[@]}" --env-file .env \
  up -d --remove-orphans --force-recreate "${SERVICES[@]}" >>"${LOG_FILE}" 2>&1
UP_EXIT=$?
set -e
echo "UP_EXIT:${UP_EXIT}" >>"${LOG_FILE}"
compose "${COMPOSE_ARGS[@]}" --env-file .env ps -a >>"${LOG_FILE}" 2>&1 || true
if [ "${UP_EXIT}" -ne 0 ]; then
  echo "启动失败，请查看: tail -n 100 ${LOG_FILE}"
  exit "${UP_EXIT}"
fi

api_container() {
  compose "${COMPOSE_ARGS[@]}" --env-file .env ps -q api 2>/dev/null | head -n1
}

echo "[4/4] 等待健康检查..."
API_OK=0
for i in $(seq 1 36); do
  sleep 5
  API_CODE="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${API_HOST_PORT}/api/v1" || true)"
  ADMIN_CODE="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ADMIN_HOST_PORT}/index.html" || true)"
  WEB_CODE="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${WEB_HOST_PORT}/index.html" || true)"
  echo "  ${i}/36  api=${API_CODE} admin=${ADMIN_CODE} web=${WEB_CODE}"

  if [ "${ADMIN_CODE}" != "200" ] || [ "${WEB_CODE}" != "200" ]; then
    ADMIN_BODY="$(curl --noproxy '*' -sS --max-time 3 "http://127.0.0.1:${ADMIN_HOST_PORT}/index.html" 2>&1 | head -c 240 || true)"
    WEB_BODY="$(curl --noproxy '*' -sS --max-time 3 "http://127.0.0.1:${WEB_HOST_PORT}/index.html" 2>&1 | head -c 240 || true)"
    echo "    admin response: ${ADMIN_BODY}"
    echo "    web response: ${WEB_BODY}"
  fi

  CTR="$(api_container || true)"
  if [ -n "${CTR}" ] && "${DOCKER[@]}" logs "${CTR}" --tail 40 2>/dev/null | grep -q 'Error: P3009'; then
    if ! "${DOCKER[@]}" logs "${CTR}" --tail 40 2>/dev/null | grep -q 'successfully applied'; then
      echo "检测到数据库迁移失败 (P3009)。"
      echo "可执行以下命令清理失败记录后重启 API："
      echo "  ${DOCKER[*]} exec aird-platform-postgres-1 psql -U forge -d ai_research -c \"DELETE FROM \\\"_prisma_migrations\\\" WHERE migration_name='20260921170000_add_agent_owner_and_dictionary_category' AND finished_at IS NULL;\""
      echo "  bash run-on-server.sh api"
      exit 1
    fi
  fi

  if [[ "${API_CODE}" =~ ^(200|404|401)$ ]]; then
    API_OK=1
    FRONT_OK=1
    for s in "${SERVICES[@]}"; do
      if [ "${s}" = "admin" ] && [ "${ADMIN_CODE}" != "200" ]; then FRONT_OK=0; fi
      if [ "${s}" = "web" ] && [ "${WEB_CODE}" != "200" ]; then FRONT_OK=0; fi
    done
    if [ "${FRONT_OK}" = "1" ]; then
      break
    fi
  fi
done

echo "DEPLOY_FINISHED=$(date -Iseconds)" >>"${LOG_FILE}"
echo
"${DOCKER[@]}" ps --filter name=aird --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' || true
echo

if [ "${API_OK}" = "1" ]; then
  echo "========== 部署成功 =========="
else
  echo "========== 构建已完成，健康检查未完全通过 =========="
  echo "Compose 状态:"
  compose "${COMPOSE_ARGS[@]}" --env-file .env ps -a || true
  echo "前端日志:"
  compose "${COMPOSE_ARGS[@]}" --env-file .env logs --tail 100 admin web || true
  echo "API 日志:"
  compose "${COMPOSE_ARGS[@]}" --env-file .env logs --tail 100 api || true
fi

echo "用户端: http://${HOST_IP}:${WEB_HOST_PORT}"
echo "管理端: http://${HOST_IP}:${ADMIN_HOST_PORT}"
echo "API:    http://${HOST_IP}:${API_HOST_PORT}/api/v1"
echo "文档:   http://${HOST_IP}:${API_HOST_PORT}/docs"
echo "日志:   ${LOG_FILE}"
echo "================================"
