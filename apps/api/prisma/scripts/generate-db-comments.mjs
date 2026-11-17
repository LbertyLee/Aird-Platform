/**
 * 从 schema.prisma 的 /// 文档注释生成 PostgreSQL COMMENT ON 迁移 SQL。
 * 用法: node prisma/scripts/generate-db-comments.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, '..', 'schema.prisma');
const outputPath = path.join(
  __dirname,
  '..',
  'migrations',
  '20260903160000_add_table_column_comments',
  'migration.sql',
);

const SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

const ENUM_LABELS = {
  LocationKind: '地域层级：国家/地区',
  SourceOrigin: '研究来源起源：上传/Exa/本地',
  StorageType: '存储类型：结构化数据/知识文档',
  ResearchRunStatus: '研究检索任务状态',
};

const FIELD_LABELS = {
  pageNumber: '页码',
  storageType: '存储类型',
  id: '主键',
  code: '编码',
  name: '名称',
  title: '标题',
  type: '类型',
  status: '状态',
  description: '说明',
  remark: '备注',
  sort: '排序',
  unit: '单位',
  source: '来源',
  category: '分类',
  definition: '定义',
  alias: '别名',
  confidence: '置信度',
  aggregation: '聚合方式',
  formula: '计算公式',
  condition: '过滤条件',
  priority: '优先级',
  version: '版本号',
  checksum: '文件校验和',
  progress: '进度（0-100）',
  intent: '查询意图',
  answer: '回答内容',
  score: '相关度分数',
  content: '内容',
  section: '章节',
  keyword: '关键词',
  enabled: '是否启用',
  handled: '是否已处理',
  note: '备注',
  prefix: '存储前缀',
  trigger: '触发方式',
  channel: '通道',
  amount: '金额',
  price: '价格',
  email: '邮箱',
  phone: '手机号',
  username: '登录名',
  passwordHash: '密码哈希',
  path: '路径',
  resource: '资源标识',
  parentId: '父节点 ID',
  levelId: '等级 ID',
  roleId: '角色 ID',
  userId: '用户 ID',
  orderId: '订单 ID',
  packageId: '套餐 ID',
  datasetId: '数据集 ID',
  indicatorId: '指标 ID',
  fieldName: '字段名',
  displayName: '展示名',
  dataType: '数据类型',
  semanticType: '语义类型',
  nullable: '是否可空',
  ordinal: '列序号',
  rowIndex: '行序号',
  rowCount: '行数',
  chunkCount: '分块数量',
  chunkIndex: '分块序号',
  tokenCount: 'Token 数量',
  fileKey: 'MinIO 对象键',
  fileName: '文件名',
  mimeType: 'MIME 类型',
  fileSize: '文件大小（字节）',
  visibility: '可见性',
  publishStatus: '上下架状态',
  auditStatus: '审核状态',
  vectorStatus: '向量同步状态',
  vectorError: '向量同步失败原因',
  vectorSyncedAt: '最近向量同步时间',
  createdAt: '创建时间',
  updatedAt: '更新时间',
  deletedAt: '软删除时间',
  createdBy: '创建人',
  updatedBy: '更新人',
  submittedBy: '提交人',
  auditedBy: '审核人',
  auditedAt: '审核时间',
  startedAt: '开始时间',
  completedAt: '完成时间',
  finishedAt: '结束时间',
  paidAt: '支付完成时间',
  issuedAt: '开票时间',
  sentAt: '发送时间',
  remindAt: '计划提醒时间',
  operTime: '操作时间',
  lastLoginAt: '最近登录时间',
  startAt: '生效开始时间',
  endAt: '到期时间',
  closedAt: '关闭时间',
  refundedAt: '退款时间',
  publishedAt: '发布时间',
  recalledAt: '撤回时间',
  detectedAt: 'Schema 检测时间',
  cacheExpiresAt: '缓存过期时间',
  isCurrent: '是否为当前版本',
  isSystem: '是否系统内置',
  isPurchasable: '是否允许前台购买',
  isPrimaryKey: '是否主键字段',
  autoRenew: '是否自动续费',
  envIncluded: '是否包含环境配置快照',
  matchedLocally: '是否本地命中',
  usedExa: '是否使用 Exa 检索',
  hitCount: '命中次数',
  costTime: '消耗时间（毫秒）',
  totalRows: '总行数',
  successRows: '成功行数',
  failedRows: '失败行数',
  retryCount: '重试次数',
  filesCount: '备份文件数',
  dbSizeBytes: '数据库备份大小（字节）',
  filesSizeBytes: '对象文件总大小（字节）',
  sizeBytes: '文件大小（字节）',
  recordCount: '记录数',
  errorMessage: '错误信息',
  errorReportKey: '失败报告文件键',
  rejectReason: '驳回原因',
  refundReason: '退款原因',
  paymentChannel: '支付渠道',
  tradeNo: '渠道交易号',
  taxNo: '税号',
  orderNo: '业务订单号',
  buyerType: '买方类型',
  buyerId: '买方 ID',
  scopeType: '数据权限范围类型',
  scope: '适用范围',
  valueType: '值类型',
  valueJson: '权益值 JSON',
  benefitCode: '权益码',
  durationDays: '有效天数',
  packageType: '套餐周期类型',
  originalPrice: '原价',
  priceLabel: '价格展示文案',
  tag: '营销标签',
  locationKind: '地域层级类型',
  aliases: '别名列表',
  websiteUrl: '网站链接',
  regionLevel: '地区/层级',
  categoryCode: '来源分类编码',
  nameEn: '英文名称',
  targetType: '目标类型',
  targetId: '目标 ID',
  jobType: '任务类型',
  currentStep: '当前步骤',
  storageType: '存储类型',
  rawObjectPath: '原始文件对象路径',
  minioObjectPath: 'MinIO 对象路径',
  milvusId: 'Milvus 向量 ID',
  schemaJson: 'Schema JSON',
  schemaHash: 'Schema 哈希',
  sampleValues: '样例值 JSON',
  metadataJson: '元数据 JSON',
  queryPlanJson: '查询计划 JSON',
  metricsJson: '指标解析 JSON',
  entitiesJson: '实体解析 JSON',
  dimensionsJson: '维度解析 JSON',
  conceptsJson: '概念解析 JSON',
  timeJson: '时间解析 JSON',
  resolvedQueryJson: '解析后查询 JSON',
  sourceMeta: '来源元数据',
  sourceType: '来源类型',
  sourceId: '来源 ID',
  evidenceType: '证据类型',
  entityType: '实体类型',
  conceptType: '概念类型',
  canonicalName: '规范名称',
  aliasType: '别名类型',
  routeType: '路由类型',
  sessionId: '会话 ID',
  userQuery: '用户原始问题',
  query: '检索问题',
  queryFingerprint: '查询指纹',
  filters: '过滤条件 JSON',
  sourceIds: '来源 ID 列表',
  sourceScores: '来源相关度分数',
  reportTitle: '报告标题',
  reportMarkdown: '报告 Markdown',
  fingerprint: '分支缓存指纹',
  audienceScope: '公告接收范围',
  audienceRoleIds: '指定角色 ID 列表',
  receiverId: '接收人 ID',
  bizType: '业务类型',
  word: '敏感词',
  intro: '简介',
  groupCode: '知识分组编码',
  icon: '图标',
  color: '主题色',
  fileTotal: '文件总数',
  summary: '摘要',
  libraryId: '所属知识库 ID',
  categoryId: '分类 ID',
  snapshot: '审核快照 JSON',
  action: '操作动作',
  actorId: '操作人 ID',
  detail: '变更详情 JSON',
  ip: '来源 IP',
  businessType: '业务类型（0其它 1新增 2修改 3删除）',
  method: '方法名称',
  requestMethod: 'HTTP 请求方式',
  operName: '操作人员',
  deptName: '部门名称',
  operUrl: '请求 URL',
  operIp: '主机地址',
  operLocation: '操作地点',
  operParam: '请求参数',
  jsonResult: '返回参数',
  errorMsg: '错误消息',
  statDate: '统计日',
  userTotal: '用户总数快照',
  searchCount: '当日检索量',
  dataVolume: '数据总量快照',
  agentTaskCount: '当日 Agent 任务数',
  metrics: '扩展指标 JSON',
  timezone: '业务时区',
  subscriptionType: '订阅类型',
  subscriptionId: '订阅 ID',
  permissionId: '权限 ID',
  datasetVersionId: '数据集版本 ID',
  datasetSchemaId: '数据集 Schema ID',
  datasetFieldId: '数据集字段 ID',
  knowledgeVersionId: '知识版本 ID',
  knowledgeItemId: '知识条目 ID',
  aiQueryId: 'AI 查询 ID',
  entityId: '语义实体 ID',
  conceptId: '业务概念 ID',
  dictionaryItemId: '字典项 ID',
  dataSource: '外部数据源名称',
  sourceField: '来源字段编码',
  transform: '换算/处理方式',
  data: '行数据 JSON',
  origin: '来源类型',
  sourceUrl: '来源 URL',
  textContent: '文本内容',
  searchText: '检索文本',
  structuredData: '结构化数据 JSON',
  metadata: '元数据 JSON',
  sql: 'SQL 语句',
  rawPayload: '渠道回调原文 JSON',
  reason: '原因',
  displayName: '显示名',
  avatarUrl: '头像 URL',
  userId: '用户 ID',
};

function escapeSqlString(value) {
  return value.replace(/'/g, "''");
}

function extractDocComment(lines, index) {
  const docs = [];
  let i = index - 1;
  while (i >= 0) {
    const line = lines[i].trim();
    if (line.startsWith('///')) {
      docs.unshift(line.slice(3).trim());
      i -= 1;
      continue;
    }
    if (line === '' || line.startsWith('//')) {
      i -= 1;
      continue;
    }
    break;
  }
  return docs.join(' ').trim();
}

function parseMapAttribute(fragment, key) {
  const regex = new RegExp(`@${key}\\("([^"]+)"\\)`);
  const match = fragment.match(regex);
  return match?.[1];
}

function inferFieldLabel(fieldName, fieldType) {
  if (FIELD_LABELS[fieldName]) {
    return FIELD_LABELS[fieldName];
  }
  if (fieldName.endsWith('Id')) {
    const entity = fieldName.slice(0, -2);
    return `${entity} ID`;
  }
  if (fieldName.endsWith('At')) {
    return `${fieldName.slice(0, -2)} 时间`;
  }
  if (fieldName.endsWith('Json')) {
    return `${fieldName.slice(0, -4)} JSON`;
  }
  if (fieldName.endsWith('Count')) {
    return `${fieldName.slice(0, -5)} 数量`;
  }
  if (fieldName.endsWith('Status')) {
    return `${fieldName.slice(0, -6)} 状态`;
  }
  if (fieldType.endsWith('[]')) {
    return `${fieldName} 列表`;
  }
  return fieldName;
}

function parseSchema(content) {
  const lines = content.split(/\r?\n/);
  const enums = new Map();
  const models = [];

  // 第一遍：收集所有枚举，避免 model 引用的 enum 尚未注册
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const enumMatch = line.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      const enumName = enumMatch[1];
      const comment = extractDocComment(lines, i);
      enums.set(enumName, comment || ENUM_LABELS[enumName] || enumName);
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('}')) {
        i += 1;
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    const enumMatch = line.match(/^enum\s+(\w+)\s*\{/);
    if (enumMatch) {
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('}')) {
        i += 1;
      }
      i += 1;
      continue;
    }

    const modelMatch = line.match(/^model\s+(\w+)\s*\{/);
    if (modelMatch) {
      const modelName = modelMatch[1];
      const modelComment = extractDocComment(lines, i) || modelName;
      const fields = [];
      let tableMap = null;

      i += 1;
      while (i < lines.length) {
        const inner = lines[i];
        const trimmed = inner.trim();

        if (trimmed === '}') {
          break;
        }

        const mapMatch = trimmed.match(/^@@map\("([^"]+)"\)/);
        if (mapMatch) {
          tableMap = mapMatch[1];
          i += 1;
          continue;
        }

        if (
          trimmed.startsWith('@@') ||
          trimmed.startsWith('//') ||
          trimmed === '' ||
          trimmed.startsWith('///')
        ) {
          if (trimmed.startsWith('///')) {
            // field doc on its own line handled below
          }
          i += 1;
          continue;
        }

        const fieldMatch = trimmed.match(/^(\w+)\s+([A-Za-z0-9_\[\]?]+)/);
        if (fieldMatch) {
          const fieldName = fieldMatch[1];
          const rawType = fieldMatch[2];
          const baseType = rawType.replace(/\?|\[\]/g, '');
          const fieldComment = extractDocComment(lines, i);
          const columnName = parseMapAttribute(trimmed, 'map') ?? fieldName;
          const isEnum = enums.has(baseType);
          const isRelation =
            !SCALAR_TYPES.has(baseType) &&
            !isEnum &&
            /^[A-Z]/.test(baseType);

          if (!isRelation) {
            fields.push({
              fieldName,
              columnName,
              comment: fieldComment || inferFieldLabel(fieldName, rawType),
            });
          }
        }

        i += 1;
      }

      models.push({
        modelName,
        tableName: tableMap ?? modelName,
        comment: modelComment,
        fields,
      });
      i += 1;
      continue;
    }

    i += 1;
  }

  return { enums, models };
}

function generateSql({ enums, models }) {
  const chunks = [
    '-- 为所有表、字段及枚举类型添加数据库备注，便于运维与数据字典维护',
    '',
  ];

  for (const [enumName, comment] of enums) {
    chunks.push(
      `COMMENT ON TYPE "${enumName}" IS '${escapeSqlString(comment)}';`,
    );
  }

  chunks.push('');

  for (const model of models) {
    chunks.push(
      `COMMENT ON TABLE "${model.tableName}" IS '${escapeSqlString(model.comment)}';`,
    );
    for (const field of model.fields) {
      chunks.push(
        `COMMENT ON COLUMN "${model.tableName}"."${field.columnName}" IS '${escapeSqlString(field.comment)}';`,
      );
    }
    chunks.push('');
  }

  return `${chunks.join('\n').trim()}\n`;
}

const schema = fs.readFileSync(schemaPath, 'utf8');
const parsed = parseSchema(schema);
const sql = generateSql(parsed);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, sql, 'utf8');

console.log(`Generated ${outputPath}`);
console.log(
  `Enums: ${parsed.enums.size}, Tables: ${parsed.models.length}, Columns: ${parsed.models.reduce((n, m) => n + m.fields.length, 0)}`,
);
