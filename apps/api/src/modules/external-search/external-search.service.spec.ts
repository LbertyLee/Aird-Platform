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
});
