import type { ResearchFilters } from '@agent/contracts';

export type FilterKey = keyof ResearchFilters;
export const filterDefinitions = [
  { key: 'countries' as const, label: '国家 / 地区', placeholder: '国家 / 地区' },
  { key: 'indicators' as const, label: '统计指标', placeholder: '统计指标' },
  { key: 'timeRanges' as const, label: '时间', placeholder: '时间' },
];

export function emptyResearchFilters(): ResearchFilters {
  return {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
  };
}
