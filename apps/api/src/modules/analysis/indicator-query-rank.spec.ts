import { WPP_METRICS } from '../../research/population-metrics';
import {
  normalizeIndicatorQueryText,
  rankIndicatorsForQuery,
  selectIndicatorsForExtraction,
  inferQueryDimensionHints,
  type RankableIndicator,
} from './indicator-query-rank';

const catalog: RankableIndicator[] = [
  {
    id: '1',
    code: 'gdp_current_usd',
    name: '国内生产总值(现价美元)',
    unit: '美元',
    definition: '按现价美元计的国内生产总值',
    aliases: ['国内生产总值', 'GDP'],
  },
  {
    id: '2',
    code: 'gdp_real_growth',
    name: 'GDP实际增速',
    unit: '%',
    definition: '不变价GDP同比增速',
    aliases: ['实际增速'],
  },
  {
    id: '3',
    code: 'gdp_per_capita',
    name: '人均GDP',
    unit: '美元/人',
    definition: 'GDP除以年中人口',
    aliases: ['人均国内生产总值'],
  },
  {
    id: '4',
    code: 'cpi_inflation',
    name: '通货膨胀率(CPI)',
    unit: '%',
    definition: '居民消费价格指数同比涨幅',
    aliases: ['通胀'],
  },
];

describe('indicator-query-rank', () => {
  it('keeps independent economic report indicators instead of narrowing all hints to growth', () => {
    const result = selectIndicatorsForExtraction(
      '泉州近10年来经济报告以及未来10年预测',
      catalog,
      {
        indicatorHints: ['国内生产总值(现价美元)', 'GDP实际增速', '人均GDP'],
      },
    );
    expect(result.preferredCodes).toEqual([
      'gdp_current_usd',
      'gdp_real_growth',
      'gdp_per_capita',
    ]);
    expect(result.preferredCodes).not.toContain('cpi_inflation');
  });

  it('includes GDP level and growth for a broad economic report without semantic hints', () => {
    expect(
      selectIndicatorsForExtraction(
        '泉州近10年来经济报告以及未来10年预测',
        catalog,
      ).preferredCodes,
    ).toEqual(expect.arrayContaining(['gdp_current_usd', 'gdp_real_growth']));
  });

  it('keeps explicit GDP level requests ahead of a suggested growth indicator', () => {
    expect(
      selectIndicatorsForExtraction('泉州GDP数据', catalog, {
        indicatorHints: ['GDP实际增速'],
      }).preferredCodes,
    ).toEqual(['gdp_current_usd']);
  });

  it.each(['中国人均GDP数据', 'China GDP per capita'])(
    'selects per-capita GDP for %s',
    (query) => {
      expect(
        selectIndicatorsForExtraction(query, catalog).preferredCodes,
      ).toEqual(['gdp_per_capita']);
    },
  );
  it('does not treat another indicator data request as a GDP level request', () => {
    expect(
      selectIndicatorsForExtraction('CPI数据', catalog).preferredCodes,
    ).toEqual(['cpi_inflation']);
  });
  it('keeps independently requested GDP and CPI series', () => {
    expect(
      selectIndicatorsForExtraction('中国GDP和CPI数据', catalog).preferredCodes,
    ).toEqual(expect.arrayContaining(['gdp_current_usd', 'cpi_inflation']));
  });
  it('normalizes full-width gdp tokens', () => {
    expect(normalizeIndicatorQueryText('分析ＧＤＰ数据')).toContain('gdp');
  });

  it('prefers GDP level over growth for “近5年中国GDP数据”', () => {
    const ranked = rankIndicatorsForQuery(
      '请你帮我分析一下近5年 中国每一年的GDP数据',
      catalog,
    );
    expect(ranked[0]?.code).toBe('gdp_current_usd');
    expect(
      ranked.find((item) => item.code === 'gdp_real_growth')!.score,
    ).toBeLessThan(ranked[0]!.score);
  });

  it('prefers growth when the question asks for 增速', () => {
    const ranked = rankIndicatorsForQuery('近五年中国GDP实际增速', catalog);
    expect(ranked[0]?.code).toBe('gdp_real_growth');
    expect(
      selectIndicatorsForExtraction('国内生产总值增速', catalog).preferredCodes,
    ).toEqual(['gdp_real_growth']);
  });

  it('keeps both series when the question asks for GDP level and growth', () => {
    expect(
      selectIndicatorsForExtraction('中国GDP总量和增速', catalog)
        .preferredCodes,
    ).toEqual(expect.arrayContaining(['gdp_current_usd', 'gdp_real_growth']));
  });

  it('narrows extraction catalog to query-relevant indicators', () => {
    const result = selectIndicatorsForExtraction('近5年中国GDP数据', catalog);
    expect(result.narrowed).toBe(true);
    expect(result.preferredCodes).toEqual(['gdp_current_usd']);
    expect(result.selected.map((item) => item.code)).toEqual([
      'gdp_current_usd',
    ]);
  });

  it('infers China and last-5 completed years from the question', () => {
    const hints = inferQueryDimensionHints(
      '请你帮我分析一下近5年 中国每一年的GDP数据',
    );
    expect(hints.entities).toEqual(['中国']);
    expect(hints.periods).toHaveLength(5);
    expect(hints.periods.at(-1)).toBe(String(new Date().getFullYear() - 1));
    expect(hints.promptBlock).toContain('期望实体/国家：中国');
    expect(hints.promptBlock).toContain('期望年份：');
  });

  it('recognizes Chinese numerals in recent-year ranges', () => {
    expect(inferQueryDimensionHints('研究近五年GDP').periods).toEqual(
      inferQueryDimensionHints('研究近5年GDP').periods,
    );
  });

  it('exposes query dimensions as the workspace filter source of truth', () => {
    const hints = inferQueryDimensionHints('近5年中国GDP数据');
    expect(hints.entities).toContain('中国');
    expect(hints.periods).toEqual(
      expect.arrayContaining([
        String(new Date().getFullYear() - 5),
        String(new Date().getFullYear() - 1),
      ]),
    );
  });
});

  it('selects all four population metrics without substituting world totals or birth rates', () => {
    const populationCatalog = [...WPP_METRICS.map((metric) => ({ id: metric.code, code: metric.code, name: metric.name, unit: metric.unit, definition: metric.name, aliases: metric.code === 'population_total' ? ['人口总量','人口总数','Total population','总人口'] : [] })),
      { id: 'world', code: 'world_population', name: '世界人口总数', unit: '人', definition: '全球人口', aliases: [] },
      { id: 'cbr', code: 'crude_birth_rate', name: '出生率', unit: '‰', definition: '出生率', aliases: [] }];
    const selected = selectIndicatorsForExtraction('中国美国人口总量、总和生育率、新生人口、移民人口', populationCatalog);
    expect(new Set(selected.preferredCodes)).toEqual(new Set(WPP_METRICS.map((metric) => metric.code)));
    expect(selectIndicatorsForExtraction('总和生育率', populationCatalog).preferredCodes).toEqual(['tfr']);
  });
