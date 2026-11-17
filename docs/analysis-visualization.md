# 分析图表与结果接口

首页最近四条搜索、数据图表、分析结果统一使用 `AnalysisVisualDataset` 和 `AnalysisPresentation`。视图只支持 `line`（线路）、`map`（国家/地区色阶方块图）和 `table`。

## 数据与保存

- 创建分析会话时，将检索 `runId` 写入会话的 `resultJson`，不需要数据库结构迁移。
- `GET /api/v1/analysis/sessions/:id` 返回会话数据、规范化的 `visualDatasets`、保存的 `presentation` 和 `visualReport`。
- `PUT /api/v1/analysis/sessions/:id/presentation` 保存指标、地区、起止时期、当前时期、视图和报告图表选择。已有报告会按新筛选同步更新；筛选没有有效数值时清除旧报告。
- `POST /api/v1/analysis/sessions/:id/report` 使用同一配置生成并保存统计分析结果，无有效数值时返回 400。
- `POST /api/v1/analysis/sessions/recent` 接收 `{ "runIds": ["run-id"] }`，最多四条，返回当前用户在各次检索下最近更新的分析会话。

配置示例（`datasetId` 必须来自 `visualDatasets`）：

```json
{
  "datasetId": "[\"gdp\",\"%\"]",
  "entities": ["中国", "印度"],
  "startPeriod": "2019",
  "endPeriod": "2025",
  "currentPeriod": "2025",
  "view": "line",
  "reportViews": ["line", "map", "table"]
}
```

接口通过当前登录用户限定会话访问，校验指标和地区归属、时间范围与视图类型。不同单位分开展示；同一指标、地区、时期存在多个不同数值时标记冲突并留空，缺失和冲突值不计入统计。

## 页面流程

1. 搜索结果选择数据来源，创建分析会话。
2. 图表页调整国家/地区、指标和年份，切换线路、地图、表格。
3. 保存图表或生成分析结果，将配置持久化。报告包括统计、排名、起止变化、分布差异、数据质量、来源和研究边界。
4. 首页按搜索时间选取最近四条记录，读取其分析会话并使用同一组件渲染。尚未生成分析会话的记录仅展示结构化搜索数据预览；没有结构化数据则显示空状态。
5. 分析结果可以按所选视图导出含内嵌 SVG 的 HTML 报告，单个视图支持 PNG/SVG 导出。

旧会话若未存储 `runId`，不会仅凭相同的搜索文本关联到其他检索。重新从该搜索创建分析会话后即可建立关联。

## World Bank 官方数据补充

创建分析会话时，若勾选的来源 URL 属于 HTTPS `worldbank.org` 或其子域名，且该来源尚无结构化记录，分析流程会按问题中的国家、指标和年份调用 World Bank 官方 API。只根据 URL 主机名识别，不信任网页标题或相似域名；请求始终发往固定的 `api.worldbank.org`。

- 多个 World Bank 网页在同一次分析中共用一次取数流程，每个指标请求一次（失败最多重试一次）。同一批 API 记录只关联到一个已选来源，优先关联对应指标页面；保留原始来源 ID、正文及访问权限校验。
- `近5年` 使用最近五个完整自然年；例如 2026 年查询对应 2021–2025 年。单独指定年份和不连续年份也按请求范围筛选。
- 官方指标代码按明确的目录代码映射；区分 GDP 总量、人均 GDP 和 GDP 增速。国家无法识别或明确请求省市数据时，不自动替换成全球或全国数据。
- 官方 API 的空值、异常数值、错误国家/指标、范围外年份不计入观测；不补造尚未发布的数据。某指标请求失败时保留其他指标的成功结果，未覆盖的指标继续使用原有正文抽取。
- 数据行保留 `sourceUrl`（实际 API 地址）、`worldBankIndicatorCode`（官方指标代码）、`originalValue`、`originalUnit`。来源摘要说明通过官方 API 补充的记录数；图表、明细和 Excel 导出使用相同的目录单位（例如美元换算为万亿美元）。
- 补充结果保存在分析会话中，不修改原始检索来源或检索记录，不需要数据库迁移。分析流水线版本为 `5`；从搜索结果重新创建分析时会重建旧版会话，直接读取已有会话不会自动重新取数。

部署环境必须能够访问 `https://api.worldbank.org`。请求超时或无可用官方数据时，日志会记录失败，流程继续使用网页正文抽取，结果仍可能为 `partial`。仅能访问 `data.worldbank.org` 网页不代表可以访问 API。

## 验证

- API：`pnpm --filter @agent/api test -- --runInBand world-bank-data.service.spec.ts analysis-visualization.spec.ts analysis-session.service.spec.ts unit-normalize.spec.ts`
- 前端：`pnpm --filter @agent/web test`
- 类型检查：`pnpm --filter @agent/api typecheck`、`pnpm --filter @agent/web typecheck`
- 浏览器回归覆盖三视图、空选择、时间切换、配置回显、PNG/SVG 导出、报告内嵌图表、首页关联及桌面/手机布局。
