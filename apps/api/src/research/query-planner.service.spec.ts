import { QueryPlannerService } from './query-planner.service';
import type { ResearchCatalog } from './research-catalog.service';

const entry = (value: string, aliases: string[] = []) => ({
  value,
  label: value,
  aliases,
});

const catalog: ResearchCatalog = {
  entries: {
    countries: [
      entry('中国', ['China']),
      entry('日本', ['Japan']),
      entry('韩国', ['South Korea']),
    ],
    regions: [entry('东亚')],
    entities: [],
    indicators: [entry('城镇人口占比', ['城镇人口'])],
    timeRanges: [],
    sources: [entry('世界银行', ['World Bank'])],
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

describe('QueryPlannerService', () => {
  const planner = new QueryPlannerService();

  it('keeps France and Russia even when the backend catalog does not list them', () => {
    expect(planner.plan('中国 美国 法国 英国 俄罗斯 GDP', catalog).countries)
      .toEqual(expect.arrayContaining(['中国', '美国', '法国', '英国', '俄罗斯']));
  });

  it('recognizes countries, indicator, time range and comparison intent', () => {
    const plan = planner.plan(
      '比较中国、日本与韩国2015-2024年城镇人口占比变化',
      catalog,
      {
        countries: [],
        regions: ['东亚'],
        entities: [],
        indicators: [],
        timeRanges: [],
        sources: ['世界银行'],
      },
    );

    expect(plan.countries).toEqual(
      expect.arrayContaining(['中国', '日本', '韩国']),
    );
    expect(plan.indicators).toContain('城镇人口占比');
    expect(plan.timeRanges).toContain('2015-2024');
    expect(plan.intent).toBe('comparison');
    expect(plan.sources).toContain('世界银行');
  });

  it('ignores empty aliases instead of matching every catalog entry', () => {
    const plan = planner.plan('人口老龄化趋势', {
      ...catalog,
      entries: {
        ...catalog.entries,
        countries: [entry('美国', [''])],
      },
    });

    expect(plan.countries).toEqual([]);
  });
});
