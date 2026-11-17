import type { ResearchFilters } from '@agent/contracts';

export function normalizeFilters(filters?: Partial<ResearchFilters>): ResearchFilters {
  const normalize = (values?: string[]) => [
    ...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
  return {
    countries: normalize(filters?.countries),
    regions: normalize(filters?.regions),
    entities: normalize(filters?.entities),
    indicators: normalize(filters?.indicators),
    timeRanges: normalize(filters?.timeRanges),
    sources: normalize(filters?.sources),
    ...(filters?.libraryIds?.length ? { libraryIds: normalize(filters.libraryIds) } : {}),
  };
}

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}
