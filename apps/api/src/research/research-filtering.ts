import type { ResearchFilters } from '@agent/contracts';
import type {
  ResearchCatalog,
  ResearchCatalogEntry,
} from './research-catalog.service';

type FilterKey = Exclude<keyof ResearchFilters, 'libraryIds'>;

const TEXT_FILTER_KEYS: FilterKey[] = [
  'countries',
  'regions',
  'entities',
  'indicators',
  'sources',
  'timeRanges',
];

export interface ResearchFilterContext {
  text: string;
  datasetId?: string;
}

export interface ExternalSearchBranch {
  query: string;
  filters: ResearchFilters;
}

const OFFICIAL_SOURCE_DOMAINS: Array<{ terms: string[]; domains: string[] }> = [
  {
    terms: ['world bank', 'worldbank', '世界银行'],
    domains: ['worldbank.org', 'data.worldbank.org'],
  },
  {
    terms: ['international monetary fund', 'imf', '国际货币基金组织'],
    domains: ['imf.org'],
  },
  {
    terms: ['un data', 'united nations', '联合国', 'un population'],
    domains: ['data.un.org', 'un.org', 'population.un.org'],
  },
  { terms: ['oecd'], domains: ['oecd.org'] },
  {
    terms: ['our world in data', 'ourworldindata', 'maddison'],
    domains: ['ourworldindata.org'],
  },
];

const FILTER_KEYS: FilterKey[] = [
  'countries',
  'regions',
  'entities',
  'indicators',
  'timeRanges',
  'sources',
];

/** Same-dimension values are OR; every non-empty dimension must match. */
export function matchesResearchFilters(
  context: ResearchFilterContext,
  filters: ResearchFilters,
  catalog: ResearchCatalog,
): boolean {
  for (const key of TEXT_FILTER_KEYS) {
    if (key === 'timeRanges') continue;
    const selected = filters[key];
    if (selected.length === 0) continue;
    const matchesDimension = selected.some((value) => {
      const entry = findEntry(catalog.entries[key] ?? [], value);
      if (key === 'sources' && entry?.datasetId) {
        return context.datasetId === entry.datasetId;
      }
      return termsFor(value, entry).some((term) =>
        containsSearchTerm(context.text, term),
      );
    });
    if (!matchesDimension) return false;
  }

  return (
    filters.timeRanges.length === 0 ||
    filters.timeRanges.some((range) => matchesTimeRange(context.text, range))
  );
}

/**
 * External search has no metadata filter API. Branch one multi-value dimension
 * and express the remaining dimensions as OR groups to preserve coverage.
 */
export function buildExternalSearchQueries(
  query: string,
  filters: ResearchFilters,
  maxBranches = 8,
): string[] {
  return buildExternalSearchBranches(query, filters, maxBranches).map(
    (branch) => branch.query,
  );
}

/**
 * Uses one multi-select dimension as the coverage unit. This avoids a
 * cartesian product while allowing missing country branches to be refreshed.
 */
export function buildExternalSearchBranches(
  query: string,
  filters: ResearchFilters,
  maxBranches = 8,
): ExternalSearchBranch[] {
  const groups = FILTER_KEYS.map((key) => ({
    key,
    values: [...new Set(filters[key])].filter(Boolean),
  })).filter((group) => group.values.length > 0);
  if (groups.length === 0) return [{ query, filters: emptyFilters() }];

  const primary = groups.find((group) => group.values.length > 1);
  if (!primary) {
    return [
      {
        query: formatExternalQuery(query, groups),
        filters: filtersFromGroups(groups),
      },
    ];
  }

  const buckets = Array.from(
    { length: Math.min(primary.values.length, maxBranches) },
    () => [] as string[],
  );
  primary.values.forEach((value, index) => {
    buckets[index % buckets.length].push(value);
  });

  return buckets.map((values) => {
    const branchGroups = groups.map((group) =>
      group.key === primary.key ? { ...group, values } : group,
    );
    return {
      query: formatExternalQuery(query, branchGroups),
      filters: filtersFromGroups(branchGroups),
    };
  });
}

/** Converts recognized official-source filters into Exa domain constraints. */
export function externalSearchDomains(
  sources: string[],
  catalog: ResearchCatalog,
): string[] {
  const values = sources.flatMap((source) => {
    const entry = findEntry(catalog.entries.sources, source);
    return [source, entry?.label, ...(entry?.aliases ?? [])].filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );
  });
  const normalized = values.map((value) => value.toLowerCase());
  return [
    ...new Set(
      OFFICIAL_SOURCE_DOMAINS.flatMap(({ terms, domains }) =>
        terms.some((term) => normalized.some((value) => value.includes(term)))
          ? domains
          : [],
      ),
    ),
  ];
}

export function containsSearchTerm(text: string, term: string): boolean {
  const normalizedText = text.toLowerCase();
  const normalizedTerm = term.trim().toLowerCase();
  if (!normalizedTerm) return false;
  if (/^[a-z0-9_-]+$/i.test(normalizedTerm)) {
    return new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`,
      'i',
    ).test(normalizedText);
  }
  // 「5年」勿命中「2025年」这类年份尾缀
  if (/^\d+年$/.test(normalizedTerm)) {
    return new RegExp(`(?<!\\d)${escapeRegExp(normalizedTerm)}`).test(
      normalizedText,
    );
  }
  return normalizedText.includes(normalizedTerm);
}

function findEntry(
  entries: ResearchCatalogEntry[],
  value: string,
): ResearchCatalogEntry | undefined {
  return entries.find(
    (entry) => entry.value === value || entry.label === value,
  );
}

function termsFor(value: string, entry?: ResearchCatalogEntry): string[] {
  return [...new Set([value, entry?.label, ...(entry?.aliases ?? [])])].filter(
    (term): term is string => Boolean(term?.trim()),
  );
}

function matchesTimeRange(text: string, value: string): boolean {
  if (containsSearchTerm(text, value)) return true;
  const selected = value.match(
    /((?:19|20|21)\d{2})\s*[-—至到]\s*((?:19|20|21)\d{2})/,
  );
  if (!selected) return false;
  const start = Number(selected[1]);
  const end = Number(selected[2]);
  const years = text.match(/(?:19|20|21)\d{2}/g)?.map(Number) ?? [];
  return years.some((year) => year >= start && year <= end);
}

function formatExternalQuery(
  query: string,
  groups: Array<{ key: FilterKey; values: string[] }>,
): string {
  const constraints = groups.map(({ values }) =>
    values.length === 1 ? values[0] : `(${values.join(' 或 ')})`,
  );
  return [query, ...constraints].join(' ').trim();
}

function filtersFromGroups(
  groups: Array<{ key: FilterKey; values: string[] }>,
): ResearchFilters {
  const filters = emptyFilters();
  groups.forEach(({ key, values }) => {
    filters[key] = values;
  });
  return filters;
}

function emptyFilters(): ResearchFilters {
  return {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
