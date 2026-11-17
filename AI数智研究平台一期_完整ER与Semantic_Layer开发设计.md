# AI数智研究平台一期：数据资产 + Semantic Layer + AI知识库完整技术设计

> **文档用途**
>
> 本文档用于直接交给 AI Coding Agent / AI 开发助手执行一期系统开发。
> 开发时应以本文档作为架构与数据模型基线，不应擅自改变核心技术栈和核心数据关系。
>
> **一期核心技术栈**
>
> - Backend：NestJS + TypeScript
> - Main Database：PostgreSQL
> - Vector Database：Milvus
> - Object Storage：MinIO
> - Async Queue：Redis + BullMQ
> - Document Parsing：Unstructured
> - OCR：PaddleOCR（按需）
> - Data Analysis：DuckDB / Polars（按需）
> - AI：LLM + Embedding Model + Reranker
>
> **核心原则**
>
> 1. PostgreSQL 是业务事实、元数据、数据资产、语义层和查询状态的权威数据库。
> 2. MinIO 保存原始文件、文档原件、中间文件及导出文件。
> 3. Milvus 只负责向量检索，不作为业务事实数据库。
> 4. NestJS 统一负责 API、数据接入编排、AI Query Engine 和外部搜索 API 调度。
> 5. 大文件和耗时任务必须异步化，使用 Redis + BullMQ。
> 6. 数据版本不可覆盖；AI 默认只查询 READY 的有效版本。
> 7. 不把 LLM 当作业务规则数据库；业务指标和语义映射必须沉淀到 Semantic Layer。
> 8. PostgreSQL、Milvus、MinIO 不做跨系统强一致事务，采用 PostgreSQL 状态机 + 异步最终一致性。
> 9. 外部搜索/API 获取的数据，在允许的情况下必须沉淀到内部知识库，以便后续优先复用。
> 10. 一期不要为了“看起来先进”而引入 Kafka、Flink、Spark、ClickHouse、Elasticsearch/OpenSearch、Neo4j 等复杂组件，除非明确出现规模或业务需求。

---

# 1. 项目目标

构建一个 AI 数智研究平台一期，实现：

```text
CSV / Excel / PDF / Word / PPTX / API / 搜索引擎
                         ↓
                    数据接入层
                         ↓
                MinIO 原始数据
                         ↓
                解析 / 清洗 / 标准化
                         ↓
                 PostgreSQL 数据资产
                         ↓
                  Semantic Layer
                         ↓
             ┌───────────┴───────────┐
             ↓                       ↓
        PostgreSQL                Milvus
        结构化数据                向量知识库
             └───────────┬───────────┘
                         ↓
                    AI Query Engine
                         ↓
                  Rerank / Evidence
                         ↓
                       LLM
                         ↓
                     研究结论
```

系统必须能够做到：

- 多来源异构数据接入
- 数据集与版本管理
- Schema 自动识别
- 字段标准化与映射
- 数据质量检查
- 文档解析与 Chunk
- Embedding 与 Milvus 建索引
- Semantic Layer 业务语义统一
- SQL / RAG / Hybrid Query
- 查询证据追踪
- 数据血缘追踪
- 外部搜索/API 数据回流知识库
- 后续扩展更多数据源

---

# 2. 总体架构

```text
                         ┌─────────────────────┐
                         │       Frontend      │
                         └──────────┬──────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │       NestJS        │
                         │    API Gateway      │
                         └──────────┬──────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
              ▼                     ▼                     ▼
       Data Ingestion          Knowledge Service       AI Query
              │                     │                     │
              ▼                     ▼                     ▼
           MinIO                 PostgreSQL           Query Router
              │                     │                     │
              ▼                     │             ┌───────┴───────┐
       Parser / ETL                 │             ▼               ▼
              │                     │        Structured       Semantic/RAG
              ▼                     │             │               │
        Normalization               │             ▼               ▼
              │                     │        PostgreSQL         Milvus
              └─────────────────────┴─────────────┬───────────────┘
                                                  ▼
                                               Reranker
                                                  │
                                                  ▼
                                               Evidence
                                                  │
                                                  ▼
                                                  LLM
```

---

# 3. 三大存储职责

## 3.1 MinIO

定位：

> 原始数据和文件的对象存储。

保存：

- 原始 CSV
- 原始 Excel
- PDF
- Word
- PPTX
- 原始 API 响应
- 搜索引擎原始结果
- 中间转换文件
- Parquet
- 导出文件

原则：

