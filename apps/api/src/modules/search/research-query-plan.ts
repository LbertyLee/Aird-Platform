import type { ResearchFilters } from '@agent/contracts';
import { containsSearchTerm } from '../../research/research-filtering';
import { inferQueryDimensionHints } from '../analysis/indicator-query-rank';
import type { SemanticResolution } from '../semantic/semantic.types';
import {
  explicitYearRangePeriods,
  periodsFromRecentYearPhrase,
} from '../../common/utils/recent-years';
import { inferQueryRegions } from '../../common/utils/query-regions';
import { inferQueryCountries } from '../../common/utils/query-countries';
import { bilingualResearchTerms } from './research-bilingual-terms';
import { metricTranslationKey } from './research-metric-aliases';

/** Shared constraints for retrieval ranking and LLM extraction. */
export type ResearchQueryPlan = {
  entityGroups?: SemanticResolution['entityGroups'];
  discovery?: SemanticResolution['discovery'];
  originalQuery: string;
  searchQuery: string;
  entities: string[];
  /** Explicit localities must match even if a broader country also matches. */
  regions?: string[];
  metrics: string[];
  dimensions?: string[];
  periods: string[];
  mustTerms: string[];
  preferredIndicatorCodes: string[];
  intent: SemanticResolution['intent'];
  confidence: number;
};

export function buildResearchQueryPlan(input: {
  originalQuery: string;
  filters: ResearchFilters;
  optimizedQuery: string;
  resolution: SemanticResolution;
}): ResearchQueryPlan {
  const hints = inferQueryDimensionHints(input.originalQuery);
  const catalogMetricKeys = new Set(
    input.resolution.metrics.flatMap((metric) =>
      [metric.code, metric.name, ...(metric.aliases ?? [])].map(
        metricTranslationKey,
      ),
    ),
  );
  const discoveryMetrics = (input.resolution.discovery?.metrics ?? []).filter(
    (metric) => !catalogMetricKeys.has(metricTranslationKey(metric)),
  );
  const catalogEntityKeys = new Set(
    input.resolution.entities.flatMap((entity) =>
      [entity.name, entity.code, ...(entity.aliases ?? [])].map(normalizeTerm),
    ),
  );
  const discoveryEntities = (input.resolution.discovery?.entities ?? []).filter(
    (entity) => !catalogEntityKeys.has(normalizeTerm(entity)),
  );
  const catalogDimensionKeys = new Set(
    input.resolution.dimensions.flatMap((dimension) =>
      [
        dimension.name,
        dimension.code,
        dimension.value ?? '',
        ...(dimension.aliases ?? []),
      ].map(normalizeTerm),
    ),
  );
  const discoveryDimensions = (
    input.resolution.discovery?.dimensions ?? []
  ).filter((dimension) => !catalogDimensionKeys.has(normalizeTerm(dimension)));
  const regions = uniqueStrings(
    bilingualResearchTerms(
      [
        ...inferQueryRegions(input.originalQuery),
        ...input.resolution.dimensions
          .filter((item) => /^(region|province|city|area)$/.test(item.type))
          .map((item) => item.name),
        ...input.filters.regions,
      ],
      input.resolution.sourcePlan,
    ),
  );
  const entities = uniqueStrings(
    bilingualResearchTerms(
      [
        ...discoveryEntities,
        ...inferQueryCountries(input.originalQuery),
        ...regions,
        ...hints.entities,
        ...input.resolution.entities.map((item) => item.name),
        ...input.resolution.dimensions
          .filter((item) => item.type === 'country_region')
          .map((item) => item.name),
        ...input.filters.entities,
        ...input.filters.countries,
        ...input.filters.regions,
      ],
      input.resolution.sourcePlan,
    ),
  );
  const metrics = uniqueStrings(
    bilingualResearchTerms(
      [
        ...discoveryMetrics,
        ...input.resolution.metrics.map((item) => item.name),
        ...input.filters.indicators,
      ],
      input.resolution.sourcePlan,
      'metric',
    ),
  );
  const dimensions = uniqueStrings([
    ...input.resolution.dimensions.map((item) => item.name),
    ...discoveryDimensions,
  ]);
  const recentPeriods =
    periodsFromRecentYearPhrase(input.originalQuery) ??
    explicitYearRangePeriods(input.originalQuery);
  const periods = recentPeriods
    ? uniqueStrings(recentPeriods)
    : uniqueStrings([
        ...hints.periods,
        ...periodsFromResolution(input.resolution),
        ...yearsFromText(input.originalQuery),
        ...input.filters.timeRanges.flatMap((range) => yearsFromText(range)),
      ]);
  const preferredIndicatorCodes = uniqueStrings(
    input.resolution.metrics.map((item) => item.code),
  );
  const mustTerms = uniqueStrings([
    ...entities,
    ...metrics,
    ...dimensions,
    ...periods.slice(-3),
  ]);
  const searchQuery = composeSearchQuery(
    uniqueStrings([
      input.originalQuery,
      input.optimizedQuery,
      ...(input.resolution.discovery?.dataNeeds ?? []),
    ]).join(' '),
    entities,
    metrics,
    dimensions,
    periods,
    input.resolution.intent,
  );
  return {
    entityGroups: input.resolution.entityGroups,
    discovery: input.resolution.discovery,
    originalQuery: input.originalQuery.trim(),
    searchQuery,
    entities,
    regions,
    metrics,
    dimensions,
    periods,
    mustTerms,
    preferredIndicatorCodes,
    intent: input.resolution.intent,
    confidence: input.resolution.confidence,
  };
}

