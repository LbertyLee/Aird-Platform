import type { ResearchFilters } from '@agent/contracts';
import type { ResearchCatalog } from './research-catalog.service';
import {
  buildExternalSearchQueries,
  externalSearchDomains,
  matchesResearchFilters,
} from './research-filtering';

const filters: ResearchFilters = {
  countries: ['中国', '日本'],
  regions: [],
  entities: [],
  indicators: ['国内生产总值'],
  timeRanges: ['2022-2026'],
  sources: [],
};

const catalog: ResearchCatalog = {
  entries: {
    countries: [
      { value: '中国', label: '中国', aliases: ['China'] },
      { value: '日本', label: '日本', aliases: ['Japan'] },
    ],
    regions: [],
    entities: [],
    indicators: [
      { value: '国内生产总值', label: '国内生产总值', aliases: ['GDP'] },
    ],
    timeRanges: [],
    sources: [],
  },
  filters: {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
  },
};

describe('research filtering', () => {
  it('uses OR within a dimension and AND across dimensions', () => {
    expect(
      matchesResearchFilters(
        { text: 'Japan GDP increased in 2024' },
        filters,
        catalog,
      ),
    ).toBe(true);
    expect(
      matchesResearchFilters(
        { text: 'Brazil GDP increased in 2024' },
        filters,
        catalog,
      ),
    ).toBe(false);
    expect(
      matchesResearchFilters({ text: '中国人口统计 2024' }, filters, catalog),
    ).toBe(false);
  });

  it('matches selected historical and future year ranges', () => {
    const range = { ...filters, countries: [], indicators: [], timeRanges: ['1950-2100'] };
    expect(matchesResearchFilters({ text: '人口统计 1950 和 2100' }, range, catalog)).toBe(true);
    expect(matchesResearchFilters({ text: '人口统计 1949' }, range, catalog)).toBe(false);
  });

  it('branches external search by one OR dimension without cartesian explosion', () => {
    const queries = buildExternalSearchQueries('经济趋势', filters);

    expect(queries).toHaveLength(2);
    expect(queries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('中国'),
        expect.stringContaining('日本'),
      ]),
    );
    expect(queries.every((query) => query.includes('国内生产总值'))).toBe(true);
  });

  it('keeps the user question and every effective filter dimension', () => {
    expect(
      buildExternalSearchQueries('GDP trend', {
        countries: ['China'],
        regions: [],
        entities: [],
        indicators: ['GDP'],
        timeRanges: ['2020-2024'],
        sources: ['World Bank'],
      }),
    ).toEqual(['GDP trend China GDP 2020-2024 World Bank']);
  });

  it('constrains recognized official sources to their domains', () => {
    const catalogWithWorldBank: ResearchCatalog = {
      ...catalog,
      entries: {
        ...catalog.entries,
        sources: [
          {
            value: 'World Bank',
            label: 'World Bank',
            aliases: ['世界银行'],
          },
        ],
      },
    };
    expect(externalSearchDomains(['World Bank'], catalogWithWorldBank)).toEqual([
      'worldbank.org',
      'data.worldbank.org',
    ]);
  });
});
