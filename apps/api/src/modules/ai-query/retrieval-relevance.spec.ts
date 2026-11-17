import {
  buildRelevanceMatcher,
  scoreDocumentRelevance,
  shouldKeepDocument,
  textFocusesOnPlanRegions,
} from './retrieval-relevance';
import { buildResearchQueryPlan, buildResearchQueryPlanLite } from '../search/research-query-plan';
import type { SemanticResolution } from '../semantic/semantic.types';

const resolution: SemanticResolution = {
  metrics: [{ code: 'GDP', name: '国内生产总值', indicatorId: 'gdp' }],
  entities: [],
  concepts: [],
  dimensions: [{ type: 'country_region', code: 'CN', name: '中国' }],
  time: { type: 'RANGE', start: '2020', end: '2025' },
  confidence: 1,
  intent: 'metric_query',
};

describe('retrieval relevance', () => {
  it.each([
    ['消费者价格指数', 'consumer_price_index', 'China Consumer Price Index'],
    ['劳动力参与率', 'labor_participation', 'China Labor force participation rate'],
    ['商品出口额', 'goods_export_value', 'China Merchandise exports'],
    ['电力生产量', 'electricity_output', 'China Electricity generation'],
  ])('shares %s aliases across hard matching and scoring without model translations', (name, code, text) => {
    const current = { ...resolution, metrics: [{ name, code, indicatorId: code }] };
    expect(buildRelevanceMatcher(current)(text)).toBe(true);
    const plan = buildResearchQueryPlan({
      originalQuery: `中国${name}`, optimizedQuery: `中国${name}`, resolution: current,
      filters: { countries: [], regions: [], entities: [], indicators: [], timeRanges: [], sources: [] },
    });
    expect(scoreDocumentRelevance(text, plan).matchedMetrics).toContain(name);
  });

  it('does not broaden per-capita GDP codes to total GDP', () => {
    const current = {
      ...resolution,
      metrics: [{ name: '人均国内生产总值', code: 'gdp_per_capita', indicatorId: 'per-capita' }],
    };
    const matches = buildRelevanceMatcher(current);
    expect(matches('China GDP per capita annual series')).toBe(true);
    expect(matches('China GDP annual series')).toBe(false);
  });

  it('matches translated population indicators with harmless wording differences', () => {
    const population: SemanticResolution = {
      ...resolution,
      metrics: [{ code: 'population_total', name: '国家人口总量', indicatorId: 'population' }],
      sourcePlan: {
        status: 'ready', intentSummary: '查询人口总量', dataNeeds: ['人口总量'],
        allowDiscovery: false, sources: [],
        translations: [{ zh: '人口总量', en: 'Total Population' }],
      },
    };
    const matches = buildRelevanceMatcher(population);
    expect(matches('China Total Population annual estimates')).toBe(true);
    expect(matches('China population growth rate')).toBe(false);
    expect(matches('Japan Total Population annual estimates')).toBe(false);
    const plan = buildResearchQueryPlan({
      originalQuery: '中国人口总量', optimizedQuery: '中国人口总量', resolution: population,
      filters: { countries: [], regions: [], entities: [], indicators: [], timeRanges: [], sources: [] },
    });
    const relevance = scoreDocumentRelevance('China Total Population annual estimates', plan);
    expect(relevance.matchedEntities).toContain('中国');
    expect(relevance.matchedMetrics).toContain('Total Population');
    expect(relevance.score).toBeGreaterThanOrEqual(0.42);
  });
  it('requires locality focus in generic titles while allowing local data hosted elsewhere', () => {
    const plan = buildResearchQueryPlanLite('泉州近10年来经济报告');
    expect(textFocusesOnPlanRegions('经济运行报告', '泉州市地区生产总值增长6.5%，泉州产业结构持续优化。', plan)).toBe(true);
    expect(textFocusesOnPlanRegions('各地GDP成绩单', '北京、上海、泉州、广州2024年经济数据。', plan)).toBe(false);
    expect(textFocusesOnPlanRegions('泉州经济报告', '来源：北京，泉州GDP增长6.5%。', plan)).toBe(true);
  });
  it('never lets country/year relevance override a mismatched indicator', () => {
    const plan = buildResearchQueryPlanLite('中国2023年和2024年GDP', {
      indicators: ['GDP'],
    });
    expect(
      shouldKeepDocument(
        '中国2023年和2024年居民收入统计',
        plan,
        buildRelevanceMatcher(resolution),
      ),
    ).toBe(false);
    expect(
      shouldKeepDocument(
        '中国2023年国内生产总值统计',
        plan,
        buildRelevanceMatcher(resolution),
      ),
    ).toBe(true);
  });
  it('rejects a wrong metric or country even when a year matches', () => {
    const matches = buildRelevanceMatcher(resolution);
    expect(matches('中国 2025年 居民收入')).toBe(false);
    expect(matches('美国 2025年 GDP')).toBe(false);
    expect(matches('中国 2025年 GDP数据')).toBe(true);
  });

  it('accepts abbreviations, translations and multi-year tables without every year in the excerpt', () => {
    const matches = buildRelevanceMatcher(resolution);
    expect(matches('China gross domestic product annual series')).toBe(true);
    expect(matches('中国 国内生产总值历年数据')).toBe(true);
    expect(matches('中国 GDP 2022年 1210207亿元')).toBe(true);
    expect(matches('China GDPC deflator')).toBe(false);
  });

  it('requires an indicator and entity separately and accepts catalog aliases', () => {
    const matches = buildRelevanceMatcher({
      ...resolution,
      dimensions: [],
      metrics: [
        {
          code: 'revenue',
          name: '营业收入',
          indicatorId: 'revenue',
          aliases: ['营收'],
        },
      ],
      entities: [
        {
          code: 'company-a',
          name: '甲公司',
          entityId: 'a',
          aliases: ['甲集团'],
        },
      ],
    });
    expect(matches('甲公司就业人数')).toBe(false);
    expect(matches('乙公司营业收入')).toBe(false);
    expect(matches('甲集团营收100亿元')).toBe(true);
  });

  it('uses selected filters when semantic parsing did not recognize the question', () => {
    const empty = { ...resolution, metrics: [], dimensions: [] };
    const matches = buildRelevanceMatcher(empty, {
      indicators: ['GDP'],
      countries: ['中国', '美国'],
    });
    expect(matches('美国 国内生产总值')).toBe(true);
    expect(matches('中国 居民收入')).toBe(false);
    expect(matches('日本 GDP')).toBe(false);
    expect(buildRelevanceMatcher(empty)('未解析的问题')).toBe(true);
  });

  it('does not treat two-letter country codes as English prepositions', () => {
    const matches = buildRelevanceMatcher({
      ...resolution,
      dimensions: [{ type: 'country_region', code: 'IN', name: '印度' }],
    });
    expect(matches('GDP in China')).toBe(false);
    expect(matches('GDP in India')).toBe(true);
  });
});
