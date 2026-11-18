import { ExternalSearchService } from './external-search.service';

jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class {}, COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));

describe('ExternalSearchService branch selection', () => {
  const filters = { countries: [], regions: [], entities: [], indicators: [], timeRanges: [], sources: [] };
  const resolution = { dimensions: [], entities: [], metrics: [], time: { type: 'UNKNOWN' }, intent: 'general', confidence: 1 };

  function setup(configured = true) {
    const ai = {
      prepareQuery: jest.fn().mockResolvedValue({ optimizedQuery: 'GDP', resolution, plan: {} }),
      execute: jest.fn().mockResolvedValue({ aiQueryId: 'q1', resolution, stages: [{ key: 'exa', status: 'completed', detail: 'Exa results' }], answer: 'GDP summary' }),
    };
    const repository = {
      createRun: jest.fn().mockResolvedValue('run1'), completeRun: jest.fn(), failRun: jest.fn(),
      createSource: jest.fn().mockImplementation(async (source) => ({ ...source, id: 's1' })),
    };
    const service = new ExternalSearchService(ai as never, {
      configured: true, isConfigured: () => configured,
    } as never, {
      queryEvidence: { findMany: async () => [{ id: 'e1', content: 'GDP\nSummary', metadataJson: { url: 'https://worldbank.org/gdp' }, score: 0.8 }] },
    } as never, repository as never);
    return { service, ai, repository };
  }

  it('routes AI search to its own mode and persists provider and history', async () => {
    const { service, ai, repository } = setup();
    const result = await service.search('user1', 'GDP', filters, { mode: 'ai-search' });
    expect(ai.execute).toHaveBeenCalledWith('GDP', filters, 'ai-search', expect.objectContaining({ userId: 'user1', disableInternalSearch: true }));
    expect(result.mode).toBe('ai-search');
    expect(result.stages[0].label).toBe('AI 搜索');
    expect(repository.createSource).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ provider: 'deepseek-search' }) }));
    expect(repository.completeRun).toHaveBeenCalledWith(expect.objectContaining({ resultJson: expect.objectContaining({ mode: 'ai-search' }) }));
  });

  it('keeps the existing external branch on Exa', async () => {
    const { service, ai, repository } = setup();
    expect((await service.search('user1', 'GDP', filters)).mode).toBe('exa');
    expect(ai.execute).toHaveBeenCalledWith('GDP', filters, 'exa', expect.any(Object));
    expect(repository.createSource).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ provider: 'exa-search' }) }));
  });

  it('fails clearly without a DeepSeek key instead of switching providers', async () => {
    const { service, ai, repository } = setup(false);
    await expect(service.search('user1', 'GDP', filters, { mode: 'ai-search' })).rejects.toThrow('AI 搜索未配置');
    expect(ai.execute).not.toHaveBeenCalled();
    expect(repository.createRun).not.toHaveBeenCalled();
  });

  it.each(['exa', 'ai-search'] as const)('preserves discovery in the %s response and history', async (mode) => {
    const { service, ai, repository } = setup();
    ai.execute.mockResolvedValueOnce({
      aiQueryId: 'q1', answer: '研究结果', stages: [],
      resolution: {
        ...resolution,
        time: { type: 'YEAR', value: 2025 },
        entities: [{ code: 'CHN', name: '中国', entityId: 'china' }],
        metrics: [{ code: 'GDP', name: 'GDP', indicatorId: 'gdp' }],
        dimensions: [{ type: 'industry', code: 'industry', name: '行业' }],
        discovery: {
          entities: ['中国', '主要经济体'],
          metrics: ['GDP', '工业机器人密度'],
          dimensions: ['行业', '行业=制造业'],
          dataNeeds: [], websites: [],
        },
      },
    } as never);

    const result = await service.search('user1', '主要经济体2025年工业机器人密度', filters, { mode });

    expect(result.plan).toEqual(expect.objectContaining({
      entities: ['中国', '主要经济体'],
      indicators: ['GDP', '工业机器人密度'],
      dimensions: ['行业', '行业=制造业'],
      timeRanges: ['2025'],
    }));
    expect(repository.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      resultJson: expect.objectContaining({ plan: result.plan }),
    }));
  });

  it('keeps explicit external filters authoritative when discovery adds candidates', async () => {
    const { service, ai } = setup();
    ai.execute.mockResolvedValueOnce({
      aiQueryId: 'q1', answer: '', stages: [],
      resolution: {
        ...resolution,
        discovery: { entities: ['主要经济体'], metrics: ['GDP'], dimensions: ['行业=制造业'], dataNeeds: [], websites: [] },
      },
    } as never);

    const result = await service.search('user1', 'GDP', {
      ...filters, entities: ['中国'], indicators: ['人均GDP'],
    });

    expect(result.plan.entities).toEqual(['中国']);
    expect(result.plan.indicators).toEqual(['人均GDP']);
    expect(result.plan.dimensions).toEqual(['行业=制造业']);
  });
});
