# Agentic Search 异步架构设计建议

> 通信改造已落地：HTTP 创建任务 + BullMQ（生产 Redis 模式）+ SSE 快照 + HTTP 轮询兜底。接口、实际参数、部署步骤和本版本边界见 [搜索异步任务与 SSE 接入说明](./search-async-sse-api.md)。以下为最初设计建议，其中尚未实现的完整状态机、事件回放和 checkpoint 等不代表本版本已具备。

## 1. 目标

当前搜索已经采用 LangGraph 的 Planner -> Searcher -> Evaluator -> Replanner 循环。多轮规划会增加模型调用和外部网站请求次数，因此不应让用户一直占用一个同步 HTTP 请求。

本设计的目标是：

- 用户请求快速返回任务 ID。
- 搜索任务在后台可靠执行，不依赖当前 API 请求连接持续存在。
- 前端可以看到每一轮的规划、检索、评估和最终结果。
- API 重启、网络断开、上游超时和部分来源失败不会导致任务状态丢失。
- 保留 HTTP 兼容能力，并逐步增加实时进度推送。

## 2. 当前状态与问题

当前已有：

- `POST /search/jobs` 创建异步任务。
- `GET /search/jobs/:jobId` 查询任务结果。
- 前端每 2 秒轮询一次，最长等待 10 分钟。
- LangGraph 已实现有限轮规划和证据评估。

当前主要问题：

1. 后台任务使用 API 进程中的 `void runSearchJobBackground(...)` 执行。进程重启后任务可能中断，多实例部署时也没有可靠的任务接管机制。
2. 任务状态只有 `running/completed/failed`，无法展示当前处于哪一轮、哪个阶段、已经发现哪些缺口。
3. 同步接口 `POST /search/query` 仍然可能被反向代理、网关或客户端超时终止。
4. 多轮执行缺少统一的总耗时、单轮耗时、模型调用次数和外部请求预算。

## 3. 推荐通信架构

推荐采用“HTTP 提交任务 + BullMQ 后台执行 + SSE 推送进度 + HTTP 查询兜底”的组合：

```text
浏览器
  │ POST /search/jobs
  ▼
API：校验权限、扣除任务配额、写入任务记录
  │ 返回 jobId
  ▼
Redis / BullMQ
  │
  ▼
Search Worker
  ├─ Planner
  ├─ Searcher
  ├─ Evaluator
  ├─ Replanner（0~N 次）
  └─ Writer
  │
  ├─ Redis 状态与事件记录
  ├─ SSE：GET /search/jobs/:jobId/events
  └─ HTTP：GET /search/jobs/:jobId
```

### 为什么不建议直接改成 WebSocket

搜索进度是服务端单向推送，不需要浏览器持续向服务端发送控制消息。WebSocket 会增加连接管理、鉴权、重连、负载均衡和多实例广播复杂度。SSE 使用普通 HTTP，浏览器原生支持自动重连，更适合当前场景。

SSE 不应作为唯一通道：移动网络、代理和浏览器后台限制都可能断开长连接。前端应在 SSE 断开时回退到 `GET /search/jobs/:jobId` 轮询。

## 4. 任务生命周期

建议状态：

```text
queued
  -> planning
  -> searching
  -> evaluating
  -> replanning（可循环）
  -> writing
  -> completed

任意阶段 -> failed
用户取消 -> cancelled
超过总预算 -> timed_out
```

状态与阶段应分开保存：

- `status`：任务整体状态。
- `stage`：当前阶段。
- `round`：当前规划轮次，从 1 开始。
- `maxRounds`：最大轮次，默认 3，最大 5。
- `progress`：0 到 100 的估算进度，仅用于展示，不代表精确完成百分比。
- `message`：面向国内用户的简体中文进度说明。
- `updatedAt`：前端判断任务是否继续推进的时间。

建议任务记录：

```json
{
  "jobId": "uuid",
  "userId": "user-id",
  "status": "evaluating",
  "stage": "evaluating",
  "round": 1,
  "maxRounds": 3,
  "progress": 55,
  "message": "正在评估指标、年份和统计口径是否覆盖问题",
  "query": "用户原始问题",
  "mode": "mixed",
  "result": null,
  "error": null,
  "createdAt": "2026-11-11T00:00:00.000Z",
  "updatedAt": "2026-11-11T00:00:10.000Z"
}
```

不要把完整证据正文和每轮大模型输入全部放在 Redis 状态中。任务状态只保存摘要、计数、错误和引用 ID；完整结果继续写入现有数据库或对象存储。

## 5. 接口建议

### 创建任务

```http
POST /api/v1/search/jobs
```

响应保持快速返回：

```json
{
  "jobId": "uuid",
  "status": "queued"
}
```

创建任务时完成：登录校验、搜索权限校验、参数规范化、幂等键检查和 BullMQ 入队。不要在此接口执行 Planner 或外部搜索。

### 查询任务

```http
GET /api/v1/search/jobs/:jobId
```

返回完整快照，作为 SSE 失败时的兜底方式。

### SSE 进度

```http
GET /api/v1/search/jobs/:jobId/events
Accept: text/event-stream
```

事件格式建议：

```text
event: snapshot
data: {"jobId":"uuid","status":"planning","stage":"planning","round":1,"progress":20,"message":"正在理解研究意图"}

event: stage
data: {"stage":"searching","round":1,"progress":38,"message":"正在查询 2 个相关网站"}

event: completed
data: {"jobId":"uuid","status":"completed","result":{}}
```

任务进入 `completed`、`failed`、`cancelled` 或 `timed_out` 后发送终止事件并关闭连接。SSE 连接只推送状态和摘要，不推送敏感凭据或完整第三方网页正文。

