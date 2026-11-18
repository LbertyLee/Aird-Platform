import { DataAnalysisService } from './data-analysis.service';
import type { SemanticResolution } from '../semantic/semantic.types';

jest.mock('../ai-query/ai-query.service', () => ({
  AiQueryService: class AiQueryService {},
}));
jest.mock('../../infrastructure/ai/embedding.service', () => ({
  EmbeddingService: class EmbeddingService {},
}));
jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class MilvusService {},
  COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));

describe('DataAnalysisService semantic plan', () => {
  const resolution: SemanticResolution = {
    entityGroups: [{ name: '主要经济体', basis: '候选范围', members: ['中国'] }],
    metrics: [{ code: 'GDP', name: 'GDP', indicatorId: 'gdp' }],
    entities: [{ code: 'CHN', name: '中国', entityId: 'china' }],
    concepts: [],
    dimensions: [{ type: 'industry', code: 'industry', name: '行业' }],
    time: { type: 'YEAR', value: 2025 },
    confidence: 0.9,
    intent: 'analysis',
    discovery: {
      metrics: ['GDP', '工业机器人密度'],
      entities: ['中国', '主要经济体'],
      dimensions: ['行业', '行业=制造业'],
      dataNeeds: [], websites: [],
    },
  };

  it('returns and persists discovery without parsing stage descriptions', async () => {
    const repository = {
      createRun: jest.fn().mockResolvedValue('run'),
      completeRun: jest.fn(),
      failRun: jest.fn(),
    };
    const fallback = {
      countries: [], regions: [], entities: ['用户指定企业'],
      indicators: ['用户指定指标'], dimensions: ['历史维度'],
      timeRanges: [], sources: [], intent: 'general', confidence: 0.5,
      explanation: '',
    };
    const service = new DataAnalysisService(
      {
        prepareQuery: jest.fn().mockResolvedValue({ optimizedQuery: '问题', resolution, plan: {} }),
        execute: jest.fn().mockResolvedValue({ aiQueryId: 'query', resolution, stages: [], answer: '' }),
      } as never,
      repository as never,
      { load: jest.fn().mockResolvedValue({}) } as never,
      { plan: jest.fn().mockReturnValue(fallback) } as never,
      { queryEvidence: { findMany: jest.fn().mockResolvedValue([]) } } as never,
      {} as never,
      {} as never,
      { get: jest.fn() } as never,
    );

    const result = await service.search('user', '主要经济体2025年工业机器人密度');

    expect(result.plan).toEqual(expect.objectContaining({
      entities: ['中国', '主要经济体', '用户指定企业'],
      indicators: ['GDP', '工业机器人密度', '用户指定指标'],
      dimensions: ['行业', '行业=制造业', '历史维度'],
      entityGroups: resolution.entityGroups,
      timeRanges: ['2025'],
    }));
    expect(result.plan.explanation).toContain('维度：行业、行业=制造业、历史维度');
    expect(repository.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      resultJson: expect.objectContaining({ plan: result.plan }),
    }));
  });
});
