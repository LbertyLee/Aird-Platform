# Docker Compose 部署

此目录支持两种部署方式：

1. **完整栈**（`docker-compose.yml`，**当前生产使用**）：自带 PostgreSQL / Redis / MinIO / Milvus。生产机：`124.221.222.3`。
2. **应用三件套**（`docker-compose.app.yml`）：仅在复用外部中间件时使用；当前默认不再使用旧机 `121.204.162.239`。

每次 API 容器启动只执行 `prisma migrate deploy`，Prisma 根据 `_prisma_migrations` 记录仅应用尚未执行的迁移；已执行的 SQL 不会重复运行，也不会重置数据库。业务 seed 不再随启动自动执行，以免覆盖管理员维护的配置或下线维护数据。

数据库结构或数据修复应新增一条 migration；已经应用过的 migration 文件不要修改。部署只执行新 migration 目录中的 SQL，不会逐条比较或重新执行旧 migration 文件里的语句。

## 一键部署（推荐，生产机 124.221.222.3）

### 第一次使用

```bash
# 1. 应用环境（数据库/Redis 等，若已有可跳过）
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env：将 example.com 改为 124.221.222.3

# 2. SSH 登录信息
cp deploy/server.deploy.example deploy/.env.deploy
# 编辑：DEPLOY_HOST=124.221.222.3 / DEPLOY_USER=ubuntu / DEPLOY_PASSWORD=...

# 3. 安装依赖（仅首次）
pip install paramiko
```

### 在生产服务器上执行（SSH 登录后）

```bash
ssh ubuntu@124.221.222.3
cd ~/Aird-Platform
git pull origin dev
cd deploy
bash run-on-server.sh
```

只更新 API / 数据库：

```bash
bash run-on-server.sh api
```

磁盘紧张时：

```bash
bash run-on-server.sh --prune api admin web
```

> 必须进入 `deploy` 目录再执行。服务器脚本会构建**当前服务器上的代码**。

### 从本机一键发布

```powershell
.\deploy\deploy-to-server.ps1
# 或只更新 API：
.\deploy\deploy-to-server.ps1 -Services api
```

成功后访问：

| 服务 | 地址 |
| --- | --- |
| 用户端 | http://124.221.222.3:13002 |
| 管理端 | http://124.221.222.3:13001 |
| API | http://124.221.222.3:13000/api/v1 |
| Swagger | http://124.221.222.3:13000/docs |

默认超管：`netsoil` / `123456`。

### 脚本做了什么

1. 同步代码到 `/home/ubuntu/Aird-Platform`（保留远程 `.env` / `.git`）
2. 使用完整栈 `docker-compose.yml`
3. `docker compose build` + `up` 重建所选服务
4. API 容器内只应用尚未执行的数据库迁移，然后启动 API
5. 检查 api / admin / web 是否可访问

---

## 完整栈部署（全新服务器）

服务器需要 Docker Engine 和 Docker Compose v2。将项目代码复制到服务器后，在项目根目录执行：

```bash
cp deploy/.env.example deploy/.env
# 编辑 deploy/.env：填写公网地址、数据库/Redis/MinIO/JWT 密钥和 AI 服务密钥
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

将 `MINIO_PUBLIC_ENDPOINT` 和 `CORS_ORIGINS` 中的 `example.com` 改为浏览器可访问的服务器公网 IP 或域名。前者是文件预览和下载签名地址的外部 origin，后者是管理端和用户端的实际访问 origin。若在 HTTPS 域名后使用反向代理，请将两者改为 HTTPS origin；容器内部仍固定使用 `http://minio:9000`。

每次 API 重新部署只会执行尚未应用的 Prisma migrations。已应用的 migration 不会重放，数据库不会因 API 重启而重置。

种子数据仅用于全新数据库的首次初始化，需要时由管理员手动执行；不要把它作为常规部署步骤，因为脚本会维护部分预置角色、会员配置和来源数据。全新数据库首次部署并确认 API 已启动后，可按需执行：

```bash
docker compose --env-file .env exec api ./node_modules/.bin/ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts
docker compose --env-file .env exec api ./node_modules/.bin/ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-sources.ts
```

以上命令不要在已有生产维护数据的数据库上重复运行。

## 服务地址（完整栈默认端口）

默认端口由 `deploy/.env` 控制：

| 服务          | 默认地址                          |
| ------------- | --------------------------------- |
| 用户端        | `http://SERVER_HOST:13002`        |
| 管理端        | `http://SERVER_HOST:13001`        |
| API           | `http://SERVER_HOST:13000/api/v1` |
| Swagger       | `http://SERVER_HOST:13000/docs`   |
| MinIO API     | `http://SERVER_HOST:9000`         |
| MinIO Console | `http://SERVER_HOST:9001`         |

生产服务器建议在 Nginx、Caddy 或负载均衡器后提供 HTTPS，并在防火墙中只开放实际需要的入口端口。PostgreSQL、Redis、etcd 和 Milvus 默认不映射到公网。

## 日常操作（完整栈）

```bash
# 查看运行状态和日志
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs -f api

# 更新代码后重新构建并滚动重建服务
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build

# 停止服务，保留所有持久化数据
docker compose --env-file deploy/.env -f deploy/docker-compose.yml down
```

不要执行 `down -v`，除非确定要删除 PostgreSQL、Redis、MinIO、etcd、Milvus 与备份卷中的全部数据。

## 构建上下文提示支付配置目录无权读取

如果构建出现 `load build context` 和 `apps/api/config/wechat: permission denied`，确认根目录 `.dockerignore` 包含 `apps/api/config`，排除整个运行时支付配置目录，避免构建上下文遍历受限的密钥目录。仅排除内部子目录可能仍会触发目录读取。

支付配置通过 Compose 的只读卷挂载提供，不需要复制到镜像，也不需要为构建放宽密钥权限。更新排除规则后重新运行 `bash ./deploy/run-on-server.sh`。源码配置目录 `apps/api/src/config` 不受此规则影响。
