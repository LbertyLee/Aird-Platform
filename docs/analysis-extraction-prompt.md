# 分析抽取：提示词与原文说明

> 对应能力：勾选来源 →「生成数据分析表」→ `AnalysisSessionService.prepare` → `DeepSeekChatService.extractIndicators`  
> 用户问题示例：`请你帮我分析一下近5年 中国每一年的GDP数据`

---

左侧「国家/地区」「时间」筛选项**优先由用户研究问题解析**（`queryDimensions`），不再等网站抽到观测才出现。

数值单元格仍以来源抽取的 `observations` 为准；问题只负责填维度骨架（如中国 × 2021–2025）和优先指标。

---

## 1. 维度从哪来？

| 你期望 | 实际机制 |
|--------|----------|
| 国家 = 中国 | 从问句解析（`inferQueryDimensionHints`）→ `queryDimensions.entities` → 左侧筛选 |
| 时间 = 近5年每年 | 从问句「近 N 年」展开 → `queryDimensions.periods` → 左侧筛选 / 表头 |
| 指标 = GDP 总量 | `indicator-query-rank` → `preferredIndicatorIds` / `availableIndicators` |

来源正文抽取得到的 `entity`/`period` **只补充**筛选项与填数值，不覆盖问句骨架。

---

## 2. System 提示词（核心规则）

```text
你是严谨的研究数据抽取器。只从给定文档原文中抽取后台指标目录里的明确数值。
只能使用目录中的 indicatorCode，不能编造指标、数值、期间或实体；找不到就返回空数组。
保留原文数值和单位、期间、实体及逐字引用的最短证据片段；百分比不要改成小数，不要自行换算数值。
若提供了用户研究问题与 preferred 指标，优先抽取与问题直接相关的指标。
GDP 总量默认现价/名义值；不变价、可比价或按基期价格计算的 GDP 金额不能映射为现价 GDP。
明确要 GDP 增速时，只抽有增速语义和百分比单位的实际增长率；不变价 GDP 金额本身不是增速。
同篇文档出现不同口径时，按数值所在句子/表格标题及注释判断；人均、占比、指数、预测值也不得混作总量。
只输出严格 JSON：{"items":[{"indicatorCode":"...","value":123,"unit":"...","period":"2024","entity":"...","evidence":"..."}]}
```

代码：`apps/api/src/infrastructure/ai/deepseek-chat.service.ts` → `extractIndicators`

模型返回后，`indicator-extraction-validation.ts` 还会核对证据是否逐字出现在原文、数值是否在证据中、金额/百分比及总量/增速/人均/占比口径是否一致。未通过的条目直接舍弃，不写入分析观测。

---

## 3. User 提示词模板（现行）

```text
用户研究问题：{query}

优先指标编码：{preferredCodes}

期望实体/国家：中国（原文未写明时可用问题中的主体）
期望年份：2021、2022、2023、2024、2025（按问题时间范围逐条抽取；原文没有的年份不要编造）
每条观测必须尽量填写 period（四位年份）与 entity；与问题主体/年份明显无关的数值不要抽取。

来源标题：{source.title}

来源类型：{source.origin}

来源地址：{source.sourceUrl}

后台指标目录：{JSON.stringify(catalog)}

文档原文：{当前正文分段，最多 18000 字，含重叠及文首上下文}
```

（「期望实体/年份」由 `inferQueryDimensionHints(query)` 生成；近 N 年默认取**已结束的**最近 N 个自然年。）
---

## 4. 「文档原文」从哪来

```text
搜索阶段：只存 title/url（不存正文）
    ↓ 勾选并生成分析表
Exa Contents 拉全文 → ResearchSource.textContent（最多约 5 万字）
    ↓
extractIndicators：对已获取正文分段完整覆盖，每段最多 18000 字
    ↓
每段抽取 → 引文/指标/年份/口径校验 → 对失败或缺失目标补查一次
    ↓
合并去重，保留成功分段；缺失指标/年份或分段失败时标记 partial
```

