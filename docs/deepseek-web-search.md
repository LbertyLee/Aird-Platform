# DeepSeek 网页搜索与抓取

外部检索由 LangGraph 规划-执行循环统一编排：先理解意图并选择相关网站，再检索、评估证据充分性，必要时针对缺口进行有限再规划。中文问题在国外网站上使用英文查询词，最终回答保持简体中文；详见 [`langgraph-research-planning.md`](./langgraph-research-planning.md)。

检索模式新增独立「AI 搜索」分支（`mode: "ai-search"`），使用 DeepSeek Search 与 Fetch。原有「联网」使用 Exa，「混合」聚合知识库与 Exa，「知识库」只检索内部资料。聊天、OCR、向量与重排仍使用原有 `AI_API_KEY`。

## 服务端配置

在未纳入 Git 的根目录 `.env` 或生产环境变量中设置：

```dotenv
DEEPSEEK_SEARCH_API_KEY=<DeepSeek API Key>
DEEPSEEK_SEARCH_TIMEOUT_MS=30000
EXA_SEARCH_COUNT=40
```

重启 API 服务后生效。不要把真实密钥写入被跟踪的 `apps/api/.env`、前端变量或文档。生产部署单独配置 `deploy/.env`；本次代码接入不包含部署。

## 调用链与接口

- 已登录用户通过 `POST /api/v1/search/query`、`POST /api/v1/search/jobs` 或 `POST /api/v1/external-search/search` 发送 `{ "query": "中国GDP", "mode": "ai-search" }`；可附带原有 `filters`。响应和历史记录的 `mode` 均为 `ai-search`，检索进度显示「AI 搜索」。未配置 DeepSeek Key 时明确报错，不切换服务商。
- `GET /api/v1/external-search/status` 返回 `{ externalSearch: boolean, aiSearch: boolean, provider: "exa" }`，分别表示 Exa 和 DeepSeek 的配置状态，不代表上游健康检查。
- 搜索适配器调用 `POST https://api.deepseek.com/v1/tools/search`，携带 Bearer 鉴权，发送 `query`、`count`、`need_content: false`。只保存摘要供重排，选中来源或预览时按需获取正文。
- 规划选中的网站逐域名使用 `site:` 查询，完整查询限制为 128 个 Unicode 字符；长问题在保留域名限制后截断。返回 URL 再次校验域名及子域名。用户未指定来源且规划发现数据缺口时，允许有限的公开网页发现；不会扫描全部配置来源。`rerank_score / 3` 归一化为现有排序分数。
- 正文补全调用 `POST https://api.deepseek.com/v1/tools/fetch`，发送 `{ url }`，将 Markdown `content` 接入原有预览与分析链路；每个 URL 单独请求并去重，默认保留最多 50000 字符。失败页面使用原有补全重试与直连回退流程。
- 为兼容已有来源展示和分析，来源 `origin: exa`、`usedExa`、`exaConfigured` 等历史字段继续复用；`mode` 区分分支，实际来源元数据使用 `deepseek-search` / `deepseek-fetch`。后续正文补全按持久化的来源标识选择服务商，可在同一次分析中处理不同分支的历史来源。

HTTP 408、429、5xx 最多重试两次，退避 500ms、1000ms；其他 4xx 不自动重试，401 提示密钥无效、402 提示余额不足。连接错误或超时向上层返回服务不可用。错误消息不透传上游正文或鉴权头。

Search/Fetch 按成功请求计费；逐域名搜索会增加调用次数，域名批次之间沿用现有并发设置 `EXA_SOURCE_SEARCH_CONCURRENCY`。账号级 QPS 在多进程部署时应统一限流；当前适配器仅约束单批串行抓取及有界重试。
