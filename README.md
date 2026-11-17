# AI 数智研究平台

基于 pnpm workspace 的前后端 monorepo。当前一期交付重点为 **管理后台 + Admin API**（用户、RBAC、会员、运营看板、操作日志、指标/字典/数据集、知识库与向量检索）以及用户前台 **AI 数据智搜**。

管理端品牌名：**AI智库数据智能分析平台**。

> 平台账号体系以 **用户 + 角色权限 + 个人会员** 为主，**不包含组织/部门租户模型**。

## 技术栈

- **API**：NestJS 11、Prisma 6、PostgreSQL、BullMQ、Redis、JWT/Passport、Swagger、MinIO、Milvus、Embedding（OpenAI 兼容 / 百炼多模态）
- **管理后台**：React 18、Vite、TypeScript、Ant Design 5、TanStack Query、Zustand、ECharts
- **用户前台**：React 18、Vite、TypeScript（AI 数据智搜与分析工作台）
- **基础设施**：PostgreSQL（含 pgvector）、Redis、MinIO；向量检索依赖外部 Milvus + Embedding
- **工程**：pnpm workspace、Turborepo、Prettier

## 目录

```text
apps/
  api/                 NestJS API（鉴权、RBAC、会员、操作日志、数据资源、知识库、向量同步、研究检索）
  admin/               运营管理后台（一期功能可用）
  web/                 用户前台（AI 数据智搜）
packages/
  contracts/           前后端共享 Zod 契约
docs/
  admin-phase1-design.md   管理端一期设计规格（含历史组织模型说明，实现已简化）
deploy/                镜像与部署编排
docker-compose.yml     本地 Postgres / Redis / MinIO
中间件链接文档.md       远程中间件联调说明（含账号，勿对外公开）
```

## 已实现能力

| 模块 | 说明 |
| --- | --- |
| 认证 | 登录 / 登出 / 刷新令牌；个人资料与改密；JWT + Redis 存 refresh |
| RBAC | 菜单 / 按钮 / 导出 / 数据权限（全部 / 仅本人）；角色与权限绑定；接口级 `@RequirePermissions` |
| 用户 | 用户 CRUD、启停、重置密码、CSV 导出；分配角色与个人会员 |
| 会员 | 等级与权益；**个人订阅**；订单与支付回调；发票；续费提醒；权益按更高额度合并 |
| 操作日志 | 全接口请求审计（含登录）；模块标题、业务类型、方法、URL、IP、参数/响应（脱敏）、状态、耗时；管理端分页查询与详情 |
| 运营看板 | 用户数、搜索量、数据量、Agent 任务等概览；异常告警；Redis 短缓存 |
| 指标库 | CRUD、语义检索、重索引（Milvus） |
| 字典 | 国家地区 / 机构 / 行业 / 单位 / 时间粒度等；CRUD、语义检索、重索引 |
| 数据集 | 可见性与上下架；上传 MinIO；预览 / 下载；语义检索；分块向量化与批量重索引 |
| 知识库 | 类目 / 标签、条目上传与发布、入库审核、索引重建 / 增量 / 清理 |
| 向量同步 | BullMQ Worker：抽文本 → 分块 → Embedding → 写入 Milvus |
| AI 数据智搜 | 查询规划、本地 / 向量 / Exa / 世界银行等多源检索、资料上传、分析工作台与报告生成 |

> 语义检索与向量同步需配置 `MILVUS_ADDRESS` 与 `EMBEDDING_*`。本地 `pnpm infra:up` **不含 Milvus**，可对接远程实例（见 `中间件链接文档.md`）。

### 近期变更摘要

- **生产环境统一为 `124.221.222.3`**：完整 Docker 栈（Postgres / Redis / MinIO / Milvus + api/admin/web）；已移除对旧机 `121.204.162.239` 的连接配置。
- **智能体**：支持分类字典与个人智能体 `owner_id` 隔离；管理端创建者自动带入、图标下拉、颜色选择器。
- **新增操作日志**：表 `oper_logs`；全局拦截器自动记录管理端与业务接口（含登录成功/失败）；管理端菜单「操作日志」（权限码 `menu:oper:log`）。
- **移除组织概念**：删除组织/部门/成员管理前后端；会员仅保留个人订阅；侧栏「组织用户」调整为「用户权限」（用户、会员等级、会员订单、角色权限）。

## 本地启动

要求 **Node.js 20.19.5**（见仓库根目录 `.nvmrc` / `.node-version`）和 pnpm 11.9+。