- 原始文件尽量不可修改
- 使用 checksum / SHA256 防重复
- PostgreSQL 保存 MinIO Object Path
- 不把大量原始文件内容直接存 PostgreSQL

示例：

```text
bucket:
raw-data

objects:
raw-data/
  datasets/
    {dataset_id}/
      versions/
        {version_id}/
          source.csv

  documents/
    {document_id}/
      versions/
        {version_id}/
          original.pdf

  external-search/
    {search_id}/
      response.json
```

---

# 4. PostgreSQL 定位

PostgreSQL 是系统的：

> **业务事实 + 元数据 + Semantic Layer + AI 查询状态权威数据库。**

负责：

- Data Source
- Dataset
- Dataset Version
- Schema
- Field
- 数据质量
- ingestion Job
- Document
- Document Version
- Document Chunk 元数据
- Metric
- Entity
- Dimension
- Concept
- Semantic Mapping
- Semantic Relation
- AI Query
- Semantic Query
- Query Evidence
- 数据血缘

---

# 5. Milvus 定位

Milvus 负责：

> **Embedding Vector Search**

推荐 Collection：

```text
knowledge_chunks
```

核心字段：

```text
id
embedding
chunk_id
document_id
document_version_id
```

可选过滤字段：

```text
tenant_id
dataset_id
knowledge_type
document_type
year
industry
region
company
```

Milvus 返回：

```text
chunk_id
score
```

然后 NestJS 根据 chunk_id 去 PostgreSQL 获取：

- 原文
- 来源
- 文档
- 版本
- 页码
- section
- metadata

---

# 6. 数据接入生命周期

所有数据接入必须支持版本。

```text
UPLOAD
  ↓
UPLOADED
  ↓
PARSING
  ↓
SCHEMA_DETECTED
  ↓
VALIDATING
  ↓
NORMALIZED
  ↓
INDEXING
  ↓
READY
```

失败：

```text
任意状态
  ↓
FAILED
```

要求：

- Job 可重试
- 操作幂等
- 原始文件不可覆盖
- READY 才能被 AI 查询
- PostgreSQL 保存当前状态
- Milvus 索引失败不能破坏 PostgreSQL 数据

---

# 7. 数据分层

采用 Bronze / Silver / Gold。

## Bronze

原始层：

```text
MinIO
```

特点：

- 原始
- 不修改
- 可追溯
- 可重新处理

## Silver

标准化层：

```text
PostgreSQL
```

包括：

- 类型转换
- 字段映射
- 去重
- 标准化
- 数据质量处理

## Gold

面向 AI 查询的业务层：

例如：

```text
customer_summary
customer_monthly_revenue
industry_statistics
regional_sales
company_financial_summary
```

AI 查询优先使用 Gold。

---

# 8. Dataset 数据模型

Dataset 表示一个逻辑数据集。

例如：

```text
sales
customer
industry_report
company_financial
```

建议字段：

```text
id
code
name
description
data_source_id
data_type
status
owner_id
created_at
updated_at
```

---

# 9. Dataset Version

数据不能直接覆盖。

例如：

```text
sales
 ├── v1
 ├── v2
 └── v3
```

建议字段：

```text
id
dataset_id
version
checksum
raw_object_path
status
is_current
row_count
size_bytes
created_at
created_by
```

约束：

```text
UNIQUE(dataset_id, version)
```

---

# 10. Dataset Schema

用于描述某一个版本的数据结构。

```text
dataset_schema
-----------------------
id
dataset_version_id
schema_json
schema_hash
detected_at
created_at
```

---

# 11. Dataset Field

记录具体字段。

```text
dataset_field
-----------------------
id
dataset_schema_id
field_name
display_name
data_type
semantic_type
description
unit
nullable
is_primary_key
ordinal
sample_values
created_at
updated_at
```

示例：

```text
field_name: sales_amount
display_name: 销售额
data_type: decimal
semantic_type: metric
unit: CNY
```

---

# 12. Schema Registry

Schema Registry 用于解决：

> 数据长什么样。

例如：

```text
customer_id
customer_name
sales_amount
region_code
```

它与 Semantic Layer 不同。

```text
Schema Registry
    ↓
描述字段结构

Semantic Layer
    ↓
解释业务含义
```

---

# 13. 字段标准化

不同来源：

```text
客户编号
customer_id
cust_no
customerNo
```

统一：

```text
customer_id
```

不同来源：

```text
销售额
sales_amount
amount
revenue
```

需要通过业务规则确定是否统一成：

```text
revenue
```

不能只依赖 LLM 猜测。

