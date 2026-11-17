import type {
  ResearchFilters,
  ResearchSearchMode,
  ResearchSearchProgress,
} from '@agent/contracts';

export type PendingSearchJob = {
  query: string;
  filters: ResearchFilters;
  mode: ResearchSearchMode;
  model?: string;
  startedAt: number;
};

export const SEARCH_PROGRESS_STEPS = [
  { key: 'intent', label: '解析问题意图' },
  { key: 'retrieve', label: '多源并行检索' },
  { key: 'normalize', label: '数据标准化与清洗' },
  { key: 'analyze', label: '智能分析与交叉验证' },
  { key: 'report', label: '生成报告与可视化' },
] as const;

export type SearchProgressStepKey =
  (typeof SEARCH_PROGRESS_STEPS)[number]['key'];

export type SearchProgressStepState =
  'pending' | 'active' | 'done' | 'interrupted';

/** Search ends at retrieval; normalization and reports require an analysis session. */
export function buildSearchWorkflowSteps(input: {
  status: 'running' | 'done' | 'error';
  stage: ResearchSearchProgress['stage'];
  hasResult: boolean;
  creatingAnalysis: boolean;
  analysisStatus?: 'ready' | 'partial';
  hasReport: boolean;
}) {
  const searchFinished = input.status === 'done' && input.hasResult;
  const planning = input.stage === 'planning';
  return SEARCH_PROGRESS_STEPS.map((step, index) => {
    let state: SearchProgressStepState = 'pending';
    if (index < 2) {
      if (searchFinished) state = 'done';
      else if (input.status === 'running' || input.status === 'error') {
        const current = planning ? 0 : 1;
        if (index < current) state = 'done';
        if (index === current)
          state = input.status === 'error' ? 'interrupted' : 'active';
      }
    } else if (searchFinished) {
      if (index === 2 && input.creatingAnalysis) state = 'active';
      if (
        !input.creatingAnalysis &&
        index <= 3 &&
        input.analysisStatus === 'ready'
      )
        state = 'done';
      if (
        !input.creatingAnalysis &&
        index === 4 &&
        input.analysisStatus === 'ready' &&
        input.hasReport
      )
        state = 'done';
    }
    return { ...step, state };
  });
}

export function modeLabel(mode: ResearchSearchMode) {
  if (mode === 'ai-search') return 'AI 搜索';
  if (mode === 'exa') return '联网';
  if (mode === 'knowledge') return '知识库';
  return '混合';
}

export function formatSearchConditions(filters: ResearchFilters) {
  const parts = [
    ...filters.indicators,
    ...filters.timeRanges,
    ...filters.countries,
    ...filters.regions,
    ...filters.entities,
    ...filters.sources,
  ].filter(Boolean);
  return parts.length ? parts.join('，') : '未指定';
}