**Windows 推荐**：安装 [fnm](https://github.com/Schniz/fnm) 后在本仓库目录执行 `fnm install` / `fnm use`；Cursor / VS Code 打开本仓库时会通过 `.vscode/settings.json` 自动加载 fnm。勿仅依赖 PATH 里的全局 Node（例如 22/24），以免与团队不一致。

```bash
corepack enable
corepack prepare pnpm@11.9.0 --activate
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm --filter @agent/api prisma:seed
pnpm --filter @agent/api prisma:seed-sources
pnpm dev
```

也可按需单独启动：

```bash
pnpm dev:api
pnpm dev:admin
pnpm dev:web
```

## Docker Compose 部署

完整部署栈（用户端、管理端、API、PostgreSQL、Redis、MinIO、etcd、Milvus）位于 [`deploy/`](deploy/README.md)。

### 一键部署到现有服务器（推荐）

当前**唯一生产机**：`124.221.222.3`（完整 Docker 栈）。

**方式 A：登录服务器后执行（推荐）**

```bash
ssh ubuntu@124.221.222.3
cd ~/Aird-Platform
git pull origin dev
cd deploy
bash run-on-server.sh
```

> 必须进入 `deploy` 目录再执行。在仓库根目录直接 `bash run-on-server.sh` 会报「No such file」。

**方式 B：在本机一键发布**

```powershell
# 首次：复制并填写 SSH 配置（已默认指向 124.221.222.3）
copy deploy\server.deploy.example deploy\.env.deploy

# 日常一键发布（同步代码 + 构建 + 启动 + 自动迁移数据库）
.\deploy\deploy-to-server.ps1
```

或：

```bash
pnpm deploy:server
# 等价于 python deploy/deploy-to-server.py
```

只更新 API / 数据库表结构时：

```powershell
.\deploy\deploy-to-server.ps1 -Services api
```

生产访问地址：

| 服务 | 地址 |
| --- | --- |
| 用户端 | http://124.221.222.3:13002 |
| 管理端 | http://124.221.222.3:13001 |
| API | http://124.221.222.3:13000/api/v1 |
| Swagger | http://124.221.222.3:13000/docs |

更多说明见 [`deploy/README.md`](deploy/README.md)。

在目标服务器复制 `deploy/.env.example` 为 `deploy/.env` 并填写密钥后，完整自建中间件栈可执行：

```bash
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
```

本地根目录的 `docker-compose.yml` 仅供开发时启动 PostgreSQL、Redis 和 MinIO；生产或迁移到其他服务器请使用 `deploy/docker-compose.yml`。

### 访问地址

| 服务 | 地址 |
| --- | --- |
| 用户前台 | http://localhost:5173 |
| 管理后台 | http://localhost:5174 |
| API | http://localhost:3000/api/v1 |
| Swagger | http://localhost:3000/docs |
| MinIO Console | http://localhost:9001 |

### 默认账号（seed）

执行 `pnpm --filter @agent/api prisma:seed` 后：

| 项 | 值 |
| --- | --- |
| 超管账号 | `netsoil` / `123456` |
| 预置角色 | `platform_admin`、`researcher`、`data_admin`、`content_admin` |
| 免费档权益 | 搜索 20、导出 5、Agent 1、存储 1GB |

### 环境变量要点

1. 根目录 `.env` 与 `apps/api/.env` 均需配置（API 以 `apps/api/.env` 为准）。
2. 必填：`DATABASE_URL`、`REDIS_*`、`MINIO_*`、`JWT_SECRET`（≥32 字符）、`CORS_ORIGINS`。
3. 向量能力：`MILVUS_ADDRESS`、`EMBEDDING_PROVIDER` / `AI_API_KEY` / `EMBEDDING_BASE_URL` / `EMBEDDING_MODEL` / `EMBEDDING_DIM`。
4. Qwen Chat 已接入基础设施，业务侧统一使用 DashScope 配置。
5. 常规任务由 `OPENAI_MODEL` 指定（默认 `qwen3.7-plus-2026-05-26`）；复杂推理由 `OPENAI_REASONING_MODEL` 指定（默认 `qwen3.8-max`），共用 `AI_API_KEY` 和 `OPENAI_BASE_URL`。证据充分性评估、基于证据的研究结论、跨来源分析汇总及综合报告使用复杂推理模型；查询改写、语义解析、来源规划、翻译、指标抽取和字段映射审核继续使用常规模型。这是按任务类型分工，不是自动判断每个问题的难度。搜索页用户可选模型由数据库中的搜索模型配置维护，服务端会拒绝不在启用清单中的模型值。
   上线前确认百炼账号和地域支持配置的模型，以及 JSON 输出和当前请求参数；配置本身不证明模型可用。模型不可用时沿用现有空结果/证据模板降级，不自动切换到另一模型。积分规则中应配置 Max 的实际模型单价（含供应商返回的快照名），避免沿用默认价格。

## 常用脚本

```bash
pnpm infra:up | infra:down   # 启停本地 Postgres / Redis / MinIO
pnpm db:generate             # Prisma Client
pnpm db:migrate              # 开发迁移
pnpm db:studio               # Prisma Studio
pnpm build | lint | test | typecheck
```

## 相关文档

- [管理端一期设计](docs/admin-phase1-design.md)
- [中间件链接文档](中间件链接文档.md)（远程联调；含敏感信息，仅内部使用）