---

# 14. Semantic Layer 总体设计

Semantic Layer 是：

> **自然语言和真实数据资产之间的业务语义桥梁。**

核心对象：

```text
Metric
Entity
Dimension
Concept
Time
Mapping
Relation
```

整体：

```text
用户问题
   ↓
Query Understanding
   ↓
Semantic Layer
   ↓
标准业务语义
   ↓
Data Mapping
   ↓
Dataset / Field / Knowledge
   ↓
Query Planner
```

---

# 15. Metric 指标

Metric 是 Semantic Layer 最核心对象。

例如：

```text
销售额
营收
营业收入
Revenue
```

业务上可能对应：

```text
metric = revenue
```

Metric 建议字段：

```text
id
code
name
description
business_definition
data_type
unit
default_aggregation
formula
status
version
created_at
updated_at
```

示例：

```json
{
  "code": "revenue",
  "name": "营业收入",
  "business_definition": "企业在统计周期内实现的营业收入",
  "unit": "CNY",
  "default_aggregation": "SUM",
  "formula": "SUM(revenue)"
}
```

---

# 16. Metric Alias

用于自然语言映射。

```text
metric_alias
-----------------------
id
metric_id
alias
alias_type
confidence
created_at
```

示例：

```text
销售额 → revenue
营收 → revenue
收入 → revenue
营业收入 → revenue
Revenue → revenue
```

---

# 17. Metric Definition

Metric 允许有多个业务定义/版本。

```text
metric_definition
-----------------------
id
metric_id
formula
business_rule
unit
aggregation
filter_condition
version
status
created_at
updated_at
```

例如：

```text
营业收入
=
SUM(revenue)
```

或者：

```text
净收入
=
SUM(revenue - refund)
```

业务定义不能由 LLM 临时创造。

---

# 18. Metric Field Mapping

Metric 与真实数据库字段之间的桥梁。

```text
metric_field_mapping
-----------------------
id
metric_id
dataset_field_id
aggregation
formula
condition
priority
status
created_at
updated_at
```

关系：

```text
metric
  │
  │ 1:N
  ▼
metric_field_mapping
  │
  │ N:1
  ▼
dataset_field
```

示例：

```text
metric: revenue
   │
   ├── sales_2025.sales_amount
   ├── sales_2024.amount
   └── finance.operating_income
```

---

# 19. Entity 实体

Entity 解决：

> 用户说的是谁。

例如：

```text
比亚迪
BYD
比亚迪集团
```

统一：

```text
entity = BYD
```

字段：

```text
entity
-----------------------
id
code
name
canonical_name
entity_type
external_id
description
status
created_at
updated_at
```

---

# 20. Entity Alias

```text
entity_alias
-----------------------
id
entity_id
alias
alias_type
confidence
created_at
```

例如：

```text
比亚迪 → BYD
BYD → BYD
比亚迪集团 → BYD
```

---

# 21. Dimension 维度

Dimension 解决：

> 按什么维度分析。

例如：

```text
地区
行业
产品
客户
渠道
部门
时间
```

字段：

```text
dimension
-----------------------
id
code
name
description
data_type
hierarchy_enabled
status
created_at
updated_at
```

---

# 22. Dimension Value

维度具体值。

```text
dimension_value
-----------------------
id
dimension_id
code
name
parent_id
level
path
status
created_at
updated_at
```

支持树形层级：

```text
中国
 ├── 华东
 │    ├── 上海
 │    ├── 江苏
 │    └── 浙江
 ├── 华南
 └── 华北
```

`parent_id` 自关联。

---

# 23. Concept 业务概念

Concept 用于业务领域概念。

例如：

```text
新能源汽车
消费电子
高端制造
AI产业
海外市场
核心客户
```

字段：

```text
concept
-----------------------
id
code
name
concept_type
description
status
created_at
updated_at
```

---

# 24. Concept Alias

```text
concept_alias
-----------------------
id
concept_id
alias
alias_type
confidence
created_at
```

例如：

```text
新能源汽车
新能源车
NEV
新能源汽车行业
```

统一：

```text
new_energy_vehicle
```

---

# 25. Semantic Relation

用于表达语义对象之间的关系。

```text
semantic_relation
-----------------------
id
source_type
source_id
relation_type
target_type
target_id
weight
confidence
description
created_at
```

示例：

```text
新能源汽车
    │
    ├── belongs_to → 汽车行业
    ├── related_metric → revenue
    └── related_entity → BYD
```

一期不要求 Neo4j。

PostgreSQL 即可。