### 取消任务

```http
POST /api/v1/search/jobs/:jobId/cancel
```

取消必须同时更新任务状态和 BullMQ job 状态。正在执行的外部请求使用 `AbortSignal` 或请求超时尽快结束；无法立即中断的请求也不得再写入最终结果。

## 6. BullMQ 任务设计

建议新增队列：`agentic-search`。

Job 数据只包含：

```json
{
  "jobId": "uuid",
  "userId": "user-id",
  "query": "normalized query",
  "filters": {},
  "mode": "mixed"
}
```

建议配置：

- `attempts: 2`：只重试基础设施级瞬时错误，不重试用户参数错误、鉴权错误和余额不足。
- 指数退避：1 秒、5 秒。
- `removeOnComplete` 保留短期记录，最终结果由应用存储负责。
- `removeOnFail` 保留失败记录，方便排查。
- Worker 并发按上游配额设置，初始建议 2～4，不要让每个任务的多轮查询无限并发。
- 使用 BullMQ jobId 或 Redis 幂等键防止同一任务重复执行。

任务执行器每次进入阶段都先写状态，再执行实际工作；完成阶段后再次写状态。这样即使 Worker 中断，也能知道任务最后停在什么位置。

## 7. 超时与预算

必须同时设置四类预算：

| 预算 | 建议初始值 | 作用 |
|---|---:|---|
| 单个外部 HTTP 请求 | 15～30 秒 | 防止一个网站拖住整轮 |
| 单个 LLM 调用 | 30～60 秒 | 防止规划或评估无限等待 |
| 单轮检索 | 90～120 秒 | 控制一轮网站并发总时长 |
| 整个任务 | 5～10 分钟 | 超时后返回已获取证据和缺口 |

超过整任务预算时，任务应进入 `timed_out`，Writer 可以基于已获取证据生成“部分结果”，并列出未完成的数据需求。不要无限增加重试次数来掩盖上游慢或不可用。

建议动态调整轮次：

- 首轮已经获得充分证据：立即结束，不执行 Replanner。
- 首轮没有任何相关证据：允许一次定向公开网页发现。
- 已经连续两轮没有新增有效证据：提前结束。
- 剩余时间不足一轮最低预算：不再启动新轮次。

## 8. Planner-Executor 与通信解耦

LangGraph 不应直接依赖 HTTP 请求对象、SSE response 或 Express 生命周期。建议将图封装成：

```ts
runResearchJob({ jobId, query, filters, mode, signal }): Promise<ResearchJobResult>
```

阶段进度通过回调或事件接口上报：

```ts
onProgress({ stage, round, progress, message, metadata }): Promise<void>
```

这样同一个执行器可以被 BullMQ Worker、测试代码和未来的管理端任务重放复用。

## 9. 失败与一致性规则

- 规划失败：任务失败，不扫描全部配置来源兜底。
- 单个网站失败：记录失败网站，继续处理其他已选网站。
- 本轮全部网站失败：如果尚有时间，可重试一次；否则返回部分失败状态。
- 评估失败：不把结果判定为充分，允许有限重试或结束并标记评估不可用。
- Writer 失败：保留已保存证据，返回结构化证据摘要和可重试状态。
- Worker 重启：根据任务状态和 BullMQ job 状态恢复或安全重试，禁止重复扣费。
- 费用扣除必须使用任务级幂等键，不能因为 Worker 重试重复扣除。

## 10. 分阶段实施计划

### 阶段一：先稳定异步任务

1. 抽出 `SearchJobExecutor`，把当前 `runSearchJobBackground` 的业务逻辑迁移进去。
2. 新增 BullMQ `agentic-search` 队列、Producer 和 Worker。
3. 保留现有 `POST /search/jobs` 和 `GET /search/jobs/:jobId`，让 API 只负责入队。
4. 增加任务级幂等、取消标志、总超时和费用扣除幂等。

### 阶段二：增加阶段进度

1. 给 LangGraph 增加 `onProgress` 回调。
2. Worker 将阶段摘要写入 Redis，并同步更新任务快照。
3. 前端继续轮询，但展示真实的 Planner、Searcher、Evaluator、Replanner、Writer 阶段。

### 阶段三：增加 SSE

1. 实现 `GET /search/jobs/:jobId/events`。
2. 前端优先使用 SSE，连接失败自动回退到轮询。
3. 处理浏览器切后台、代理断开、重连和最后事件补偿。

### 阶段四：性能优化

1. 对首轮规划结果和相同查询的来源计划做短期缓存。
2. 同一轮内对不同网站并行检索，但设置并发上限。
3. 评估时只发送候选摘要和必要片段，限制输入长度。
4. 记录每轮耗时、token、网站成功率、有效证据率和提前结束率。

## 11. 验收标准

- 创建任务接口在正常情况下 1～2 秒内返回 `jobId`。
- API 重启不会让已入队任务静默丢失。
- 前端可以看到每轮阶段和中文进度说明。
- SSE 断开后能通过轮询继续获得最终结果。
- 任务最多执行配置的轮数，不会无限 Replanner。
- 同一任务重试不会重复扣费或重复写入最终结果。
- 用户指定来源时不会访问其他网站。
- 外国网站使用英文查询，最终回答仍为简体中文。
- 超时任务保留已获得证据、失败网站和未满足的数据需求。

## 12. 结论

近期最值得实施的是 BullMQ 后台 Worker 和任务进度状态；它们直接解决 API 进程重启、连接超时和多实例可靠性问题。SSE 是用户体验增强层，可以在 Worker 稳定后加入。WebSocket 暂不建议作为第一阶段方案。
