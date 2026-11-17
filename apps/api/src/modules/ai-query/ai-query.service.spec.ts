import { ConfigService } from '@nestjs/config';
import { AiQueryService } from './ai-query.service';
import type { SemanticResolution } from '../semantic/semantic.types';
import type { ResearchFilters } from '@agent/contracts';
import type { ExaResult } from '../../research/research.types';
import { buildResearchQueryPlan } from '../search/research-query-plan';
import { ResearchPlanningGraphService } from '../search/research-planning-graph.service';
import { WorldBankDataService } from '../../research/world-bank-data.service';

jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class {},
  COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));

describe('AiQueryService external relevance', () => {
  const resolution: SemanticResolution = {
    sourcePlan: {
      status: 'ready', intentSummary: '查询中国GDP', dataNeeds: ['中国GDP'], allowDiscovery: false,
      sources: [{ websiteUrl: 'https://www.stats.gov.cn', query: '中国GDP', reason: '官方统计数据' }],
    },
    metrics: [{ code: 'GDP', name: '国内生产总值', indicatorId: 'gdp' }],
    dimensions: [{ type: 'country_region', code: 'CN', name: '中国' }],
    entities: [],
    concepts: [],
    time: { type: 'UNKNOWN' },
    confidence: 1,
    intent: 'metric_query',
  };
  const filters: ResearchFilters = {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
  };
  const plan = buildResearchQueryPlan({
    originalQuery: '中国GDP',
    filters,
    optimizedQuery: '中国GDP',
    resolution,
  });
  const result = (
    title: string,
    url: string,
    description = '',
    extraSnippets: string[] = [],
  ): ExaResult => ({
    title,
    url,
    description,
    extraSnippets,
    score: 0.99,
  });

  function setup(config: Record<string, unknown> = {}) {
    const args = [
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      {},
      new ConfigService(config),
    ] as unknown as ConstructorParameters<typeof AiQueryService>;
    const service = new AiQueryService(...args);
    const worldBank = new WorldBankDataService();
    jest.spyOn(worldBank, 'fetch').mockResolvedValue([]);
    Object.assign(service, { worldBank });
    Object.assign(service, { chat: { translateDisplayNames: jest.fn().mockResolvedValue({}) } });
    return service;
  }

  it('ranks by platform composite + Exa score and prefers on-topic pages', async () => {
    const service = setup();
    const relevant = result('年度统计表', 'https://www.stats.gov.cn/gdp', '', [
      '中国 GDP 140万亿元',
    ]);
    const hits = await service['rerankExternalResults'](
      '中国GDP',
      [
        result('中国就业统计', 'https://www.stats.gov.cn/jobs'),
        result('美国 GDP', 'https://example.gov/us'),
        relevant,
      ],
      resolution,
      filters,
      plan,
    );
    expect(hits.map((hit) => hit.url)[0]).toBe(relevant.url);
    expect(hits.length).toBe(3);
    expect(hits[0]?.platformScore).toBeGreaterThan(0);
    expect(hits[0]?.exaScore).toBeGreaterThan(0);
    expect(hits[0]?.score).toBeCloseTo(
      0.5 * (hits[0]?.platformScore ?? 0) + 0.5 * (hits[0]?.exaScore ?? 0),
      5,
    );
  });

  it('uses official data without a web-search key and persists rows without an LLM extraction pass', async () => {
    const service = setup();
    const bank = new WorldBankDataService();
    const fetch = jest.spyOn(bank, 'fetch').mockResolvedValue([{
      title: 'World Bank GDP', sourceUrl: 'https://api.worldbank.org/v2/country/RUS/indicator/NY.GDP.MKTP.CD',
      textContent: 'Russian Federation 2024 GDP 100', metadata: {},
      structuredData: [{ country: 'Russian Federation', countryCode: 'RUS', year: 2024, value: 100, unit: '美元', indicatorCode: 'NY.GDP.MKTP.CD', catalogIndicatorCode: 'gdp_current_usd' }],
    }]);
    const searchSources = jest.fn();
    const evaluateResearchEvidence = jest.fn();
    const saveExternalEvidence = jest.fn();
    Object.assign(service, {
      worldBank: bank, prisma: { dataset: { findMany: async () => [] } },
      exa: { configured: false, searchSources }, chat: { evaluateResearchEvidence, translateDisplayNames: jest.fn().mockResolvedValue({}) }, evidence: { saveExternalEvidence },
    });
    const text = '俄罗斯2024年GDP';
    const currentPlan = buildResearchQueryPlan({ originalQuery: text, optimizedQuery: text, filters, resolution: { ...resolution, dimensions: [], sourcePlan: undefined } });
    const response = await service['collectExternalSearchEvidence']({ aiQueryId: 'official', resolution: { ...resolution, sourcePlan: undefined }, normalized: text, optimizedQuery: text, normalizedFilters: filters, plan: currentPlan });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(searchSources).not.toHaveBeenCalled();
    expect(evaluateResearchEvidence).not.toHaveBeenCalled();
    expect(response.evidenceCount).toBe(1);
    expect(saveExternalEvidence.mock.calls[0][1][0]).toMatchObject({
      url: expect.stringContaining('https://api.worldbank.org/'),
      metadata: { provider: 'world-bank-api', contentMode: 'structured', researchLoop: { stopReason: 'sufficient', rounds: 1 }, structuredData: [expect.objectContaining({ indicatorCode: 'gdp_current_usd' })] },
    });
  });

  it('returns scored candidates without a hard cutoff', async () => {
    const candidate = result('中国 GDP', 'https://www.stats.gov.cn/gdp');
    const service = setup();
    const hits = await service['rerankExternalResults'](
      '中国GDP',
      [candidate],
      resolution,
      filters,
      plan,
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]?.score).toBeGreaterThan(0);
  });

  it('queries only planned websites and retains English evidence for a Chinese research question', async () => {
    const service = setup();
    const dynamic: SemanticResolution = {
      ...resolution, metrics: [], dimensions: [],
      discovery: { metrics: ['工业机器人密度'], entities: ['印度尼西亚'], dataNeeds: ['机器人密度'], websites: [] },
      sourcePlan: {
        status: 'ready', intentSummary: '查询印度尼西亚工业机器人密度', dataNeeds: ['工业机器人密度'], allowDiscovery: true,
        sources: [{ websiteUrl: 'https://ifr.org', query: 'Indonesia industrial robot density 2024', reason: '国际机器人统计' }],
        translations: [{ zh: '工业机器人密度', en: 'industrial robot density' }, { zh: '印度尼西亚', en: 'Indonesia' }],
      },
    };
    const dynamicPlan = buildResearchQueryPlan({ originalQuery: '印度尼西亚2024年工业机器人密度', filters,
      optimizedQuery: '印度尼西亚2024年工业机器人密度', resolution: dynamic });
    const searchSources = jest.fn().mockResolvedValue({
      results: [{ sourceId: '', sourceName: '', results: [result('Indonesia industrial robot density 2024', 'https://ifr.org/report',
        'Indonesia industrial robot density in 2024 is measured in robots per 10000 workers. This report documents national manufacturing automation statistics.')] }],
      attempted: 1, succeeded: 1, failed: 0, skipped: 0,
    });
    const discoverSources = jest.fn();
    const saveExternalEvidence = jest.fn();
    Object.assign(service, {
      prisma: { dataset: { findMany: async () => [
        { id: 'wb', name: '世界银行', websiteUrl: 'https://worldbank.org' },
        { id: 'un', name: '联合国', websiteUrl: 'https://un.org' },
      ] } }, exa: { configured: true, searchSources, discoverSources }, evidence: { saveExternalEvidence },
    });
    const response = await service['collectExternalSearchEvidence']({ aiQueryId: 'dynamic', resolution: dynamic,
      normalized: '印度尼西亚2024年工业机器人密度', optimizedQuery: '印度尼西亚2024年工业机器人密度', normalizedFilters: filters, plan: dynamicPlan });
    expect(searchSources).toHaveBeenCalledTimes(1);
    expect(searchSources).toHaveBeenCalledWith('Indonesia industrial robot density 2024', [{ id: '', name: '', websiteUrl: 'https://ifr.org' }], 'exa');
    expect(discoverSources).not.toHaveBeenCalled();
    expect(response.evidenceCount).toBe(1);
    expect(saveExternalEvidence.mock.calls[0][1][0].metadata.researchSourcePlan.intentSummary).toBe('查询印度尼西亚工业机器人密度');
  });

  it('retains English population evidence when translated metric wording differs', async () => {
    const service = setup();
    const population: SemanticResolution = {
      ...resolution,
      metrics: [{ code: 'population_total', name: '国家人口总量', indicatorId: 'population' }],
      sourcePlan: {
        status: 'ready', intentSummary: '查询中国人口总量', dataNeeds: ['中国人口总量'],
        allowDiscovery: false,
        sources: [{ websiteUrl: 'https://population.un.org', query: 'China Total Population', reason: '官方人口数据' }],
        translations: [{ zh: '人口总量', en: 'Total Population' }],
      },
    };
    const text = '中国国家人口总量';
    const currentPlan = buildResearchQueryPlan({ originalQuery: text, optimizedQuery: text, filters, resolution: population });
    const saveExternalEvidence = jest.fn();
    Object.assign(service, {
      prisma: { dataset: { findMany: async () => [] } },
      evidence: { saveExternalEvidence },
      exa: {
        configured: true,
        searchSources: jest.fn().mockResolvedValue({
          results: [{ sourceId: '', sourceName: '', results: [result(
            'World Population Prospects 2024', 'https://population.un.org/wpp/data',
            'China Total Population annual estimates and projections. Download statistical tables covering the historical population series and future projections.',
          )] }],
          attempted: 1, succeeded: 1, failed: 0, skipped: 0,
        }),
      },
    });
    const response = await service['collectExternalSearchEvidence']({
      aiQueryId: 'population', resolution: population, normalized: text,
      optimizedQuery: text, normalizedFilters: filters, plan: currentPlan,
    });
    expect(response.evidenceCount).toBe(1);
    expect(saveExternalEvidence).toHaveBeenCalledWith('population', [expect.objectContaining({
      url: 'https://population.un.org/wpp/data',
      metadata: expect.objectContaining({ matchedEntities: expect.arrayContaining(['中国']) }),
    })]);
  });

  it('resolves original locality and selected filters even when rewriting loses them', async () => {
    const service = setup();
    const resolve = jest.fn().mockResolvedValue(resolution);
    Object.assign(service, {
      planning: new ResearchPlanningGraphService(
        { resolve } as never,
        { optimizeResearchQuery: async () => '中国GDP', planResearchSources: async () => resolution.sourcePlan } as never,
        { dataset: { findMany: async () => [] } } as never,
      ),
    });
    const prepared = await service.prepareQuery('泉州经济报告及未来预测', {
      ...filters, indicators: ['GDP'],
    });
    expect(resolve).toHaveBeenCalledWith(expect.stringContaining('泉州经济报告及未来预测'));
    expect(resolve).toHaveBeenCalledWith(expect.stringContaining('GDP'));
    expect(prepared.plan.regions).toEqual(['泉州']);
  });

  it('does not persist unrelated external hits when every candidate fails relevance', async () => {
    const service = setup();
    const addExaEvidence = jest.fn();
    Object.assign(service, {
      prisma: {
        dataset: {
          findMany: async () => [
            {
              id: 'stats',
              name: '统计局',
              websiteUrl: 'https://www.stats.gov.cn',
            },
          ],
        },
      },
      evidence: { addExaEvidence },
      exa: {
        configured: true,
        searchSources: async () => ({
          results: [
            {
              sourceName: '统计局',
              results: [
                result(
                  '中国居民收入',
                  'https://www.stats.gov.cn/income',
                  '中国居民收入年度统计',
                ),
              ],
            },
          ],
        }),
      },
    });
    const response = await service['collectExternalSearchEvidence']({
      aiQueryId: 'query',
      resolution,
      normalized: '中国GDP',
      optimizedQuery: '中国GDP',
      normalizedFilters: filters,
      plan,
    });
    expect(addExaEvidence).not.toHaveBeenCalled();
    expect(response.evidenceCount).toBe(0);
    expect(response.evidenceBlocks).toEqual([]);
    expect(response.stages[0].status).toBe('completed');
  });

  it('persists all relevant external results when there are more than ten', async () => {
    const service = setup();
    const saveExternalEvidence = jest.fn();
    const results = Array.from({ length: 12 }, (_, index) =>
      result(
        `中国 GDP 统计 ${index + 1}`,
        `https://www.stats.gov.cn/gdp/${index + 1}`,
        '中国GDP年度统计数据',
      ),
    );
    Object.assign(service, {
      prisma: {
        dataset: {
          findMany: async () => [
            {
              id: 'stats',
              name: '统计局',
              websiteUrl: 'https://www.stats.gov.cn',
            },
          ],
        },
      },
      evidence: { saveExternalEvidence },
      exa: {
        configured: true,
        searchSources: async () => ({
          results: [{ sourceName: '统计局', results }],
          attempted: 1,
          succeeded: 1,
          failed: 0,
          skipped: 0,
        }),
      },
    });

    const response = await service['collectExternalSearchEvidence']({
      aiQueryId: 'query',
      resolution,
      normalized: '中国GDP',
      optimizedQuery: '中国GDP',
      normalizedFilters: filters,
      plan,
    });

    expect(saveExternalEvidence).toHaveBeenCalledTimes(1);
    expect(saveExternalEvidence.mock.calls[0]?.[1]).toHaveLength(12);
    expect(response.evidenceCount).toBe(12);
  });

  it('preserves separate annual reports with similar wording', () => {
    const service = setup();
    const hits = [
      result(
        '中国2023年国民经济统计公报',
        'https://example.gov/2023',
        '全年GDP126万亿元',
      ),
      result(
        '中国2024年国民经济统计公报',
        'https://example.gov/2024',
        '全年GDP135万亿元',
      ),
    ];
    expect(service['dedupeSimilarExternalResults'](hits)).toHaveLength(2);
  });

  it('keeps Quanzhou mandatory when semantic catalog matching missed it and query rewriting dropped it', () => {
    const service = setup();
    const localPlan = buildResearchQueryPlan({
      originalQuery: '中国福建泉州近10年来经济报告以及未来10年预测',
      optimizedQuery: '中国GDP经济报告2016-2025',
      resolution,
      filters,
    });
    expect(localPlan.searchQuery).toContain('泉州');
    expect(localPlan.searchQuery).toContain('未来10年预测');
    expect(service['isStrongExternalMatch'](result(
      '北京市人民政府：近十年我国GDP年均增长6.6%', 'https://beijing.gov.cn/gdp',
      '中国2016年到2025年GDP增长，全国经济发展报告。',
    ), localPlan)).toBe(false);
    expect(service['isStrongExternalMatch'](result(
      '亚洲及太平洋统计研究所', 'https://unescap.org/gdp',
      '中国GDP 2016-2025年统计。',
    ), localPlan)).toBe(false);
    expect(service['isStrongExternalMatch'](result(
      '多地公布2024年经济成绩单，GDP万亿城市再扩容', 'https://beijing.gov.cn/roundup',
      '泉州、北京、上海、广州、深圳等地2024年公布GDP数据，全国多地经济发展向好。',
    ), localPlan)).toBe(false);
    expect(service['isStrongExternalMatch'](result(
      '泉州2024年国民经济和社会发展统计公报', 'https://quanzhou.gov.cn/gdp',
      '2024年泉州市地区生产总值（GDP）13094.87亿元，同比增长6.5%。',
    ), localPlan)).toBe(true);
    expect(service['isStrongExternalMatch'](result(
      'left', 'https://data.stats.gov.cn/broken',
      `泉州 GDP 2024 ${'\uFFFD'.repeat(120)}`,
    ), localPlan)).toBe(false);
  });
});
