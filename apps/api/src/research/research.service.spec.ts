import { ResearchService } from './research.service';
import { StructuredDataStore } from './structured-data-store';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResearchCatalog } from './research-catalog.service';
import type { SourceEntity } from './research.types';

jest.mock('../modules/ai-query/ai-query.service', () => ({
  AiQueryService: class AiQueryService {},
}));

jest.mock('../infrastructure/ai/embedding.service', () => ({
  EmbeddingService: class EmbeddingService {},
}));

jest.mock('../infrastructure/milvus/milvus.service', () => ({
  MilvusService: class MilvusService {},
  COL_KNOWLEDGE_CHUNKS: 'aird_knowledge_chunks',
}));

const emptyPlan = {
  intent: 'general' as const,
  confidence: 0.5,
  countries: [],
  regions: [],
  entities: [],
  indicators: [],
  timeRanges: [],
  sources: [],
  explanation: '测试查询计划',
};

const emptyCatalog: ResearchCatalog = {
  entries: {
    countries: [],
    regions: [],
    entities: [],
    indicators: [],
    timeRanges: [],
    sources: [],
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

function setup(
  catalog: ResearchCatalog = emptyCatalog,
  parser: Record<string, jest.Mock> = {},
  aiQueryExecute?: jest.Mock,
) {
  const repository = {
    findCachedRun: jest.fn().mockResolvedValue(null),
    findCachedBranch: jest.fn().mockResolvedValue(null),
    cacheBranch: jest.fn().mockResolvedValue(undefined),
    createRun: jest.fn().mockResolvedValue('run-1'),
    searchSources: jest.fn().mockResolvedValue([]),
    getSourcesByIds: jest.fn().mockResolvedValue([]),
    createSource: jest.fn().mockImplementation(
      async (input) =>
        ({
          id: input.sourceUrl ?? `source-${Math.random()}`,
          title: input.title,
          origin: input.origin,
          storageType: input.storageType,
          sourceUrl: input.sourceUrl ?? null,
          mimeType: input.mimeType ?? null,
          excerpt: input.textContent,
          recordCount: input.recordCount,
          createdAt: '2026-08-06T00:00:00.000Z',
          textContent: input.textContent,
          structuredData: input.structuredData,
          metadata: input.metadata,
        }) satisfies SourceEntity,
    ),
    completeRun: jest.fn().mockResolvedValue(undefined),
    failRun: jest.fn().mockResolvedValue(undefined),
  };
  const exa = { configured: false, search: jest.fn() };
  const embedding = { isReady: jest.fn().mockReturnValue(true) };
  const milvus = { isReady: jest.fn().mockReturnValue(true) };
  const defaultAiExecute =
    aiQueryExecute ??
    jest.fn().mockResolvedValue({
      aiQueryId: 'ai-query-1',
      answer: '测试回答',
      routeType: 'semantic',
      resolution: {
        metrics: [],
        entities: [],
        concepts: [],
        dimensions: [],
        time: { type: 'UNKNOWN' },
        confidence: 0.5,
        intent: 'general',
      },
      evidenceCount: 0,
      stages: [
        {
          key: 'plan',
          label: 'Semantic Layer 解析',
          status: 'completed',
          detail: '测试',
        },
        {
          key: 'vector',
          label: 'Milvus 语义检索',
          status: 'skipped',
          detail: '无数据',
        },
      ],
    });
  const prisma = {
    queryEvidence: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    knowledgeItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
  const service = new ResearchService(
    repository as never,
    parser as never,
    exa as never,
    {
      plan: jest.fn().mockImplementation((_query, _catalog, filters) => ({
        ...emptyPlan,
        ...filters,
      })),
    } as never,
    {} as never,
    {} as never,
    {
      assertUserCanDeposit: jest.fn(),
      detail: jest.fn(),
      listForUser: jest.fn(),
    } as never,
    {
      load: jest.fn().mockResolvedValue(catalog),
    } as never,
    {
      isRequested: jest.fn().mockReturnValue(false),
      fetch: jest.fn().mockResolvedValue([]),
    } as never,
    {
      execute: defaultAiExecute,
    } as never,
    prisma as never,
    embedding as never,
    milvus as never,
    {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'RESEARCH_CACHE_TTL_SECONDS') return 3600;
        if (key === 'RESEARCH_CACHE_VERSION') return 'test-v1';
        if (key === 'EMBEDDING_MODEL') return 'test-embedding';
        return undefined;
      }),
    } as never,
  );
  return { service, repository, exa, prisma, aiQueryExecute: defaultAiExecute };
}

