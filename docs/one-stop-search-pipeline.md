# 一站式数据智能搜索 — 流程与代码落点

> 用途：后续改搜索 / 提取 / 图表 / 报告时，按阶段快速定位文件与入口。  
> 主产品面：`apps/web`（用户研究端）。管理端另有 `SearchTestPage` 测试通路，勿与用户主链路混淆。

---

## 1. 端到端总览

```text
ResearchPage（输入问题 + 检索模式）
    │  POST /search/query
    ▼
SearchOrchestratorService
    ├─ knowledge → DataAnalysisService → AiQueryService（SQL + RAG）
    └─ exa       → ExternalSearchService → AiQueryService（LangGraph 规划-执行循环）
    │  合并 sources + summarizeMixedAnswer → 写 ResearchRun
    ▼
SearchResultsPage（答案 + 来源列表 + Exa 摘要预览）
    │  用户勾选来源 → POST /analysis/sessions
    ▼
AnalysisSessionService.prepare（指标提取 / 标准化）
    │  buildVisualDatasets
    ▼
DataAnalysisWorkspace（矩阵 / 图表 / 可视化报告）
```

前端进度条文案（解析意图 → 多源检索 → 标准化 → 分析 → 报告）来自 `apps/web/src/search-progress.ts`，是**按耗时模拟的 UX**，不是服务端真实 stage。真实阶段看响应里的 `stages`。

---

## 2. 按改动意图找文件

| 你想改什么 | 先看这些文件 |
|------------|--------------|
| 首页搜索框 / 模式切换 / 文案 | `apps/web/src/pages/ResearchPage.tsx` |
| 搜索进度步骤文案 | `apps/web/src/search-progress.ts`、`apps/web/src/components/SearchExecutionProgress.tsx` |
| 结果页布局、勾选来源、进分析 | `apps/web/src/pages/SearchResultsPage.tsx` |
| Exa 外链预览（禁止 iframe） | `SearchResultsPage.tsx` → `ExaSourcePreview`；样式 `SearchResultsPage.css` |
| 首页历史「无可绘图数据」卡片 | `apps/web/src/components/RecentSearchCharts.tsx` |
| 无分析会话时的前端图表启发式 | `apps/web/src/utils/analysis-visualization.ts` → `datasetsFromSources` |
| 分析工作台（矩阵/图/报告） | `apps/web/src/DataAnalysisWorkspace.tsx` |
| 前端 API 封装 | `apps/web/src/api/data-analysis.ts`、`apps/web/src/api/research.ts` |
| **用户搜索总编排** | `apps/api/src/modules/search/search-orchestrator.service.ts` |
| 搜索 HTTP 路由 | `apps/api/src/modules/search/search-orchestrator.controller.ts` |
| 知识库分支 | `apps/api/src/modules/data-analysis/data-analysis.service.ts` |
| Exa 分支 | `apps/api/src/modules/external-search/external-search.service.ts` |
| 单分支 AI 检索核心 | `apps/api/src/modules/ai-query/ai-query.service.ts` |
| SQL / RAG / 语义路由 | `text-to-sql.service.ts`、`rag-query.service.ts`、`query-router.service.ts` |
| 语义解析（指标/实体/时间） | `apps/api/src/modules/semantic/semantic-resolution.service.ts` |
| Exa HTTP 调用 | `apps/api/src/research/exa-search.service.ts` |
| 证据落库 | `apps/api/src/modules/ai-query/evidence.service.ts` |
| 分析会话创建 / 标准化 | `apps/api/src/modules/analysis/analysis-session.service.ts` |
| 可视化数据集 / 报告构建 | `apps/api/src/modules/analysis/analysis-visualization.ts` |
| Markdown 研究报告（独立接口） | `apps/api/src/research/report.service.ts` |
| 上传解析结构化 | `apps/api/src/research/document-parser.service.ts` |
| Run / Source 持久化 | `apps/api/src/research/research.repository.ts` |
| 契约类型 | `packages/contracts/src/index.ts`（`researchSearchModeSchema`、`ResearchSource` 等） |
| 图表接口补充说明 | `docs/analysis-visualization.md` |

---

## 3. 阶段详解与落点

### 3.1 发起搜索

| 项 | 说明 |
|----|------|
| UI | `ResearchPage.search()`，默认 `mode: 'mixed'` |
| 路由跳转 | `App.tsx` 设 `pendingSearch` → `/results` |
| API | `POST /search/query` → `SearchOrchestratorController.search` |
| 前置 | 会员校验 + 扣积分；Redis 缓存；问句/filters 规范化 |

