import { RagQueryService } from './rag-query.service';
import type { SemanticResolution } from '../semantic/semantic.types';

jest.mock('../../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class {},
  COL_KNOWLEDGE_CHUNKS: 'knowledge_chunks',
}));

describe('RagQueryService relevance', () => {
  const resolution: SemanticResolution = {
    metrics: [{ code: 'GDP', name: '国内生产总值', indicatorId: 'gdp' }],
    dimensions: [{ type: 'country_region', code: 'CN', name: '中国' }],
    entities: [], concepts: [], time: { type: 'UNKNOWN' }, confidence: 1, intent: 'metric_query',
  };

  function setup(remote: Array<{ id: string; score: number }> = []) {
    const chunks = [
      { id: 'unrelated', knowledgeVersionId: 'v1', chunkIndex: 0, content: '中国就业人数', pageNumber: 1, section: null },
      { id: 'anchor', knowledgeVersionId: 'v2', chunkIndex: 1, content: '中国国民经济统计表', pageNumber: 1, section: null },
      { id: 'neighbor', knowledgeVersionId: 'v2', chunkIndex: 2, content: 'GDP 2025年 140万亿元', pageNumber: 2, section: null },
    ];
    const prisma = {
      knowledgeItem: { findMany: jest.fn().mockResolvedValue([{ id: 'a', library: null }, { id: 'b', library: null }]) },
      knowledgeVersion: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', knowledgeItemId: 'a' }, { id: 'v2', knowledgeItemId: 'b' }]) },
      documentChunk: { findMany: jest.fn().mockResolvedValueOnce(chunks.slice(0, 2)).mockResolvedValueOnce(chunks) },
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    const reranker = { rerank: jest.fn().mockResolvedValue(remote) };
    const embedding = { isReady: jest.fn(() => true), embed: jest.fn(async () => [1]) };
    const args = [
      embedding,
      { isReady: () => true, search: async () => [
        { id: 'unrelated', score: 0.99, fields: { knowledge_id: 'a', knowledge_version_id: 'v1', chunk_index: 0 } },
        { id: 'anchor', score: 0.7, fields: { knowledge_id: 'b', knowledge_version_id: 'v2', chunk_index: 1 } },
      ] },
      prisma,
      { resolveRagKnowledgeIds: async () => new Set(['a', 'b']) },
      reranker,
    ] as unknown as ConstructorParameters<typeof RagQueryService>;
    return { service: new RagQueryService(...args), prisma, reranker, embedding };
  }

  it('removes unrelated high-score chunks while retaining data in adjacent chunks', async () => {
    const { service, prisma, reranker } = setup();
    const hits = await service.search('中国GDP', resolution);
    expect(hits.map((hit) => hit.chunkId)).toEqual(['anchor']);
    expect(hits[0].content).toContain('140万亿元');
    expect(reranker.rerank.mock.calls[0][1]).toHaveLength(1);
    expect(prisma.$executeRawUnsafe.mock.calls[0][1]).toEqual(['b']);
  });

  it('retains matching evidence with low but finite remote scores', async () => {
    const { service, prisma } = setup([{ id: 'anchor', score: 0.01 }]);
    expect(await service.search('中国GDP', resolution)).toHaveLength(1);
    expect(prisma.$executeRawUnsafe).toHaveBeenCalled();
  });

  it.each(['unavailable', 'throws'])('keeps keyword recall when embeddings are %s', async (mode) => {
    const { service, prisma, embedding } = setup();
    if (mode === 'unavailable') embedding.isReady.mockReturnValue(false);
    else embedding.embed.mockRejectedValue(new Error('embedding unavailable'));
    prisma.$queryRawUnsafe.mockResolvedValue([
      { id: 'keyword', knowledge_id: 'b', chunkIndex: 10, content: '中国GDP为140万亿元', score: 1 },
    ]);
    const hits = await service.search('中国GDP2024年数据', resolution);
    expect(hits.map((hit) => hit.chunkId)).toEqual(['keyword']);
    expect(prisma.$queryRawUnsafe.mock.calls[0][2]).toContain("'gdp'");
    expect(prisma.$queryRawUnsafe.mock.calls[0][2]).toContain(' | ');
  });

  it('checks deeper candidates before limiting the relevant results', async () => {
    const { service, prisma, embedding } = setup();
    embedding.isReady.mockReturnValue(false);
    prisma.$queryRawUnsafe.mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({
      id: `keyword-${index}`, knowledge_id: 'b', chunkIndex: index + 10,
      content: index === 24 ? '中国GDP为140万亿元' : '中国就业人数', score: 25 - index,
    })));
    expect((await service.search('中国GDP', resolution)).map((hit) => hit.chunkId)).toEqual(['keyword-24']);
  });
});
