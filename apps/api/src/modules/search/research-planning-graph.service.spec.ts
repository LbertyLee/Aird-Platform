import { ResearchPlanningGraphService } from './research-planning-graph.service';
jest.mock('../../infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('../semantic/semantic-resolution.service', () => ({
  SemanticResolutionService: class {},
}));
jest.mock('../../infrastructure/ai/model-selection.service', () => ({
  ModelSelectionService: class {},
}));
import type { ResearchFilters } from '@agent/contracts';
import type {
  SemanticResolution,
  ResearchSourcePlan,
} from '../semantic/semantic.types';
import { buildRelevanceMatcher } from '../ai-query/retrieval-relevance';

const filters: ResearchFilters = {
  countries: [],
  regions: [],
  entities: [],
  indicators: [],
  timeRanges: [],
  sources: [],
};
const parsed: SemanticResolution = {
  metrics: [],
  entities: [],
  dimensions: [],
  concepts: [],
  intent: 'metric_query',
  confidence: 0.9,
  time: { type: 'YEAR', value: 2024 },
  discovery: {
    metrics: ['工业机器人密度'],
    entities: ['印度尼西亚'],
    dataNeeds: ['2024年每万名工人对应的机器人数量'],
    websites: ['ifr.org'],
  },
};
const sourcePlan: ResearchSourcePlan = {
  status: 'ready',
  intentSummary: '查询印度尼西亚2024年工业机器人密度',
  dataNeeds: ['每万名工人的机器人数量'],
  sources: [
    {
      websiteUrl: 'https://ifr.org',
      query: 'Indonesia industrial robot density 2024 per 10000 workers',
      reason: '国际机器人联合会发布相关统计',
    },
  ],
  allowDiscovery: true,
  translations: [
    { zh: '工业机器人密度', en: 'industrial robot density' },
    { zh: '印度尼西亚', en: 'Indonesia' },
  ],
  discoveryQueries: {
    zh: '印度尼西亚2024年工业机器人密度',
    en: 'Indonesia industrial robot density 2024',
  },
};

function setup(plan: ResearchSourcePlan | null = sourcePlan) {
  const resolve = jest.fn().mockResolvedValue(parsed);
  const planResearchSources = jest.fn().mockResolvedValue(plan);
  const findMany = jest.fn().mockResolvedValue([
    { name: '世界银行', websiteUrl: 'https://worldbank.org' },
    { name: '联合国', websiteUrl: 'https://un.org' },
  ]);
  const service = new ResearchPlanningGraphService(
    { resolve } as never,
    {
      optimizeResearchQuery: async () => '印度尼西亚2024年工业机器人密度',
      planResearchSources,
    } as never,
    { dataset: { findMany } } as never,
  );
  return { service, resolve, planResearchSources, findMany };
}

describe('LangGraph research planning', () => {
  it('retains uncatalogued needs, selects a new site, and matches English evidence for a Chinese question', async () => {
    const { service, planResearchSources } = setup();
    const result = await service.prepare(
      '印度尼西亚2024年工业机器人密度',
      filters,
    );
    expect(planResearchSources).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ discovery: parsed.discovery }),
      expect.any(Array),
      [],
    );
    expect(result.resolution.metrics).toEqual([]);
    expect(result.plan.preferredIndicatorCodes).toEqual([]);
    expect(result.resolution.sourcePlan?.sources).toEqual(sourcePlan.sources);
    expect(result.plan.metrics).toContain('industrial robot density');
    expect(result.plan.entities).toContain('Indonesia');
    const matches = buildRelevanceMatcher(result.resolution, filters);
    expect(
      matches(
        'Indonesia industrial robot density in 2024: 50 robots per 10000 workers.',
      ),
    ).toBe(true);
    expect(matches('Indonesia consumer price index 2024.')).toBe(false);
    expect(matches('Germany industrial robot density in 2024.')).toBe(false);
  });

  it('does not expand a user-specified source restriction even if the model proposes another site', async () => {
    const { service, findMany } = setup();
    const result = await service.prepare('机器人密度', {
      ...filters,
      sources: ['世界银行'],
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: { in: ['世界银行'] } }),
      }),
    );
    expect(result.resolution.sourcePlan?.sources).toEqual([]);
    expect(result.resolution.sourcePlan?.allowDiscovery).toBe(false);
  });

  it('rejects invalid model sites and deduplicates selected domains', async () => {
    const { service } = setup({
      ...sourcePlan,
      sources: [
        ...sourcePlan.sources,
        { ...sourcePlan.sources[0], websiteUrl: 'https://ifr.org/statistics' },
        ...[
          'http://127.0.0.1',
          'https://localhost',
          'https://user:secret@ifr.org',
          'file:///test',
          'https://data.internal',
        ].map((websiteUrl) => ({ ...sourcePlan.sources[0], websiteUrl })),
      ],
    });
    const result = await service.prepare('机器人密度', filters);
    expect(result.resolution.sourcePlan?.sources).toHaveLength(1);
  });

  it('marks unavailable planning without selecting every configured site', async () => {
    const result = await setup(null).service.prepare('机器人密度', filters);
    expect(result.resolution.sourcePlan).toMatchObject({
      status: 'ready',
      sources: [{ websiteUrl: 'https://ifr.org', query: expect.any(String) }],
      allowDiscovery: true,
    });
  });
});
