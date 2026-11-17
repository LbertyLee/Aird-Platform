export type ResolvedMetric = {
  aliases?: string[];
  code: string;
  name: string;
  indicatorId: string;
};

export type ResolvedEntity = {
  aliases?: string[];
  code: string;
  name: string;
  entityId: string;
};

export type ResolvedConcept = {
  code: string;
  name: string;
  conceptId: string;
};

export type ResolvedDimension = {
  aliases?: string[];
  type: string;
  code: string;
  name: string;
  value?: string;
};

export type ResolvedTime = {
  type: 'YEAR' | 'RANGE' | 'UNKNOWN';
  value?: number;
  start?: string;
  end?: string;
};

/** Request-scoped research needs, never database IDs or verified evidence. */
export type ResearchDiscovery = {
  metrics: string[];
  entities: string[];
  /** AI-identified analytical dimensions that are not present in the catalog. */
  dimensions?: string[];
  dataNeeds: string[];
  websites: string[];
};

export type ResearchSourcePlan = {
  status: 'ready' | 'unavailable';
  intentSummary: string;
  dataNeeds: string[];
  sources: Array<{ websiteUrl: string; query: string; reason: string }>;
  allowDiscovery: boolean;
  translations?: Array<{ zh: string; en: string }>;
  discoveryQueries?: { zh: string; en: string };
};

export type SemanticResolution = {
  sourcePlan?: ResearchSourcePlan;
  discovery?: ResearchDiscovery;
  metrics: ResolvedMetric[];
  entities: ResolvedEntity[];
  concepts: ResolvedConcept[];
  dimensions: ResolvedDimension[];
  time: ResolvedTime;
  confidence: number;
  intent: 'metric_query' | 'analysis' | 'lookup' | 'general';
};

/** LLM 原始解析结果（code 需再对照 Semantic Layer 落地） */
export type LlmSemanticParseResult = {
  discovery?: ResearchDiscovery;
  intent: SemanticResolution['intent'];
  confidence: number;
  metricCodes: string[];
  entityCodes: string[];
  conceptCodes: string[];
  dimensionCodes: string[];
  time: ResolvedTime;
  rationale?: string;
};

export type SemanticCatalogItem = {
  code: string;
  name: string;
  aliases?: string[];
  type?: string;
};

export type SemanticCatalog = {
  sources?: Array<{ name: string; websiteUrl: string | null }>;
  metrics: SemanticCatalogItem[];
  entities: SemanticCatalogItem[];
  concepts: SemanticCatalogItem[];
  dimensions: SemanticCatalogItem[];
};

/** Evidence adequacy, evaluated against every original subgoal. */
export type ResearchEvaluation = {
  sufficient: boolean;
  reason: string;
  gaps: string[];
  coveredNeeds: string[];
  evidenceUrls: string[];
};
