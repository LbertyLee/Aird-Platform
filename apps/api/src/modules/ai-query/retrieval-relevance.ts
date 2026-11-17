import type { ResearchFilters } from '@agent/contracts';
import { containsSearchTerm } from '../../research/research-filtering';
import { dictionaryAliases } from '../ingestion/keyword-search';
import type { ResearchQueryPlan } from '../search/research-query-plan';
import { termHits } from '../search/research-query-plan';
import type { SemanticResolution } from '../semantic/semantic.types';
import { inferQueryRegions } from '../../common/utils/query-regions';
import { bilingualResearchTerms } from '../search/research-bilingual-terms';
import { metricAliases } from '../search/research-metric-aliases';
import { countrySearchAliases } from '../../common/utils/query-countries';

export type DocumentRelevanceScore = {
  score: number;
  matchedEntities: string[];
  matchedMetrics: string[];
  matchedPeriods: string[];
};

/** Soft relevance score for ranking and filtering retrieved documents. */
export function scoreDocumentRelevance(
  text: string,
  plan: ResearchQueryPlan,
): DocumentRelevanceScore {
  const matchedEntities = matchingEntityTerms(text, plan.entities);
  const matchedMetrics = plan.metrics.filter((metric) =>
    expandSearchTerms([metric], 'metric').some((term) =>
      containsSearchTerm(text, term),
    ),
  );
  const matchedPeriods = termHits(text, plan.periods);
  const hasEntityConstraint = plan.entities.length > 0;
  const hasMetricConstraint = plan.metrics.length > 0;
  const hasPeriodConstraint = plan.periods.length > 0;

  let score = 0.15;
  if (hasEntityConstraint) {
    // A city report need not repeat its parent province and country names.
    const entityTerms = plan.regions?.length ? plan.regions : plan.entities;
    score +=
      (matchingEntityTerms(text, entityTerms).length / entityTerms.length) *
      0.35;
  } else {
    score += 0.12;
  }
  if (hasMetricConstraint) {
    score += (matchedMetrics.length / plan.metrics.length) * 0.3;
  } else {
    score += 0.1;
  }
  if (hasPeriodConstraint) {
    const required = Math.min(2, plan.periods.length);
    score += (Math.min(matchedPeriods.length, required) / required) * 0.25;
  } else {
    score += 0.08;
  }
  for (const term of plan.mustTerms.slice(0, 8)) {
    if (containsSearchTerm(text, term)) score += 0.02;
  }
  return {
    score: Math.min(1, score),
    matchedEntities,
    matchedMetrics,
    matchedPeriods,
  };
}

const ENTITY_SEARCH_ALIASES: Record<string, string[]> = {
  美国: ['美国', 'usa', 'u.s.', 'u.s.a.', 'united states', '美方', '美利坚'],
  中国: ['中国', 'china', '我国', '全国', '内地'],
  日本: ['日本', 'japan'],
  德国: ['德国', 'germany'],
  英国: ['英国', 'united kingdom', 'uk'],
};

/** Use the same country aliases for hard matching, ranking and saved metadata. */
function matchingEntityTerms(text: string, entities: string[]): string[] {
  return entities.filter((entity) =>
    [
      entity,
      ...(ENTITY_SEARCH_ALIASES[entity] ?? []),
      ...countrySearchAliases(entity),
    ].some((term) => containsSearchTerm(text, term)),
  );
}

export function textMatchesPlanEntities(
  text: string,
  plan: ResearchQueryPlan,
): boolean {
  if (
    plan.regions?.length &&
    !plan.regions.some((region) => containsSearchTerm(text, region))
  ) {
    return false;
  }
  if (!plan.entities.length) return true;
  return matchingEntityTerms(text, plan.entities).length > 0;
}

/** Local evidence must discuss the requested place, beyond an incidental mention. */
export function textFocusesOnPlanRegions(
  title: string,
  content: string,
  plan: ResearchQueryPlan,
): boolean {
  const regions = plan.regions ?? [];
  if (!regions.length) return true;
  if (regions.some((region) => containsSearchTerm(title, region))) return true;
  // A broad multi-city roundup must not become city-specific evidence just
  // because the city appears once in a list of national economic results.
  if (
    !regions.some((region) => containsSearchTerm(content.slice(0, 300), region))
  ) {
    return false;
  }
  const occurrences = (region: string) => content.split(region).length - 1;
  const requestedMentions = regions.reduce(
    (sum, region) => sum + occurrences(region),
    0,
  );
  const otherMentions = inferQueryRegions(content)
    .filter(
      (region) =>
        !regions.some(
          (requested) =>
            region.includes(requested) || requested.includes(region),
        ),
    )
    .reduce((sum, region) => sum + occurrences(region), 0);
  return requestedMentions > otherMentions;
}

