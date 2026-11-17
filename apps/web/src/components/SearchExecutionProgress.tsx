import { CheckCircle2, LoaderCircle } from 'lucide-react';
import type { ResearchFilters, ResearchSearchMode } from '@agent/contracts';
import {
  SEARCH_PROGRESS_STEPS,
  formatSearchConditions,
  modeLabel,
  type SearchProgressStepState,
} from '../search-progress';

export default function SearchExecutionProgress({
  status,
  activeIndex,
  sourceCount,
  elapsedSec,
  mode,
  filters,
  error,
}: {
  status: 'running' | 'done' | 'error';
  activeIndex: number;
  sourceCount: number;
  elapsedSec: number;
  mode: ResearchSearchMode;
  filters: ResearchFilters;
  error?: string;
}) {
  function stepState(index: number): SearchProgressStepState {
    if (status === 'done') return 'done';
    if (status === 'error') {
      return index <= activeIndex ? 'done' : 'pending';
    }
    if (index < activeIndex) return 'done';
    if (index === activeIndex) return 'active';
    return 'pending';
  }

  const title =
    status === 'running'
      ? '正在检索 · 请稍候'
      : status === 'error'
        ? '检索失败'
        : '检索完成 · 结果已生成';

  return (
    <header className={`exec-progress ${status}`}>
      <div className="exec-progress-title">
        {status === 'running' ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <CheckCircle2 size={16} />
        )}
        <span>{title}</span>
      </div>

      <ol className="exec-progress-steps">
        {SEARCH_PROGRESS_STEPS.map((step, index) => {
          const state = stepState(index);
          return (
            <li key={step.key} className={state}>
              <i aria-hidden />
              <em>{step.label}</em>
              {index < SEARCH_PROGRESS_STEPS.length - 1 ? (
                <span className="exec-progress-arrow" aria-hidden>
                  ›
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      <p className="exec-progress-meta">
        {status === 'error' ? (
          error || '检索失败，请返回重试。'
        ) : status === 'running' ? (
          <>
            正在执行多源检索与内容整理… 已用时 {elapsedSec.toFixed(1)} 秒。检索模式：
            {modeLabel(mode)}，检索条件：{formatSearchConditions(filters)}
          </>
        ) : (
          <>
            共命中 {sourceCount} 个来源锚点，用时 {elapsedSec.toFixed(1)}{' '}
            秒，结果可溯源。检索模式：{modeLabel(mode)}，检索条件：
            {formatSearchConditions(filters)}
          </>
        )}
      </p>
    </header>
  );
}