**检索模式（用户侧）：**

| mode | 行为 |
|------|------|
| `knowledge` | 仅知识库 |
| `exa` | 仅 Exa 联网 |
| `mixed` | 两边并行，再合并答案与 sources |

注意：用户 `mixed` ≠ QueryRouter 内部的 `hybrid`（后者是单分支内 SQL+RAG）。

### 3.2 多源检索（AiQuery 单分支）

入口：`AiQueryService.execute()`。

| 顺序 | Stage key | 做什么 | 关键服务 |
|------|-----------|--------|----------|
| 1 | `plan` | 优化问句、理解意图、拆分数据需求并选择相关网站 | `ResearchPlanningGraphService` + `DeepSeekChatService` |
| 2 | `search` | 仅执行当前轮选定网站的检索 | `ResearchRetrievalGraph` + `ExaSearchService` |
| 3 | `evaluate` | 检查指标、实体、年份、单位、币种和证据是否覆盖全部子目标 | `DeepSeekChatService.evaluateResearchEvidence` |
| 4 | `replan` | 证据不足时只针对缺口生成新查询，最多 5 轮 | `ResearchRetrievalGraph` |
| 5 | `plan` | Semantic Layer 解析结果和查询计划 | `SemanticResolutionService` |
| 3 | — | 路由 `structured` / `semantic` / `hybrid` | `QueryRouterService.route` |
| 4 | `database` | Text-to-SQL | `TextToSqlService.execute` |
| 5 | `vector` | Milvus RAG（语义路由，或 SQL 无结果回退） | `RagQueryService.search` |
| 6 | `exa` | 外部源检索 + 去重重排 | `ExaSearchService` |
| 7 | — | 基于证据生成答案 | `DeepSeekChatService.answerFromEvidence` |

**证据 → 前端来源**（`DataAnalysisService.evidenceToSources`）：

- SQL 证据 → `storageType: 'structured'`，带 `structuredData`
- 向量 / Exa → 多为 `storageType: 'knowledge'`，通常**无** `structuredData`

混合模式合并：`SearchOrchestratorService` 的 `Promise.allSettled` + `summarizeMixedAnswer`；结果写入 `ResearchRun.reportMarkdown` / `resultJson`。

### 3.3 Exa 来源预览与正文拉取

| 项 | 说明 |
|----|------|
| 搜索阶段 | `ExaSearchService.search` 请求最多 1500 字的文本摘要和问题相关 highlights，用于相关性筛选；完整正文仍按需拉取，`contentMode: 'deferred'` |
| 打开预览 | 用 `sourceUrl` **iframe 嵌网页**；站点禁止嵌入时引导新窗口打开 |
| 分析阶段（勾选后） | `ExaContentHydrationService.ensureFullText` 拉全文并落库，再做指标抽取 |
| 结果页预览 | `ExaSourcePreview`：网页链接嵌入，不是拉取全文展示 |
| 原因（iframe 失败） | 部分站点返回 `X-Frame-Options: DENY` |
| 知识库预览 | 仍走 `GET /search/sources/:sourceId/preview-url`（PDF/文档/表格） |

右侧「来源网站」与底部「打开原文」指向同一 `sourceUrl`。全文拉取只服务于分析抽取，不用于预览阅读。

### 3.4 数据提取与标准化

搜索入选证据前，知识库与 Exa 共用 `retrieval-relevance.ts`，分别检查指标、实体和地区维度（同维度多值为 OR）；保留语义目录别名、词典同义词和常用指标缩写。知识库先扩展相邻分块再筛选，避免表头和数值跨块时漏掉数据。重排返回非有限分数的候选不进入证据；有限分数用于排序，不使用未经校准的 0.15 硬阈值。重排不可用时使用维度筛选和原排序。年份仍用于排序，不要求摘要包含全部目标年份。未识别任何维度时不做文本维度硬过滤。

相关性分数只参与排序，不能覆盖指标或实体维度不匹配。Exa 候选全部不相关时返回空结果，不再用前三条候选兜底。搜索缓存使用 `v2` 命名空间，避免旧候选绕过新筛选。

发生在用户点击「生成数据分析表」之后，**不在**搜索主请求内自动完成。