---

# 26. Time 时间语义

时间需要标准化，不能完全交给 LLM。

例如：

```text
去年
今年
2025年
2025年第一季度
上半年
过去三个月
```

统一成：

```json
{
  "type": "RANGE",
  "start": "2025-01-01",
  "end": "2025-12-31"
}
```

或者：

```json
{
  "type": "YEAR",
  "value": 2025
}
```

Query Engine 使用标准时间对象生成 SQL。

---

# 27. Document 文档

文档属于知识库域。

```text
document
-----------------------
id
dataset_id
title
document_type
source_url
author
publish_date
status
created_at
updated_at
```

---

# 28. Document Version

```text
document_version
-----------------------
id
document_id
version
minio_object_path
checksum
file_size
status
created_at
created_by
```

---

# 29. Document Chunk

文档经过解析后切成语义 Chunk。

```text
document_chunk
-----------------------
id
document_version_id
chunk_index
content
page_number
section
token_count
milvus_id
metadata_json
created_at
```

Chunk 原则：

不要简单按照固定字符切割。

优先：

```text
标题
 ↓
章节
 ↓
段落
 ↓
表格
 ↓
语义 Chunk
```

必须保留：

```text
document_id
document_version_id
page_number
section
chunk_index
```

用于最终证据追踪。

---

# 30. Milvus Collection

Collection：

```text
knowledge_chunks
```

建议：

```text
id
embedding
chunk_id
document_id
document_version_id
dataset_id
knowledge_type
document_type
year
industry
region
company
```

其中：

```text
embedding
```

用于向量检索。

其余字段主要用于过滤。

详细业务 metadata 仍以 PostgreSQL 为准。

---

# 31. Knowledge Relation

建立知识 Chunk 与业务语义对象的关系。

```text
knowledge_relation
-----------------------
id
source_type
source_id
relation_type
target_type
target_id
confidence
created_at
```

例如：

```text
document_chunk
    │
    ├── mentions → entity:BYD
    ├── discusses → concept:NEV
    └── describes → metric:revenue
```

---

# 32. AI Query

记录用户每次 AI 查询。

```text
ai_query
-----------------------
id
user_id
session_id
user_query
intent
status
query_plan_json
answer
created_at
completed_at
```

用于：

- 审计
- 调试
- 追踪
- 答案复盘

---

# 33. Semantic Query

保存 AI 对用户问题的标准语义解析结果。

```text
semantic_query
-----------------------
id
ai_query_id
metrics_json
entities_json
dimensions_json
concepts_json
time_json
resolved_query_json
confidence
created_at
```

例如用户：

```text
2025年华东新能源汽车销售额是多少？
```

解析为：

```json
{
  "metrics": [
    {
      "code": "revenue"
    }
  ],
  "dimensions": [
    {
      "code": "region",
      "value": "EAST"
    }
  ],
  "concepts": [
    {
      "code": "new_energy_vehicle"
    }
  ],
  "time": {
    "type": "YEAR",
    "value": 2025
  }
}
```

---

# 34. Query Evidence

AI 答案必须可追溯。

```text
query_evidence
-----------------------
id
ai_query_id
evidence_type
source_type
source_id
sql
content
score
metadata_json
created_at
```

支持：

```text
SQL Evidence
Document Evidence
Milvus Evidence
External API Evidence
```

---

# 35. 数据血缘

最终必须能够实现：

```text
AI Answer
    ↓
Evidence
    ↓
SQL / Document Chunk
    ↓
Metric / Field
    ↓
Dataset Version
    ↓
Original File
    ↓
MinIO
```

文档型：

```text
Answer
 ↓
Document Chunk
 ↓
Document Version
 ↓
Document
 ↓
MinIO Original
```

结构化数据：

```text
Answer
 ↓
SQL
 ↓
Metric
 ↓
Dataset Field
 ↓
Dataset Version
 ↓
Original File
```

---

# 36. AI Query Router

AI Query Router 是查询核心。

流程：

```text
User Query
    ↓
Query Understanding
    ↓
Semantic Resolution
    ↓
Query Router
    │
    ├── Structured
    │      ↓
    │  PostgreSQL
    │
    ├── Semantic
    │      ↓
    │  Milvus
    │
    └── Hybrid
           ↓
     PostgreSQL + Milvus
```

---

# 37. Structured Query

例如：

```text
2025年华东销售额是多少？
```

优先：

