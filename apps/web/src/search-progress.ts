import type { ResearchFilters, ResearchSearchMode } from '@agent/contracts';

export type PendingSearchJob = {
  query: string;
  filters: ResearchFilters;
  mode: ResearchSearchMode;
  model?: string;
  startedAt: number;
};

export const SEARCH_PROGRESS_STEPS = [
  { key: 'intent', label: '解析问项意图' },
  { key: 'retrieve', label: '多源并行检索' },
  { key: 'normalize', label: '数据标准化与清洗' },
  { key: 'analyze', label: '智能分析与交叉验证' },
  { key: 'report', label: '生成报告与可视化' },
] as const;

export type SearchProgressStepKey =
  (typeof SEARCH_PROGRESS_STEPS)[number]['key'];

export type SearchProgressStepState = 'pending' | 'active' | 'done';

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
