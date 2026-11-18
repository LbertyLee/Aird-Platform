import { z } from 'zod';

/**
 * 统一 API 响应信封。
 */
export const apiEnvelopeSchema = z.object({
  success: z.boolean().describe('是否成功'),
  requestId: z.string().optional().describe('请求追踪 ID'),
  data: z.unknown().optional().describe('业务数据'),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional()
    .describe('错误信息'),
});

export type ApiEnvelope = z.infer<typeof apiEnvelopeSchema>;

export * from './admin/auth.js';
export * from './admin/dashboard.js';

export const storageTypeSchema = z.enum(['structured', 'knowledge']);
export const sourceOriginSchema = z.enum(['upload', 'exa', 'local']);

export type StorageType = z.infer<typeof storageTypeSchema>;
export type SourceOrigin = z.infer<typeof sourceOriginSchema>;

export const researchReportSchema = z.object({
  title: z.string(),
  markdown: z.string(),
  generatedBy: z.enum(['ai', 'template']),
  createdAt: z.string(),
});

export const researchFiltersSchema = z.object({
  countries: z.array(z.string()).default([]),
  regions: z.array(z.string()).default([]),
  entities: z.array(z.string()).default([]),
  indicators: z.array(z.string()).default([]),
  timeRanges: z.array(z.string()).default([]),
  sources: z.array(z.string()).default([]),
  libraryIds: z.array(z.string()).optional(),
});

export const researchSearchModeSchema = z.enum([
  'mixed',
  'exa',
  'knowledge',
  'ai-search',
]);
export const researchModelSchema = z.string().trim().min(1).max(100);
export type ResearchModel = z.infer<typeof researchModelSchema>;

export const researchFilterOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  kind: z.enum(['organization', 'dataset']).optional(),
});

export const researchFilterCatalogSchema = z.object({
  countries: z.array(researchFilterOptionSchema),
  regions: z.array(researchFilterOptionSchema),
  entities: z.array(researchFilterOptionSchema),
  indicators: z.array(researchFilterOptionSchema),
  timeRanges: z.array(researchFilterOptionSchema),
  sources: z.array(researchFilterOptionSchema),
});

export const researchQueryPlanSchema = z.object({
  countries: z.array(z.string()),
  regions: z.array(z.string()),
  entities: z.array(z.string()),
  indicators: z.array(z.string()),
  /** Semantic catalog and discovery dimensions; absent in historical plans. */
  dimensions: z.array(z.string()).optional(),
  timeRanges: z.array(z.string()),
  sources: z.array(z.string()),
  intent: z.enum(['comparison', 'trend', 'lookup', 'policy', 'general']),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
});

export const knowledgeSourceScopeSchema = z.enum(['platform_public', 'user']);

export const researchSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  origin: sourceOriginSchema,
  storageType: storageTypeSchema,
  sourceUrl: z.string().url().nullable(),
  mimeType: z.string().nullable(),
  excerpt: z.string(),
  content: z.string().optional(),
  recordCount: z.number().int().nonnegative(),
  structuredData: z.unknown().optional(),
  score: z.number().min(0).max(1).optional(),
  createdAt: z.string(),
  /** 知识库命中时的归属：平台公共库 vs 当前用户自有库 */
  knowledgeScope: knowledgeSourceScopeSchema.optional(),
  /** 所属知识库名称（展示用） */
  libraryName: z.string().optional(),
});

export const researchStageSchema = z.object({
  key: z.enum(['plan', 'cache', 'database', 'vector', 'exa', 'ingest']),
  label: z.string(),
  status: z.enum(['completed', 'skipped', 'failed']),
  detail: z.string(),
});

export const uploadResponseSchema = z.object({
  source: researchSourceSchema,
  message: z.string(),
});

export const researchSearchRequestSchema = z.object({
  query: z.string().trim().min(2).max(500),
  filters: researchFiltersSchema.optional(),
  mode: researchSearchModeSchema.default('mixed'),
  model: researchModelSchema.optional(),
});