```text
Semantic Layer
 ↓
Metric = revenue
Dimension = region
Value = EAST
Time = 2025
 ↓
Schema Retrieval
 ↓
Text-to-SQL
 ↓
SQL Validation
 ↓
PostgreSQL
```

禁止：

> 把整个数据库 Schema 全部塞给 LLM。

应该先做 Schema Retrieval。

---

# 38. Semantic Query

例如：

```text
2025年新能源汽车行业为什么增长？
```

流程：

```text
用户问题
 ↓
Semantic Resolution
 ↓
Entity / Concept / Time
 ↓
Milvus Vector Search
 ↓
Metadata Filter
 ↓
Rerank
 ↓
Evidence
 ↓
LLM
```

---

# 39. Hybrid Query

例如：

```text
2025年我们公司的新能源汽车业务为什么低于行业平均？
```

需要：

```text
公司自身数据
    ↓
PostgreSQL

行业报告 / 政策 / 市场研究
    ↓
Milvus

        ↓
     Hybrid
        ↓
      Rerank
        ↓
     Evidence
        ↓
       LLM
```

---

# 40. 外部搜索 API

当内部数据不足时：

```text
用户问题
 ↓
Query Router
 ↓
内部 PostgreSQL
 ↓
内部 Milvus
 ↓
判断数据是否充分
 ↓
不足
 ↓
External Search API
```

外部搜索结果必须：

```text
API
 ↓
原始响应
 ↓
MinIO
 ↓
PostgreSQL metadata
 ↓
Document
 ↓
Document Version
 ↓
Document Chunk
 ↓
Embedding
 ↓
Milvus
```

从而实现：

```text
第一次：
外部搜索 → 回答

第二次：
内部知识库 → 优先回答
```

---

# 41. 外部数据优先级

默认：

```text
Priority 1
PostgreSQL Gold / Structured Data

Priority 2
Milvus Internal Knowledge

Priority 3
External Search/API
```

如果内部数据已经足够：

```text
禁止无意义调用外部 API
```

如果外部数据被调用：

```text
尽量沉淀为内部知识
```

---

# 42. 数据质量

CSV / Excel 等结构化数据至少检查：

```text
空值
重复
类型异常
日期异常
数值异常
枚举异常
主键重复
字段缺失
异常值
```

建议：

```text
data_quality_result
-----------------------
id
dataset_version_id
rule_code
rule_name
status
error_count
warning_count
details_json
created_at
```

---

# 43. ingestion_job

所有数据接入必须异步。

```text
ingestion_job
-----------------------
id
dataset_version_id
job_type
status
current_step
progress
retry_count
error_message
started_at
completed_at
created_at
```

状态：

```text
PENDING
RUNNING
SUCCESS
FAILED
CANCELLED
```

---

# 44. Redis + BullMQ

HTTP 请求不能同步执行大型导入。

API：

```http
POST /datasets/upload
```

立即返回：

```json
{
  "jobId": "xxx",
  "status": "PENDING"
}
```

后台：

```text
BullMQ
 ↓
Parse
 ↓
Profile
 ↓
Quality
 ↓
Normalize
 ↓
Load
 ↓
Chunk
 ↓
Embedding
 ↓
Milvus Index
 ↓
READY
```

查询：

```http
GET /ingestion-jobs/:id
```

---

# 45. NestJS 模块建议

```text
src/
├── datasource/
│   ├── datasource.module.ts
│   ├── datasource.controller.ts
│   └── datasource.service.ts
│
├── dataset/
│   ├── dataset.module.ts
│   ├── dataset.controller.ts
│   └── dataset.service.ts
│
├── ingestion/
│   ├── ingestion.module.ts
│   ├── ingestion.controller.ts
│   ├── ingestion.service.ts
│   ├── queues/
│   ├── workers/
│   ├── csv/
│   ├── excel/
│   ├── document/
│   └── api/
│
├── storage/
│   └── minio/
│
├── schema/
│   ├── schema-detection/
│   ├── schema-mapping/
│   └── schema-registry/
│
├── quality/
│
├── knowledge/
│   ├── document/
│   ├── chunk/
│   ├── embedding/
│   └── milvus/
│
├── semantic/
│   ├── metric/
│   ├── entity/
│   ├── dimension/
│   ├── concept/
│   ├── relation/
│   └── resolution/
│
├── ai/
│   ├── query-understanding/
│   ├── query-router/
│   ├── schema-retrieval/
│   ├── text-to-sql/
│   ├── rag/
│   ├── hybrid/
│   ├── reranker/
│   ├── evidence/
│   └── answer/
│
├── search/
│   ├── providers/
│   ├── search.service.ts
│   └── search-cache/
│
└── common/
    ├── enums/
    ├── exceptions/
    ├── guards/
    ├── utils/
    └── database/
```

