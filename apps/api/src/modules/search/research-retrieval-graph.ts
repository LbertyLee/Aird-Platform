import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { reportResearchProgress } from './research-progress';
import type { ExaSourceSearchSummary } from '../../research/exa-search.service';
import type {
  ResearchEvaluation,
  ResearchSourcePlan,
} from '../semantic/semantic.types';

export type ResearchIteration = {
  round: number;
  sources: ResearchSourcePlan['sources'];
  evaluation: ResearchEvaluation;
  error?: string;
};

/** Planner -> Searcher -> Evaluator -> Planner; Writer runs only after termination. */
export async function runResearchRetrievalGraph(input: {
  initialPlan: ResearchSourcePlan;
  replan: (
    feedback: ResearchEvaluation,
    previousQueries: string[],
  ) => Promise<ResearchSourcePlan | null>;
  retrieve: (plan: ResearchSourcePlan) => Promise<ExaSourceSearchSummary>;
  evaluate: (
    summary: ExaSourceSearchSummary,
  ) => Promise<ResearchEvaluation | null>;
  maxRounds?: number;
}) {
  const maxRounds = Math.min(5, Math.max(1, Math.floor(input.maxRounds || 3)));
  const State = Annotation.Root({
    summary: Annotation<ExaSourceSearchSummary>,
    plan: Annotation<ResearchSourcePlan>,
    evaluation: Annotation<ResearchEvaluation>,
    round: Annotation<number>,
    history: Annotation<ResearchIteration[]>,
    previousQueries: Annotation<string[]>,
    stopReason: Annotation<string>,
  });
  const graph = new StateGraph(State)
    .addNode('planner', async (state) => {
      await reportResearchProgress({
        stage: state.round === 0 ? 'planning' : 'replanning',
        round: state.round + 1,
        message: state.round === 0 ? '正在规划查询与目标网站' : '证据尚不充分，正在规划补充查询',
      });
      let proposed: ResearchSourcePlan | null;
      try {
        proposed =
          state.round === 0
            ? input.initialPlan
            : await input.replan(state.evaluation, state.previousQueries);
      } catch {
        proposed = null;
      }
      if (!proposed || proposed.status !== 'ready')
        return { stopReason: 'planning_unavailable' };
      const tasks = proposed.sources.length
        ? proposed.sources
        : proposed.allowDiscovery
          ? [
              ...new Set(
                [
                  proposed.discoveryQueries?.zh,
                  proposed.discoveryQueries?.en,
                ].filter((q): q is string => Boolean(q)),
              ),
            ].map((query) => ({
              websiteUrl: '',
              query,
              reason: '定向来源不足，补充公开网页发现',
            }))
          : [];
      const sources = tasks
        .filter(
          (source) =>
            !state.previousQueries.includes(
              `${source.websiteUrl}\n${source.query.trim().toLowerCase()}`,
            ),
        )
        .slice(0, 5);
      if (!sources.length) return { stopReason: 'no_new_queries' };
      return {
        plan: { ...proposed, sources },
        previousQueries: [
          ...state.previousQueries,
          ...sources.map(
            (source) =>
              `${source.websiteUrl}\n${source.query.trim().toLowerCase()}`,
          ),
        ],
      };
    })
    .addNode('searcher', async (state) => {
      await reportResearchProgress({ stage: 'searching', round: state.round + 1, message: '正在从选定来源检索证据' });
      let extra: ExaSourceSearchSummary;
      let error: string | undefined;
      try {
        extra = await input.retrieve(state.plan);
      } catch {
        extra = {
          results: [],
          attempted: 1,
          succeeded: 0,
          failed: 1,
          skipped: 0,
        };
        error = '本轮检索失败';
      }
      const previous = state.summary;
      return {
        round: state.round + 1,
        summary: {
          results: [...previous.results, ...extra.results],
          attempted: previous.attempted + extra.attempted,
          succeeded: previous.succeeded + extra.succeeded,
          failed: previous.failed + extra.failed,
          skipped: previous.skipped + extra.skipped,
        },
        history: [
          ...state.history,
          {
            round: state.round + 1,
            sources: state.plan.sources,
            evaluation: {
              sufficient: false,
              reason: '',
              gaps: [],
              coveredNeeds: [],
              evidenceUrls: [],
            },
            error,
          },
        ],
      };
    })
    .addNode('evaluator', async (state) => {
      await reportResearchProgress({ stage: 'evaluating', round: state.round, message: '正在评估证据是否足以回答问题' });
      let evaluation: ResearchEvaluation | null = null;
      try {
        evaluation = await input.evaluate(state.summary);
      } catch {
        /* Fail closed. */
      }
      const evaluationUnavailable = !evaluation;
      if (!evaluation)
        evaluation = {
          sufficient: false,
          reason: '充分性评估暂不可用',
          gaps: ['尚未确认全部数据需求是否有可靠证据'],
          coveredNeeds: [],
          evidenceUrls: [],
        };
      const history = state.history.map((item, index) =>
        index === state.history.length - 1 ? { ...item, evaluation } : item,
      );
      const stopReason = evaluationUnavailable
        ? 'evaluation_unavailable'
        : evaluation.sufficient
          ? 'sufficient'
          : state.round >= maxRounds
            ? 'max_rounds'
            : '';
      return { evaluation, history, stopReason };
    })
    .addEdge(START, 'planner')
    .addConditionalEdges('planner', (state) =>
      state.stopReason ? END : 'searcher',
    )
    .addEdge('searcher', 'evaluator')
    .addConditionalEdges('evaluator', (state) =>
      state.stopReason ? END : 'planner',
    )
    .compile();
  const result = await graph.invoke(
    {
      round: 0,
      history: [],
      previousQueries: [],
      stopReason: '',
      summary: {
        results: [],
        attempted: 0,
        succeeded: 0,
        failed: 0,
        skipped: 0,
      },
    },
    { recursionLimit: maxRounds * 3 + 3 },
  );
  await reportResearchProgress({ stage: 'writing', message: '正在汇总证据并整理中文回答' });
  return result;
}
