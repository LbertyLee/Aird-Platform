import { z } from 'zod';

/**
 * 运营看板异常告警项。
 */
export const dashboardAlertSchema = z.object({
  level: z.enum(['info', 'warning', 'error']).describe('告警级别'),
  code: z.string().describe('告警编码'),
  title: z.string().describe('告警标题'),
  message: z.string().describe('告警说明'),
  count: z.number().describe('数量'),
});

/**
 * 看板时间范围查询（日期为业务时区日历日 YYYY-MM-DD）。
 */
export const dashboardRangeQuerySchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('开始日期 YYYY-MM-DD'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('结束日期 YYYY-MM-DD'),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe('业务时区，默认 Asia/Shanghai'),
});

/**
 * 指标数据口径说明。
 */
export const dashboardMetricDefinitionSchema = z.object({
  key: z.string().describe('指标键'),
  label: z.string().describe('指标名称'),
  unit: z.string().describe('单位'),
  definition: z.string().describe('口径说明'),
  available: z.boolean().describe('是否已接入数据源'),
  source: z.string().nullable().describe('对账数据源表/接口'),
});

/**
 * 指标可用性标记；false 时前端展示空态占位。
 */
export const dashboardMetricAvailabilitySchema = z.object({
  userTotal: z.boolean(),
  searchCount: z.boolean(),
  dataVolume: z.boolean(),
  agentTaskCount: z.boolean(),
});

/**
 * 运营看板平台总览。
 * 未接入指标返回 null，前端展示空态占位（勿用 0 伪装有数据）。
 */
export const platformOverviewSchema = z.object({
  userTotal: z.number().nullable().describe('用户量（未删除账号累计）'),
  searchCount: z.number().nullable().describe('检索量（筛选区间合计）'),
  dataVolume: z.string().nullable().describe('数据量；未接入时为 null'),
  agentTaskCount: z.number().nullable().describe('Agent 任务量；未接入时为 null'),
  timezone: z.string().describe('业务时区'),
  startDate: z.string().describe('筛选开始日 YYYY-MM-DD'),
  endDate: z.string().describe('筛选结束日 YYYY-MM-DD'),
  statDate: z.string().describe('统计基准日（通常为结束日）'),
  generatedAt: z.string().describe('生成时间 ISO8601'),
  available: dashboardMetricAvailabilitySchema.describe('指标是否可用'),
  metricDefinitions: z
    .array(dashboardMetricDefinitionSchema)
    .describe('数据口径'),
  alerts: z.array(dashboardAlertSchema).optional().describe('异常告警'),
  extraMetrics: z.record(z.unknown()).describe('扩展指标'),
});

/**
 * 日趋势单点。
 */
export const dashboardTrendPointSchema = z.object({
  date: z.string().describe('业务时区日历日 YYYY-MM-DD'),
  userTotal: z.number().nullable().describe('当日用户量快照；无数据为 null'),
  searchCount: z.number().nullable().describe('当日检索量；无数据为 null'),
  newUserCount: z.number().nullable().describe('当日新增用户；无数据为 null'),
});

/**
 * 日趋势响应。
 */
export const dashboardTrendsSchema = z.object({
  timezone: z.string().describe('业务时区'),
  startDate: z.string().describe('筛选开始日'),
  endDate: z.string().describe('筛选结束日'),
  generatedAt: z.string().describe('生成时间 ISO8601'),
  points: z.array(dashboardTrendPointSchema).describe('按日序列'),
  metricDefinitions: z
    .array(dashboardMetricDefinitionSchema)
    .describe('数据口径'),
});

/**
 * 聚合刷新请求。
 */
export const dashboardAggregateRequestSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('开始日期'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe('结束日期'),
  timezone: z.string().optional().describe('业务时区'),
});

/**
 * 聚合刷新结果。
 */
export const dashboardAggregateResultSchema = z.object({
  timezone: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  upsertedDays: z.number().describe('写入/更新的天数'),
});

export type DashboardAlert = z.infer<typeof dashboardAlertSchema>;
export type DashboardRangeQuery = z.infer<typeof dashboardRangeQuerySchema>;
export type DashboardMetricDefinition = z.infer<
  typeof dashboardMetricDefinitionSchema
>;
export type PlatformOverview = z.infer<typeof platformOverviewSchema>;
export type DashboardTrendPoint = z.infer<typeof dashboardTrendPointSchema>;
export type DashboardTrends = z.infer<typeof dashboardTrendsSchema>;
export type DashboardAggregateRequest = z.infer<
  typeof dashboardAggregateRequestSchema
>;
export type DashboardAggregateResult = z.infer<
  typeof dashboardAggregateResultSchema
>;
