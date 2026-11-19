jest.mock('@prisma/client', () => ({ CommonStatus: { active: 'active' }, LocationKind: { country: 'country', region: 'region' } }));
jest.mock('../../infrastructure/ai/deepseek-chat.service', () => ({
  DeepSeekChatService: class DeepSeekChatService {},
}));
jest.mock('../../infrastructure/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { SemanticResolutionService } from './semantic-resolution.service';
import { buildResearchQueryPlan } from '../search/research-query-plan';
import { buildRelevanceMatcher } from '../ai-query/retrieval-relevance';

describe('collective entity resolution', () => {
  const members = ['美国', '中国', '德国', '日本', '印度', '英国', '法国', '意大利', '加拿大', '巴西', '俄罗斯', '韩国'];
  const base = {
    metricCodes: ['gdp'], entityCodes: [], conceptCodes: [], dimensionCodes: [],
    time: { type: 'YEAR', value: 2025 }, confidence: 0.9, intent: 'metric_query',
  };
  const filters = { countries: [], regions: [], entities: [], indicators: [], timeRanges: [], sources: [] };
  function setup(results: unknown[], ready = true) {
    const parseSemanticQuery = jest.fn();
    for (const result of results) parseSemanticQuery.mockResolvedValueOnce(result);
    const service = new SemanticResolutionService({
      dataset: { findMany: async () => [] },
      indicator: { findMany: async () => [{ id: 'gdp-id', code: 'gdp', name: 'GDP', aliases: [] }] },
      semanticEntity: { findMany: async () => [{ id: 'china-id', code: 'CHN', name: '中国', canonicalName: '中国', aliases: [] }] },
      semanticConcept: { findMany: async () => [] },
      dictionaryItem: { findMany: async () => [] },
    } as never, { isReady: () => ready, parseSemanticQuery } as never);
    return { service, parseSemanticQuery };
  }

  it('grounds group members and carries all twelve candidates into retrieval', async () => {
    const { service, parseSemanticQuery } = setup([{
      ...base,
      entityGroups: [{ name: '主要经济体', basis: '按经济规模选择候选，需核实当年排名', members }],
    }]);
    const resolution = await service.resolve('主要经济体2025年GDP排名');
    expect(parseSemanticQuery).toHaveBeenCalledTimes(1);
    expect(resolution.entities).toEqual([expect.objectContaining({ entityId: 'china-id', name: '中国' })]);
    expect(resolution.discovery?.entities).toEqual(members.filter((name) => name !== '中国'));
    const plan = buildResearchQueryPlan({ originalQuery: '主要经济体2025年GDP排名', optimizedQuery: '', filters, resolution });
    expect(plan.entities).toEqual(expect.arrayContaining(members));
    expect(plan.entities).not.toContain('主要经济体');
    expect(plan.entityGroups?.[0].members).toHaveLength(12);
    expect(buildRelevanceMatcher(resolution)('Canada GDP 2025')).toBe(true);
  });

  it('repairs an omitted group once without overwriting the metric or year', async () => {
    const { service, parseSemanticQuery } = setup([
      { ...base, discovery: { entities: ['主要经济体'], metrics: [], dataNeeds: [], websites: [] } },
      { ...base, metricCodes: [], time: { type: 'YEAR', value: 2024 }, entityGroups: [{ name: '主要经济体', basis: '候选范围', members }] },
    ]);
    const result = await service.resolve('主要经济体2025年GDP排名');
    expect(parseSemanticQuery).toHaveBeenCalledTimes(2);
    expect(parseSemanticQuery.mock.calls[1][2]).toEqual({ expandEntityGroups: true });
    expect(result.time).toEqual({ type: 'YEAR', value: 2025 });
    expect(result.metrics[0].code).toBe('gdp');
    expect(result.discovery?.entities).not.toContain('主要经济体');
    expect(result.entityGroups?.[0].members).toEqual(members);
  });

  it('keeps a pending scope rather than inventing members when both attempts fail', async () => {
    const { service, parseSemanticQuery } = setup([base, null]);
    const result = await service.resolve('主要经济体有哪些');
    expect(parseSemanticQuery).toHaveBeenCalledTimes(2);
    expect(result.entities).toEqual([]);
    expect(result.entityGroups?.[0]).toMatchObject({ name: '主要经济体', members: [] });
  });

  it('fills a pending group when the repair returns concrete catalog entities only', async () => {
    const { service } = setup([
      { ...base, entityGroups: [{ name: '主要经济体', basis: '候选范围', members: [] }] },
      { ...base, entityCodes: ['CHN'] },
    ]);
    const result = await service.resolve('主要经济体有哪些');
    expect(result.entityGroups?.[0].members).toEqual(['中国']);
  });

  it('recognizes the scope without making a model request when no provider is configured', async () => {
    const { service, parseSemanticQuery } = setup([], false);
    const result = await service.resolve('主要经济体有哪些');
    expect(parseSemanticQuery).not.toHaveBeenCalled();
    expect(result.entityGroups?.[0]).toMatchObject({ name: '主要经济体', members: [] });
    expect(result.entities).toEqual([]);
  });

  it('does not expand an explicit country query', async () => {
    const { service, parseSemanticQuery } = setup([{ ...base, entityCodes: ['CHN'] }]);
    const result = await service.resolve('中国2025年GDP');
    expect(parseSemanticQuery).toHaveBeenCalledTimes(1);
    expect(result.entityGroups).toBeUndefined();
    expect(result.entities.map((entity) => entity.name)).toEqual(['中国']);
  });
});

describe('SemanticResolutionService local geography', () => {
  function setup(
    parsed: Record<string, unknown> | null,
    ready = true,
    dictionaryItems: Array<{ type: string; code: string; name: string; aliases: string[]; locationKind?: string }> = [
      { type: 'country_region', code: 'CN', name: '中国', aliases: [] },
    ],
  ) {
    const prisma = {
      dataset: { findMany: async () => [] },
      indicator: { findMany: async () => [] },
      semanticEntity: { findMany: async () => [] },
      semanticConcept: { findMany: async () => [] },
      dictionaryItem: {
        findMany: async () => dictionaryItems,
      },
    };
    const chat = {
      isReady: () => ready,
      parseSemanticQuery: async () => parsed,
    };
    return new SemanticResolutionService(prisma as never, chat as never);
  }

  it.each([true, false])(
    'recognizes an unseeded city with LLM ready=%s',
    async (ready) => {
      const service = setup(
        {
          metricCodes: [],
          entityCodes: [],
          conceptCodes: [],
          dimensionCodes: ['CN'],
          time: { type: 'UNKNOWN' },
          confidence: 0.9,
          intent: 'analysis',
        },
        ready,
      );
      const result = await service.resolve(
        '中国福建泉州近10年来经济报告以及未来10年预测',
      );
      expect(result.dimensions).toEqual([
        { type: 'region', code: '泉州', name: '泉州', value: '泉州' },
      ]);
      expect(result.time.type).toBe('RANGE');
    },
  );

  it('keeps local constraints when semantic parsing fails', async () => {
    const result = await setup(null).resolve('泉州市和厦门市经济对比');
    expect(result.dimensions.map((item) => item.name)).toEqual([
      '厦门',
      '泉州',
    ]);
  });

  it('preserves national queries', async () => {
    const result = await setup(null, false).resolve('中国GDP');
    expect(result.dimensions).toEqual([
      expect.objectContaining({ type: 'country_region', name: '中国' }),
    ]);
  });

  it('resolves GDP growth requests to the growth indicator instead of nominal GDP', async () => {
    const prisma = {
      dataset: { findMany: async () => [] },
      indicator: {
        findMany: async () => [
          {
            id: 'nominal',
            code: 'gdp_current_usd',
            name: '国内生产总值(现价美元)',
            aliases: [{ alias: 'GDP' }],
          },
          {
            id: 'growth',
            code: 'gdp_real_growth',
            name: 'GDP实际增速',
            aliases: [{ alias: 'GDP增长率' }],
          },
        ],
      },
      semanticEntity: { findMany: async () => [] },
      semanticConcept: { findMany: async () => [] },
      dictionaryItem: { findMany: async () => [] },
    };
    const chat = {
      isReady: () => true,
      parseSemanticQuery: async () => ({
        metricCodes: ['gdp_current_usd'],
        entityCodes: [],
        conceptCodes: [],
        dimensionCodes: [],
        time: { type: 'UNKNOWN' },
        confidence: 0.9,
        intent: 'metric_query',
      }),
    };
    const result = await new SemanticResolutionService(
      prisma as never,
      chat as never,
    ).resolve('比较2020-2025年中美GDP增长率');

    expect(result.metrics).toEqual([
      expect.objectContaining({
        code: 'gdp_real_growth',
        indicatorId: 'growth',
      }),
    ]);
  });

  it('grounds first-level administrative areas as regions', async () => {
    const service = setup({
      metricCodes: [], entityCodes: [], conceptCodes: [], dimensionCodes: ['US-CA'],
      time: { type: 'UNKNOWN' }, confidence: 0.9, intent: 'analysis',
    }, true, [
      { type: 'country_region', locationKind: 'country', code: 'US', name: '美国', aliases: ['United States'] },
      { type: 'country_region', locationKind: 'region', code: 'US-CA', name: 'California', aliases: [] },
    ]);

    const result = await service.resolve('California GDP and 泉州');

    expect(result.dimensions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'region', code: 'US-CA', name: 'California' }),
        expect.objectContaining({ type: 'region', name: '泉州' }),
      ]),
    );
  });
});