describe('ResearchService AI query pipeline', () => {
  it('reuses public structured downloads after service recreation without fetching or parsing again', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'remote-structured-'));
    const originalFetch = global.fetch;
    const fetchMock = jest.fn().mockResolvedValue(new Response('country,value\nFrance,100', { headers: { 'content-type': 'text/csv' } }));
    global.fetch = fetchMock;
    const parseBuffer = jest.fn().mockResolvedValue({ storageType: 'structured', textContent: 'France 100', structuredData: [{ country: 'France', value: 100 }], recordCount: 1, metadata: { format: 'csv' } });
    try {
      for (let i = 0; i < 2; i++) {
        const { service, repository } = setup(emptyCatalog, { parseBuffer });
        Object.assign(service, { structuredStore: new StructuredDataStore(directory, true) });
        await service['tryStructuredRemote']({ title: 'Eurostat', url: 'https://example.org/data.csv', description: '', extraSnippets: [] });
        expect(repository.createSource).toHaveBeenCalledWith(expect.objectContaining({ structuredData: [{ country: 'France', value: 100 }] }));
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(parseBuffer).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('shows an unseeded city as the resolved region and entity', () => {
    const { service } = setup();
    const plan = service['semanticToPlan']({
      metrics: [], entities: [], concepts: [],
      dimensions: [{ type: 'region', code: '泉州', name: '泉州' }],
      time: { type: 'UNKNOWN' }, confidence: 0.9, intent: 'analysis',
    }, emptyPlan);
    expect(plan.regions).toEqual(['泉州']);
    expect(plan.entities).toEqual(['泉州']);
    expect(plan.countries).toEqual([]);
    expect(plan.explanation).toContain('地区：泉州');
  });

  it('delegates search to the AI query engine', async () => {
    const { service, aiQueryExecute } = setup();

    const response = await service.search('人口趋势', {
      countries: ['日本', '美国'],
    });

    expect(aiQueryExecute).toHaveBeenCalledTimes(1);
    expect(response.runId).toBe('run-1');
    expect(response.answer).toBe('测试回答');
    expect(response.aiQueryId).toBe('ai-query-1');
  });

  it('returns and persists catalog and discovery semantics without stage text', async () => {
    const aiExecute = jest.fn().mockResolvedValue({
      aiQueryId: 'ai-query-discovery',
      answer: '研究结果',
      resolution: {
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
          dataNeeds: ['机器人安装量'],
          websites: ['https://example.org'],
        },
      },
      stages: [],
    });
    const { service, repository } = setup(emptyCatalog, {}, aiExecute);

    const response = await service.search('主要经济体2025年工业机器人密度', {
      entities: ['中国', '用户指定企业'],
      indicators: ['GDP', '用户指定指标'],
    });

    expect(response.plan).toEqual(expect.objectContaining({
      entities: ['中国', '主要经济体', '用户指定企业'],
      indicators: ['GDP', '工业机器人密度', '用户指定指标'],
      dimensions: ['行业', '行业=制造业'],
      timeRanges: ['2025'],
    }));
    expect(response.plan.explanation).toContain('实体：中国、主要经济体、用户指定企业');
    expect(response.plan.explanation).toContain('指标：GDP、工业机器人密度、用户指定指标');
    expect(response.plan.explanation).toContain('维度：行业、行业=制造业');
    expect(repository.completeRun).toHaveBeenCalledWith(expect.objectContaining({
      resultJson: expect.objectContaining({ plan: response.plan }),
    }));
  });

  it('keeps catalog semantics when discovery is absent', () => {
    const { service } = setup();
    const plan = service['semanticToPlan']({
      metrics: [{ code: 'GDP', name: 'GDP', indicatorId: 'gdp' }],
      entities: [{ code: 'CHN', name: '中国', entityId: 'china' }],
      concepts: [],
      dimensions: [{ type: 'industry', code: 'industry', name: '行业' }],
      time: { type: 'UNKNOWN' }, confidence: 0.9, intent: 'analysis',
    }, { ...emptyPlan, dimensions: ['行业', '历史维度'] });

    expect(plan.entities).toEqual(['中国']);
    expect(plan.indicators).toEqual(['GDP']);
    expect(plan.dimensions).toEqual(['行业', '历史维度']);
  });

  it('maps vector evidence into persisted research sources', async () => {
    const aiExecute = jest.fn().mockResolvedValue({
      aiQueryId: 'ai-query-2',
      answer: '向量证据回答',
      routeType: 'semantic',
      resolution: {
        metrics: [],
        entities: [],
        concepts: [],
        dimensions: [],
        time: { type: 'UNKNOWN' },
        confidence: 0.8,
        intent: 'general',
      },
      evidenceCount: 1,
      stages: [
        {
          key: 'vector',
          label: 'Milvus 语义检索',
          status: 'completed',
          detail: '命中 1 条',
        },
      ],
    });
    const { service, repository, prisma } = setup(emptyCatalog, {}, aiExecute);
    prisma.queryEvidence.findMany.mockResolvedValue([
      {
        id: 'evidence-1',
        aiQueryId: 'ai-query-2',
        evidenceType: 'vector',
        sourceType: 'knowledge',
        sourceId: 'kb-1',
        content: '向量命中的文本片段',
        sql: null,
        score: 0.92,
        metadataJson: { chunkId: 'chunk-1', chunkIndex: 0 },
      },
    ]);
    prisma.knowledgeItem.findMany.mockResolvedValue([
      {
        id: 'kb-1',
        title: '2024年国民经济和社会发展统计公报',
        submittedBy: null,
        library: {
          name: '国家统计局公报',
          visibility: 'public',
          createdBy: 'admin-user',
        },
      },
    ]);

    const response = await service.search('LbertyLee');

    expect(repository.createSource).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'upload',
        storageType: 'knowledge',
        textContent: '向量命中的文本片段',
      }),
    );
    expect(response.sources[0]).toEqual(
      expect.objectContaining({
        title: '2024年国民经济和社会发展统计公报 · 片段 1',
        knowledgeScope: 'platform_public',
        libraryName: '国家统计局公报',
        score: 0.92,
      }),
    );
    expect(response.stages).toContainEqual(
      expect.objectContaining({ key: 'vector', status: 'completed' }),
    );
  });

  it('returns answer even when vector stage is skipped', async () => {
    const { service } = setup();

    const response = await service.search('本地内容');

    expect(response.answer).toBe('测试回答');
    expect(response.stages).toContainEqual(
      expect.objectContaining({
        key: 'vector',
        status: 'skipped',
      }),
    );
  });
});