---

# 46. 完整 ER 关系

核心数据关系：

```text
data_source
    │
    │ 1:N
    ▼
dataset
    │
    │ 1:N
    ▼
dataset_version
    │
    ├───────────────┐
    │               │
    │ 1:N           │ 1:N
    ▼               ▼
dataset_schema   ingestion_job
    │
    │ 1:N
    ▼
dataset_field
    │
    │ N:1
    ▼
metric_field_mapping
    │
    │ N:1
    ▼
metric
    │
    ├── 1:N metric_alias
    └── 1:N metric_definition
```

Entity：

```text
entity
   │
   └── 1:N entity_alias
```

Dimension：

```text
dimension
   │
   └── 1:N dimension_value
                     │
                     └── parent_id 自关联
```

Concept：

```text
concept
   │
   └── 1:N concept_alias
```

Semantic：

```text
metric
entity
dimension
concept
   │
   └── semantic_relation
```

Knowledge：

```text
dataset
   │
   ▼
document
   │
   ▼
document_version
   │
   ▼
document_chunk
   │
   ├── milvus_id → Milvus
   │
   └── knowledge_relation
```

AI：

```text
ai_query
   │
   │ 1:1
   ▼
semantic_query
   │
   │ 1:N
   ▼
query_evidence
```

---

# 47. 完整 ER ASCII 图

```text
┌────────────────┐
│  data_source   │
└───────┬────────┘
        │ 1:N
        ▼
┌────────────────┐
│    dataset     │
└───────┬────────┘
        │ 1:N
        ▼
┌────────────────────┐
│  dataset_version   │
└─────┬──────────────┘
      │
      ├───────────────┐
      │               │
      ▼               ▼
┌──────────────┐ ┌───────────────┐
│dataset_schema│ │ ingestion_job │
└──────┬───────┘ └───────────────┘
       │ 1:N
       ▼
┌─────────────────┐
│ dataset_field   │
└────────┬────────┘
         │
         │ N:1
         ▼
┌────────────────────────┐
│metric_field_mapping    │
└───────────┬────────────┘
            │ N:1
            ▼
       ┌──────────┐
       │  metric  │
       └────┬─────┘
            │
       ┌────┴───────────────┐
       ▼                    ▼
metric_alias       metric_definition


┌──────────────┐
│    entity    │
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────┐
│ entity_alias │
└──────────────┘


┌──────────────┐
│  dimension   │
└──────┬───────┘
       │ 1:N
       ▼
┌──────────────────┐
│ dimension_value  │
└────────┬─────────┘
         │
         └── parent_id


┌──────────────┐
│   concept    │
└──────┬───────┘
       │ 1:N
       ▼
┌───────────────┐
│ concept_alias │
└───────────────┘


metric
entity
dimension
concept
   │
   ▼
┌────────────────────┐
│ semantic_relation  │
└────────────────────┘


dataset
   │
   ▼
┌──────────────┐
│   document   │
└──────┬───────┘
       │ 1:N
       ▼
┌───────────────────┐
│ document_version  │
└──────┬────────────┘
       │ 1:N
       ▼
┌──────────────────┐
│ document_chunk   │
└──────┬───────────┘
       │
       ├──────────────► Milvus
       │
       ▼
knowledge_relation


┌──────────────┐
│   ai_query   │
└──────┬───────┘
       │ 1:1
       ▼
┌────────────────┐
│ semantic_query │
└──────┬─────────┘
       │ 1:N
       ▼
┌─────────────────┐
│ query_evidence  │
└─────────────────┘
```

---

# 48. AI Query 示例

用户：

```text
2025年华东新能源汽车销售额是多少？
```

## Step 1 Query Understanding

```json
{
  "intent": "metric_query",
  "metric": "销售额",
  "concept": "新能源汽车",
  "dimension": "华东",
  "time": "2025"
}
```

## Step 2 Semantic Resolution

```text
销售额
 ↓
metric: revenue

新能源汽车
 ↓
concept: new_energy_vehicle

华东
 ↓
dimension: region
value: EAST

2025
 ↓
time: 2025
```

## Step 3 Query Planning

```text
metric = revenue
dimension.region = EAST
concept.industry = NEV
year = 2025
```

## Step 4 Schema Retrieval

找到：

```text
dataset: sales
field: sales_amount
field: region_code
field: industry_code
field: year
```