| 项 | 说明 |
|----|------|
| 触发 | `SearchResultsPage.enterAnalysis()` → `POST /analysis/sessions` |
| 勾选 Exa 网站后 | 先 `hydrateExaFullText`（Exa Contents 拉全文并落库），再抽取 |
| 核心 | `AnalysisSessionService.prepare()`；先用 `selectIndicatorsForExtraction(query)` 按问句收窄目录 |
| 结构化源 | 按 `indicatorFieldMapping` / 指标编码名称 → `observations` |
| 纯文本源 | LLM `extractIndicators`（带用户问题 + preferredCodes；不再全目录盲抽） |
| 工作台默认指标 | `preferredIndicatorIds[0]`（如「GDP数据」→ 总量而非增速） |

抽取流程（2026-10-29 修复）：

1. 明确询问人均 GDP 时优先选择人均目录，避免被总量偏好过滤掉。
2. 已获取的长正文按最多 18000 字分段完整覆盖；相邻段保留重叠和文首上下文，避免尾部数据被摘要窗口遗漏。
3. 每段最多请求两次。请求失败，或该段提及的目标指标/年份未抽到时，只重试该段；合并已有有效观测，避免整篇重复调用。来源间并发上限仍为 6。
4. 引文校验绑定局部句子或表格行列，检查指标、年份和统计口径；表格引文须含表头、单位及数据行。
5. 所需指标/年份没有可用观测，或仍有分段请求失败时，结果标为 `partial` 并提示缺失，单元格保留空值。
6. 分析会话只复用 `pipelineVersion: 2` 且 `ready` 的结果；缓存匹配包括所选来源及指标。旧结果或不完整结果再次生成时重新分析。正文补全成功会清除旧的不可抽取标记，失败时本次返回即标记不可抽取。

长正文会增加模型请求数量和延迟；每段最多两次请求限制了重试次数，但没有限制整篇的总耗时。当前完整覆盖仅指已获取正文：直连抓取仍最多保留 50000 字。

后续流程优化重点：

- 保留 HTML/PDF 表格结构、合并表头和页码/行列坐标，减少纯文本空格切列的歧义。当前校验覆盖常见年份行和年份列，不能替代复杂表格解析。
- 补全度统计扩展为指标 × 实体 × 年份，目前按指标 × 年份检查，跨国家任务仍需核对主体覆盖。
- 将汇率改为带来源、版本及日期的配置数据。当前内置 2018–2025 年近似汇率，未配置年份无法换算；换算结果与官方美元统计值也可能因汇率口径而不同。
- 对长文分析采用异步任务及实际分段进度，缓解同步请求超时；累积真实样本评估检索相关性、抽取召回率与数值准确率。

### 3.5 图表

| 场景 | 逻辑 | 文件 |
|------|------|------|
| 有分析会话 | `buildVisualDatasets(observations)` | `analysis-visualization.ts`（API） |
| 仅搜索历史预览 | `datasetsFromSources(sources)`：需结构化行 + 可识别数值列 | `apps/web/src/utils/analysis-visualization.ts` |
| 空状态文案 | 「该搜索暂无可绘图的结构化数据」 | `RecentSearchCharts.tsx` |

典型无图原因：只有 Exa/向量文本、SQL skipped、或列名不符合数值启发式。

### 3.6 报告（三条路径）

| 类型 | 触发 | 实现 |
|------|------|------|
| 搜索即时答案 | 每次搜索结束 | `answerFromEvidence` / `summarizeBranchAnswers` → `reportMarkdown` |
| Markdown 研究报告 | `POST /research/report` | `ReportService.generate`（当前结果页未直接挂按钮） |
| 可视化分析报告 | 工作台生成报告 | `savePresentation(..., generateReport)` → `buildVisualReport` |

图表/报告 HTTP 细节另见 [`analysis-visualization.md`](./analysis-visualization.md)。

---

## 4. 主要 API 速查

| Method | Path | 用途 |
|--------|------|------|
| `POST` | `/search/query` | 用户搜索（长请求，前端约 300s） |
| `GET` | `/search/history` | 搜索历史 |
| `DELETE` | `/search/history/:runId` | 删一条历史 |
| `GET` | `/search/sources/:sourceId/preview-url` | 知识库文件预览（Exa 不可用） |
| `POST` | `/analysis/sessions` | 创建分析会话（标准化入口） |
| `POST` | `/analysis/sessions/recent` | 首页最近 4 条关联分析 |
| `GET` | `/analysis/sessions/:id` | 读会话 + visualDatasets |
| `PUT` | `/analysis/sessions/:id/presentation` | 存图表配置 |
| `POST` | `/analysis/sessions/:id/report` | 生成可视化报告 |
| `POST` | `/analysis/sessions/:id/export.xlsx` | 导出结构化行 |
| `POST` | `/research/report` | Markdown 研究报告 |
| `POST` | `/admin/search-test` | 管理端测试搜索（legacy） |