export function shouldKeepDocument(
  text: string,
  plan: ResearchQueryPlan,
  hardMatcher: (text: string) => boolean,
): boolean {
  // Scores rank candidates; they must never override an explicit dimension.
  return textMatchesPlanEntities(text, plan) && hardMatcher(text);
}

export function attachRelevanceMetadata(
  metadata: Record<string, unknown> | undefined,
  relevance: DocumentRelevanceScore,
): Record<string, unknown> {
  return {
    ...(metadata ?? {}),
    relevanceScore: relevance.score,
    matchedEntities: relevance.matchedEntities,
    matchedMetrics: relevance.matchedMetrics,
    matchedPeriods: relevance.matchedPeriods,
  };
}

/** Share metric aliases between the hard matcher and relevance scoring. */
function expandSearchTerms(
  terms: string[],
  kind: 'entity' | 'metric' = 'entity',
): string[] {
  const aliases = dictionaryAliases();
  const builtins: Record<string, string[]> = {
    gdp: ['国内生产总值', '地区生产总值', 'gross domestic product'],
    cpi: ['居民消费价格指数', '消费者价格指数', 'consumer price index'],
    ppi: ['工业生产者出厂价格指数', 'producer price index'],
    pmi: ['采购经理指数', 'purchasing managers index'],
  };
  const equivalents = [
    ...Object.entries(builtins),
    ...Object.entries(aliases),
  ].map(([alias, names]) => [alias, ...names]);
  return [
    ...new Set(
      terms.flatMap((term) => {
        const normalized = term.trim().toLowerCase();
        return [
          normalized,
          ...(kind === 'metric' ? metricAliases(term) : []),
          ...equivalents.flatMap((group) =>
            group.some((value) => value.toLowerCase() === normalized)
              ? group
              : [],
          ),
        ];
      }),
    ),
  ].filter(Boolean);
}

/** Match each requested dimension, allowing alternatives within a dimension. */
export function buildRelevanceMatcher(
  resolution: SemanticResolution,
  filters?: Partial<ResearchFilters>,
): (text: string) => boolean {
  const expand = (terms: string[], kind: 'entity' | 'metric' = 'entity') =>
    expandSearchTerms(
      bilingualResearchTerms(terms, resolution.sourcePlan, kind),
      kind,
    );
  const groups = [
    expand(
      [
        ...(resolution.discovery?.metrics ?? []),
        ...resolution.metrics.flatMap((item) => [
          item.name,
          item.code,
          ...(item.aliases ?? []),
        ]),
        ...(filters?.indicators ?? []),
      ],
      'metric',
    ),
    expand([
      ...(resolution.discovery?.entities ?? []),
      ...resolution.entities.flatMap((item) => [
        item.name,
        item.code,
        ...(item.aliases ?? []),
      ]),
      ...(filters?.entities ?? []),
    ]),
    expand([
      ...resolution.dimensions
        .filter((item) => item.type === 'country_region')
        .flatMap((item) => [
          item.name,
          item.code,
          item.value ?? '',
          ...(item.aliases ?? []),
        ]),
      ...(filters?.countries ?? []),
    ]).filter((term) => !/^[a-z]{1,2}$/i.test(term)),
    expand([
      ...resolution.dimensions
        .filter((item) => /^(region|province|city|area)$/.test(item.type))
        .flatMap((item) => [
          item.name,
          item.value ?? '',
          ...(item.aliases ?? []),
        ]),
      ...(filters?.regions ?? []),
    ]),
  ].filter((group) => group.length > 0);

  // Years remain ranking signals: a multi-year table may omit the requested
  // year in its excerpt, and requiring every year would destroy recall.
  return (text) =>
    groups.every((group) =>
      group.some((term) => containsSearchTerm(text, term)),
    );
}