## Step 5 SQL

LLM 生成 SQL。

SQL 必须经过：

```text
SQL Parser
 ↓
权限检查
 ↓
只读检查
 ↓
表/字段检查
 ↓
Limit 检查
 ↓
执行
```

## Step 6 Evidence

保存：

```text
dataset
dataset_version
metric
dataset_field
SQL
result
```

## Step 7 Answer

LLM 根据事实结果生成自然语言答案。

---

# 49. RAG 示例

用户：

```text
2025年新能源汽车行业为什么增长？
```

流程：

```text
Query Understanding
 ↓
Semantic Resolution
 ↓
Concept = NEV
Time = 2025
 ↓
Milvus
 ↓
Metadata Filter
 ↓
Vector Search
 ↓
Reranker
 ↓
Top Evidence
 ↓
LLM
```

Evidence 必须包含：

```text
document_id
document_version_id
chunk_id
page_number
section
source
score
```

---

# 50. Hybrid 示例

用户：

```text
我们公司2025年新能源汽车业务为什么低于行业平均？
```

查询：

```text
Company Revenue
       ↓
PostgreSQL

Industry Revenue / Market Reports
       ↓
Milvus

Company vs Industry
       ↓
Hybrid Analysis
       ↓
Evidence
       ↓
LLM
```

---

# 51. 安全要求

## SQL

AI 生成的 SQL 默认只允许：

```text
SELECT
WITH
```

禁止：

```text
INSERT
UPDATE
DELETE
DROP
ALTER
TRUNCATE
CREATE
```

数据库账号使用只读权限。

## MinIO

- 私有 Bucket
- 通过后端生成临时访问地址
- 不直接暴露 AccessKey/SecretKey

## Milvus

- 通过 NestJS Service 访问
- 不直接暴露给前端

---

# 52. 一致性策略

不要尝试：

```text
PostgreSQL
+
Milvus
+
MinIO
```

做强一致分布式事务。

采用：

```text
PostgreSQL
    ↓
记录状态
    ↓
BullMQ
    ↓
MinIO / Milvus
    ↓
更新 PostgreSQL 状态
```

状态示例：

```text
UPLOADED
PARSING
NORMALIZED
INDEXING
READY
FAILED
```

只有：

```text
READY
```

的数据可以进入 AI 查询。

---

# 53. 幂等性

所有 ingestion Job 必须支持幂等。

推荐使用：

```text
SHA256
dataset_id
version
chunk_id
```

作为去重/幂等依据。

例如：

```text
同一个文件上传两次
 ↓
SHA256 相同
 ↓
检测重复
 ↓
不重复处理
```

---

# 54. 一期开发顺序

推荐严格按照以下顺序开发：

```text
Phase 1
项目基础设施
 ↓
NestJS
PostgreSQL
Redis
MinIO
Milvus
Docker Compose

Phase 2
数据资产
 ↓
DataSource
Dataset
DatasetVersion
Schema
Field

Phase 3
数据接入
 ↓
CSV
Excel
Document
API

Phase 4
数据治理
 ↓
Schema Detection
Mapping
Quality
Normalization

Phase 5
Knowledge Base
 ↓
Document
DocumentVersion
Chunk
Embedding
Milvus

Phase 6
Semantic Layer
 ↓
Metric
Entity
Dimension
Concept
Alias
Mapping
Relation

Phase 7
AI Query Engine
 ↓
Query Understanding
Semantic Resolution
Query Router
Schema Retrieval
Text-to-SQL
RAG
Hybrid

Phase 8
Evidence / Lineage
 ↓
Query Evidence
Data Lineage
Source Traceability

Phase 9
External Search
 ↓
Search API
API Result Cache
Knowledge Base Ingestion

Phase 10
Optimization
 ↓
Reranker
Caching
Observability
Performance
```

---

# 55. AI Coding Agent 开发规则

开发过程中必须遵守：

## Rule 1

不要擅自更换：

```text
NestJS
PostgreSQL
Milvus
MinIO
Redis + BullMQ
```

## Rule 2

不要直接把业务数据全部存 Milvus。

## Rule 3

不要把 Vector 数据重复存 PostgreSQL pgvector。

本项目既然选择 Milvus，一期不再引入 pgvector。

## Rule 4

不要让 LLM 自己定义 Metric。

Metric 必须来自 Semantic Layer。

## Rule 5

不要让 LLM 每次重新猜字段映射。

字段映射必须持久化。

## Rule 6

不要让 HTTP 同步处理大型文件。

使用 BullMQ。

