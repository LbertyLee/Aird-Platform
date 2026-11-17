jest.mock('@prisma/client', () => ({ CommonStatus: { active: 'active' } }));
jest.mock('../../infrastructure/ai/deepseek-chat.service', () => ({
  DeepSeekChatService: class DeepSeekChatService {},
}));
jest.mock('../../infrastructure/prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { SemanticResolutionService } from './semantic-resolution.service';

describe('SemanticResolutionService local geography', () => {
  function setup(parsed: Record<string, unknown> | null, ready = true) {
    const prisma = {
      dataset: { findMany: async () => [] },
      indicator: { findMany: async () => [] },
      semanticEntity: { findMany: async () => [] },
      semanticConcept: { findMany: async () => [] },
      dictionaryItem: {
        findMany: async () => [
          { type: 'country_region', code: 'CN', name: '中国', aliases: [] },
        ],
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
});