export const researchSearchResponseSchema = z.object({
  runId: z.string(),
  query: z.string(),
  mode: researchSearchModeSchema,
  matchedLocally: z.boolean(),
  usedExa: z.boolean(),
  exaConfigured: z.boolean(),
  cacheHit: z.boolean(),
  cachedAt: z.string().nullable(),
  plan: researchQueryPlanSchema,
  sources: z.array(researchSourceSchema),
  stages: z.array(researchStageSchema),
  answer: z.string().optional(),
  aiQueryId: z.string().optional(),
});

export type ResearchSource = z.infer<typeof researchSourceSchema>;
export type ResearchStage = z.infer<typeof researchStageSchema>;
export type ResearchReport = z.infer<typeof researchReportSchema>;
export type ResearchFilters = z.infer<typeof researchFiltersSchema>;
export type ResearchSearchMode = z.infer<typeof researchSearchModeSchema>;
export type ResearchFilterCatalog = z.infer<typeof researchFilterCatalogSchema>;
export type ResearchFilterOption = z.infer<typeof researchFilterOptionSchema>;
export type ResearchQueryPlan = z.infer<typeof researchQueryPlanSchema>;
export type UploadResponse = z.infer<typeof uploadResponseSchema>;
export type ResearchSearchRequest = z.infer<typeof researchSearchRequestSchema>;
export type ResearchSearchResponse = z.infer<
  typeof researchSearchResponseSchema
>;

export const researchSearchJobStatusSchema = z.enum([
  'running',
  'completed',
  'failed',
]);

export const researchSearchJobCreateResponseSchema = z.object({
  jobId: z.string(),
  status: researchSearchJobStatusSchema,
});

export const researchSearchProgressSchema = z.object({
  stage: z.enum([
    'planning',
    'searching',
    'discovering',
    'evaluating',
    'replanning',
    'writing',
  ]),
  round: z.number().int().min(1).max(5).optional(),
  message: z.string(),
});
export type ResearchSearchProgress = z.infer<
  typeof researchSearchProgressSchema
>;

export const researchSearchJobSnapshotSchema = z.object({
  jobId: z.string(),
  status: researchSearchJobStatusSchema,
  query: z.string(),
  progress: researchSearchProgressSchema.optional(),
  error: z.string().nullable().optional(),
  result: researchSearchResponseSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ResearchSearchJobStatus = z.infer<
  typeof researchSearchJobStatusSchema
>;
export type ResearchSearchJobCreateResponse = z.infer<
  typeof researchSearchJobCreateResponseSchema
>;
export type ResearchSearchJobSnapshot = z.infer<
  typeof researchSearchJobSnapshotSchema
>;

export type AnalysisVisualView = 'line' | 'map' | 'table';
export interface AnalysisPresentation {
  /** Optional workbench source filter; omitted means all extracted sources. */
  sourceIds?: string[];
  datasetId: string;
  entities: string[];
  /** Exact selected periods; omitted for a continuous range. */
  periods?: string[];
  startPeriod: string;
  endPeriod: string;
  currentPeriod: string;
  view: AnalysisVisualView;
  reportViews: AnalysisVisualView[];
}
export interface AnalysisVisualDataset {
  id: string;
  name: string;
  unit: string;
  definition: string;
  periods: string[];
  entities: string[];
  sources: Array<{ id: string; title: string }>;
  points: Array<{
    entity: string;
    period: string;
    value: number | null;
    conflict: boolean;
    sourceIds: string[];
  }>;
}
export interface AnalysisVisualReport {
  title: string;
  createdAt: string;
  presentation: AnalysisPresentation;
  metrics: Array<{ label: string; value: string }>;
  sections: Array<{ title: string; paragraphs: string[] }>;
}

export { buildVisualDatasets } from './analysis-datasets.js';