## Rule 7

所有数据必须支持版本。

禁止直接覆盖旧数据。

## Rule 8

所有 AI 答案尽可能保留 Evidence。

## Rule 9

所有外部搜索数据，在允许情况下沉淀进知识库。

## Rule 10

所有 AI 查询默认：

```text
内部数据优先
 ↓
内部知识库
 ↓
外部搜索/API
```

---

# 56. 开发验收标准

一期完成后，至少必须通过以下场景。

## 场景 1：CSV

上传：

```text
sales.csv
```

系统能够：

```text
上传
 ↓
MinIO
 ↓
Dataset Version
 ↓
Schema Detection
 ↓
Field Mapping
 ↓
Quality
 ↓
PostgreSQL
 ↓
READY
```

## 场景 2：Excel

支持：

```text
.xlsx
```

并能够识别：

- Sheet
- Header
- 字段
- 类型

## 场景 3：PDF

```text
PDF
 ↓
MinIO
 ↓
Parser/OCR
 ↓
Document
 ↓
Document Version
 ↓
Chunk
 ↓
Embedding
 ↓
Milvus
```

## 场景 4：Semantic Layer

输入：

```text
营收
```

必须解析：

```text
metric = revenue
```

输入：

```text
新能源车
```

必须解析：

```text
concept = new_energy_vehicle
```

输入：

```text
华东
```

必须解析：

```text
dimension = region
value = EAST
```

## 场景 5：SQL

输入：

```text
2025年华东销售额是多少？
```

系统应该优先：

```text
Semantic Layer
 ↓
PostgreSQL
```

而不是调用外部搜索。

## 场景 6：RAG

输入：

```text
2025年新能源汽车行业为什么增长？
```

系统：

```text
Milvus
 ↓
Evidence
 ↓
LLM
```

## 场景 7：Hybrid

输入：

```text
我们公司2025年新能源汽车业务为什么低于行业平均？
```

系统：

```text
PostgreSQL
+
Milvus
 ↓
Hybrid
```

## 场景 8：内部无数据

输入一个内部没有的数据问题：

```text
2026年某新政策对新能源汽车行业的影响是什么？
```

系统：

```text
PostgreSQL
 ↓
Milvus
 ↓
数据不足
 ↓
External Search API
 ↓
结果写入知识库
 ↓
本次回答
```

---

# 57. 最终系统定位

最终一期不是简单的：

```text
文件上传
+
向量数据库
+
ChatGPT
```

而应该是：

```text
                 AI数智研究平台
                       │
          ┌────────────┴────────────┐
          │                         │
      数据资产中心              Semantic Layer
          │                         │
    ┌─────┼─────┐          ┌───────┼────────┐
    │     │     │          │       │        │
   CSV   Excel  API      Metric  Entity  Dimension
    │     │     │          │       │        │
    └─────┴─────┘          Concept  Relation
          │                         │
          ▼                         ▼
        MinIO                  Query Engine
          │                         │
          ▼                  ┌──────┴──────┐
     PostgreSQL              │             │
          │                SQL/RAG      Hybrid
          │                  │             │
          └──────────────────┼─────────────┘
                             ▼
                           Milvus
                             │
                             ▼
                          Evidence
                             │
                             ▼
                            LLM
                             │
                             ▼
                          Research
```

**核心思想：**

> **数据资产负责“有什么数据”，Semantic Layer 负责“这些数据在业务上是什么意思”，PostgreSQL 负责“事实是什么”，Milvus 负责“相关知识在哪里”，Query Engine 负责“应该怎么查”，LLM 负责“怎么理解和表达”。**

这五层必须职责清晰，不能混在一起。

---

# 58. 后续实现建议

下一份开发文档应该继续补充：

1. PostgreSQL 全部 `CREATE TABLE`
2. 全部 PK / FK / UNIQUE / INDEX
3. PostgreSQL Enum 定义
4. Prisma TypeORM 数据模型（二选一）
5. Milvus Collection Schema
6. NestJS DTO
7. NestJS Entity
8. API Endpoint
9. BullMQ Queue
10. Ingestion Worker
11. Semantic Resolution Service
12. Query Router
13. Text-to-SQL Pipeline
14. RAG Pipeline
15. Hybrid Query Pipeline
16. External Search Provider Interface
17. Docker Compose
18. `.env.example`
19. 初始化数据库脚本
20. 一期开发任务拆解

> **本文件是架构与 ER 基线，不应把上述未展开部分擅自简化为临时方案。后续开发应在此模型上继续细化。**