若全文拉取失败，来源会标记 `extractionUnavailable`，禁止将残留标题作为正文抽取。再次拉取成功后清除该标记。正文可用但未抽到明确值时，会报：

> 已完成逐篇指标抽取，但正文中未发现后台指标目录内的明确数值。

统计局稿件里 GDP 常见单位是 **亿元人民币**，目录指标 `gdp_current_usd` 单位是 **美元**。提示词要求按原值和原单位抽取，目录使用 `displayUnit` 表示展示目标，由平台随后换算；不能为适配目录单位让模型换算或漏抽。

分段补查只针对段内提及且尚未抽到的目标，不要求模型补出原文没有的年份。每段最多两次请求，成功结果不会因另一段失败而丢弃。表格证据必须逐字包含表头、单位及数据行，校验会核对年份和指标对应的行列，而非仅检查引文中是否出现该数字。

---

## 5. 对本问句，一次请求长什么样（示意）

**用户问题：**

`请你帮我分析一下近5年 中国每一年的GDP数据`

**理想 preferred（修复后应接近）：**

`gdp_current_usd`

**你截图里曾出现的 preferred（过宽，有 bug）：**

`gdp_current_usd, goods_exports, goods_imports, gdp_per_capita, world_population, cab_gdp...`

过宽原因：打分里 `LEVEL_RE` 含「美元」，凡单位/定义为美元的指标（出口、进口等）在「要总量」时被一并加分。

**User 消息结构示例：**

```text
用户研究问题：请你帮我分析一下近5年 中国每一年的GDP数据

优先指标编码：gdp_current_usd, goods_exports, ...

来源标题：国家统计局：2023年四季度和全年国内生产总值初步核算结果 - 国家统计局

来源类型：exa

来源地址：https://www.stats.gov.cn/...

后台指标目录：[{"code":"gdp_current_usd","name":"国内生产总值(现价美元)",...}, ...]

文档原文：……（Exa 拉回正文的当前分段；正文不可用时不送入模型）……
```

---

## 6. 为何左侧曾是 0/0

旧逻辑：筛选项只从 `observations` 聚合 → 抽不到数就 0/0。  
现逻辑：`queryDimensions` 先从问句填实体/年份；抽到数后再补数值单元格。

---

## 7. 相关代码索引

| 环节 | 文件 |
|------|------|
| 问句收窄指标 | `apps/api/src/modules/analysis/indicator-query-rank.ts` |
| 创建会话 / 调抽取 | `apps/api/src/modules/analysis/analysis-session.service.ts` |
| 提示词与分段抽取 | `apps/api/src/infrastructure/ai/deepseek-chat.service.ts`、`extraction-excerpt.ts` |
| 分段补查目标与证据校验 | `apps/api/src/infrastructure/ai/extraction-coverage.ts`、`indicator-extraction-validation.ts` |
| Exa 按需全文 | `apps/api/src/research/exa-content-hydration.service.ts` |

---

## 8. 开发期如何查看「提示词 + 原文」

重新「生成数据分析表」后：

1. **工作台 UI**：矩阵页异常提示下方 → **「LLM 抽取调试」**，可切换来源，查看 System / User / 文档原文 / 模型响应，并一键复制。
2. **会话 JSON**：`AnalysisSession.resultJson.llmExtractionTraces[]`（随 `GET /analysis/sessions/:id` 返回）。
3. **本地文件**（默认非 production 开启）：`apps/api/.tmp/llm-extraction-traces/<时间戳>/`
   - 每个来源一份 `.json` + 可读的 `.md`
   - `index.json` 索引  
   - 关闭：环境变量 `LLM_EXTRACTION_TRACE=false`

每个来源的 trace 新增 `passes[]`，保留各分段初次请求及补查的提示词、响应和错误；`attemptCount` 是该来源实际请求总数。分析会话仅复用新流程版本的完整结果；旧会话及 `partial` 会话重新生成时会重新抽取。