/** Analysis path when semantic resolution is unavailable. */
export function buildResearchQueryPlanLite(
  originalQuery: string,
  filters?: Partial<ResearchFilters>,
): ResearchQueryPlan {
  const normalizedFilters: ResearchFilters = {
    countries: filters?.countries ?? [],
    regions: filters?.regions ?? [],
    entities: filters?.entities ?? [],
    indicators: filters?.indicators ?? [],
    timeRanges: filters?.timeRanges ?? [],
    sources: filters?.sources ?? [],
  };
  const hints = inferQueryDimensionHints(originalQuery);
  const regions = uniqueStrings([
    ...inferQueryRegions(originalQuery),
    ...normalizedFilters.regions,
  ]);
  const entities = uniqueStrings([
    ...hints.entities,
    ...normalizedFilters.entities,
    ...normalizedFilters.countries,
    ...normalizedFilters.regions,
  ]);
  const metrics = uniqueStrings([...normalizedFilters.indicators]);
  const dimensions: string[] = [];
  const recentPeriods =
    periodsFromRecentYearPhrase(originalQuery) ??
    explicitYearRangePeriods(originalQuery);
  const periods = recentPeriods
    ? uniqueStrings(recentPeriods)
    : uniqueStrings([
        ...hints.periods,
        ...yearsFromText(originalQuery),
        ...normalizedFilters.timeRanges.flatMap((range) =>
          yearsFromText(range),
        ),
      ]);
  const mustTerms = uniqueStrings([
    ...entities,
    ...metrics,
    ...periods.slice(-3),
  ]);
  return {
    originalQuery: originalQuery.trim(),
    searchQuery: composeSearchQuery(
      originalQuery,
      entities,
      metrics,
      dimensions,
      periods,
      'analysis',
    ),
    entities,
    regions,
    metrics,
    dimensions,
    periods,
    mustTerms,
    preferredIndicatorCodes: [],
    intent: 'analysis',
    confidence: 0.5,
  };
}

export function entityMatchesPlan(
  entity: string | undefined,
  plan: ResearchQueryPlan,
): boolean {
  if (
    plan.regions?.length &&
    !plan.regions.some((region) => entity?.includes(region))
  )
    return false;
  if (!plan.entities.length) return true;
  if (!entity?.trim()) return false;
  const normalized = entity.trim().toLowerCase();
  return plan.entities.some((candidate) => {
    const c = candidate.toLowerCase();
    return normalized.includes(c) || c.includes(normalized);
  });
}

export function periodMatchesPlan(
  period: string | undefined,
  plan: ResearchQueryPlan,
): boolean {
  if (!plan.periods.length) return true;
  const year = period?.match(/[12]\d{3}/)?.[0];
  if (!year) return false;
  return plan.periods.includes(year);
}

function composeSearchQuery(
  optimizedQuery: string,
  entities: string[],
  metrics: string[],
  dimensions: string[],
  periods: string[],
  intent: SemanticResolution['intent'],
): string {
  const intentTerms = {
    metric_query: '统计数据 指标',
    analysis: '趋势 对比 分析 数据',
    lookup: '官方 说明',
    general: '',
  }[intent];
  const periodHint =
    periods.length >= 2
      ? `${periods[0]}-${periods[periods.length - 1]}`
      : (periods[0] ?? '');
  return [
    ...new Set(
      [
        optimizedQuery.trim(),
        intentTerms,
        ...entities,
        ...metrics,
        ...dimensions,
        periodHint,
      ]
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
    .join(' ')
    .slice(0, 500);
}

function periodsFromResolution(resolution: SemanticResolution): string[] {
  if (resolution.time.type === 'YEAR' && resolution.time.value != null) {
    return [String(resolution.time.value)];
  }
  if (
    resolution.time.type === 'RANGE' &&
    resolution.time.start &&
    resolution.time.end
  ) {
    const start = Number(resolution.time.start);
    const end = Number(resolution.time.end);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      const years: string[] = [];
      for (let year = start; year <= end && years.length < 25; year += 1) {
        years.push(String(year));
      }
      return years;
    }
  }
  return [];
}

function yearsFromText(text: string): string[] {
  return [...new Set(text.match(/\b[12]\d{3}\b/g) ?? [])];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeTerm(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function termHits(text: string, terms: string[]): string[] {
  return terms.filter((term) => containsSearchTerm(text, term));
}