---

## 5. 常见改动场景 → 落点

| 场景 | 改哪里 |
|------|--------|
| 改默认检索模式 / 筛选 UI | `ResearchPage.tsx` |
| 混合合并策略 / 缓存 TTL / 积分 | `search-orchestrator.service.ts` |
| 何时走 SQL vs RAG | `query-router.service.ts` |
| SQL 生成或字段映射 | `text-to-sql.service.ts` + indicator field mapping 模块 |
| Exa 域名范围 / 重排 / 按需全文 | `exa-search.service.ts`（`search` 轻量；`getContents` 勾选后拉全文）+ `ai-query.service.ts` |
| Exa 链接缺 www 打不开 | 去重勿落库去 www；`alignExternalResultUrl` / 前端 `browsableExternalUrl` |
| 勾选后 / 预览拉网站全文 | `ExaContentHydrationService.ensureFullText` → `repository.updateSourceFullText` |
| 答案文风 / 证据截断 | `DeepSeekChatService` + `ai-query.service.ts` evidenceBlocks |
| 「无可绘图」判定过严/过松 | 前端 `datasetsFromSources`；后端 `buildVisualDatasets` |
| 文本抽指标不准 / 问句对不上指标 | `indicator-query-rank.ts` + `extractIndicators`（问句 narrowing）+ `AnalysisSessionService.prepare` |
| Exa 预览空白 / 想恢复 iframe 试探 | `ExaSourcePreview`（当前刻意不嵌外链） |
| 管理端单独测搜索 | `apps/admin/src/pages/SearchTestPage.tsx` |

---

## 6. 关键文件树

```text
apps/web/src/
  pages/ResearchPage.tsx
  pages/SearchResultsPage.tsx          # ExaSourcePreview
  pages/SearchResultsPage.css
  components/RecentSearchCharts.tsx
  components/SearchExecutionProgress.tsx
  search-progress.ts
  utils/analysis-visualization.ts
  DataAnalysisWorkspace.tsx
  api/data-analysis.ts
  api/research.ts

apps/api/src/
  modules/search/
    search-orchestrator.controller.ts
    search-orchestrator.service.ts
    search-normalization.ts
  modules/data-analysis/data-analysis.service.ts
  modules/external-search/external-search.service.ts
  modules/ai-query/
    ai-query.service.ts
    query-router.service.ts
    text-to-sql.service.ts
    rag-query.service.ts
    evidence.service.ts
  modules/semantic/semantic-resolution.service.ts
  modules/analysis/
    analysis-session.controller.ts
    analysis-session.service.ts
    analysis-visualization.ts
  research/
    exa-search.service.ts
    report.service.ts
    document-parser.service.ts
    research.repository.ts
    research.service.ts              # upload / report / admin 相关

packages/contracts/src/index.ts
docs/analysis-visualization.md
docs/one-stop-search-pipeline.md     # 本文件
```

---

## 7. 排查清单（GDP 类问题示例）

1. 看响应 `stages`：SQL 是 `completed` 还是 `skipped`？知识库 / Exa 哪条成功？  
2. 看 `sources`：有没有 `storageType: 'structured'` 且带数值列的 `structuredData`？  
3. 仅有 Exa 文本 → 首页会「无可绘图」；需勾选来源进分析，靠 `extractIndicators` 抽数。  
4. 中间预览空白 → 确认是否旧 iframe 逻辑；现应以摘要 + 新窗口打开为准。  
5. 新窗口也打不开 → 查 `sourceUrl` 是否完整、是否被弹窗拦截（与嵌入策略无关）。

---

## 8. 相关测试

- API 可视化：`pnpm --filter @agent/api test -- --runInBand analysis-visualization.spec.ts analysis-session.service.spec.ts`
- 前端历史图空状态：`apps/web/src/components/RecentSearchCharts.test.tsx`
- 类型检查：`pnpm --filter @agent/api typecheck`、`pnpm --filter @agent/web typecheck`
