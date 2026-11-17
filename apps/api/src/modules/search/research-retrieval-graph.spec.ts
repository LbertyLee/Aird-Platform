import { runResearchRetrievalGraph } from './research-retrieval-graph';
import type { ExaSourceSearchSummary } from '../../research/exa-search.service';
import type { ResearchSourcePlan } from '../semantic/semantic.types';

const plan: ResearchSourcePlan = {
  status: 'ready',
  intentSummary: '查询工业机器人密度',
  dataNeeds: ['印度尼西亚2024年机器人密度'],
  allowDiscovery: true,
  sources: [
    {
      websiteUrl: 'https://ifr.org',
      query: 'Indonesia robot density 2024',
      reason: '行业统计',
    },
  ],
  discoveryQueries: {
    zh: '印度尼西亚机器人密度2024',
    en: 'Indonesia robot density 2024',
  },
};
function summary(text = ''): ExaSourceSearchSummary {
  return {
    results: [
      {
        sourceId: '',
        sourceName: '',
        results: text
          ? [
              {
                title: text,
                url: 'https://ifr.org/report',
                description: text,
                extraSnippets: [],
              },
            ]
          : [],
      },
    ],
    attempted: 1,
    succeeded: 1,
    failed: 0,
    skipped: 0,
  };
}
const adequate = {
  sufficient: true,
  reason: '目标已覆盖',
  gaps: [],
  coveredNeeds: ['指标和年份'],
  evidenceUrls: ['https://ifr.org/report'],
};
const insufficient = {
  sufficient: false,
  reason: '缺少来源覆盖',
  gaps: ['缺少官方数据集'],
  coveredNeeds: [],
  evidenceUrls: [],
};

describe('LangGraph planner-executor loop', () => {
  it('stops when the evaluator finds sufficient evidence', async () => {
    const replan = jest.fn();
    const result = await runResearchRetrievalGraph({
      initialPlan: plan,
      replan,
      retrieve: async () => summary('robot density'),
      evaluate: async () => adequate,
    });
    expect(replan).not.toHaveBeenCalled();
    expect(result.round).toBe(1);
    expect(result.stopReason).toBe('sufficient');
  });

  it('replans only the gaps and accumulates evidence until adequate', async () => {
    const secondPlan = {
      ...plan,
      sources: [
        {
          websiteUrl: 'https://data.worldbank.org',
          query: 'Indonesia robot density dataset 2024',
          reason: '数据集',
        },
      ],
    };
    const replan = jest.fn().mockResolvedValue(secondPlan);
    const retrieve = jest
      .fn()
      .mockResolvedValueOnce(summary('first source'))
      .mockResolvedValueOnce(summary('second source'));
    let round = 0;
    const result = await runResearchRetrievalGraph({
      initialPlan: plan,
      replan,
      retrieve,
      evaluate: async (all) => {
        round++;
        return round === 1 ? insufficient : adequate;
      },
    });
    expect(replan).toHaveBeenCalledWith(
      insufficient,
      expect.arrayContaining(['https://ifr.org\nindonesia robot density 2024']),
    );
    expect(result.round).toBe(2);
    expect(result.summary.results).toHaveLength(2);
    expect(result.stopReason).toBe('sufficient');
  });

  it('stops at the configured iteration ceiling and records unresolved gaps', async () => {
    const retrieve = jest.fn().mockResolvedValue(summary('evidence'));
    const result = await runResearchRetrievalGraph({
      initialPlan: plan,
      maxRounds: 2,
      replan: async () => ({
        ...plan,
        sources: [
          {
            ...plan.sources[0],
            query: 'Indonesia robot density official dataset',
          },
        ],
      }),
      retrieve,
      evaluate: async () => insufficient,
    });
    expect(retrieve).toHaveBeenCalledTimes(2);
    expect(result.stopReason).toBe('max_rounds');
    expect(result.evaluation.gaps).toEqual(['缺少官方数据集']);
  });

  it('uses targeted public web discovery if the planner has no site candidates', async () => {
    const retrieve = jest.fn().mockResolvedValue(summary('open web result'));
    await runResearchRetrievalGraph({
      initialPlan: { ...plan, sources: [] },
      replan: async () => null,
      retrieve,
      evaluate: async () => adequate,
    });
    expect(
      retrieve.mock.calls[0][0].sources.map(
        (source: { query: string }) => source.query,
      ),
    ).toEqual(['印度尼西亚机器人密度2024', 'Indonesia robot density 2024']);
  });

  it('ends safely when replanning cannot produce a new query', async () => {
    const result = await runResearchRetrievalGraph({
      initialPlan: plan,
      replan: async () => ({ ...plan, sources: [], allowDiscovery: false }),
      retrieve: async () => summary(),
      evaluate: async () => insufficient,
    });
    expect(result.stopReason).toBe('no_new_queries');
    expect(result.round).toBe(1);
  });
});
