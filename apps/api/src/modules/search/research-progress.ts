import { AsyncLocalStorage } from 'node:async_hooks';
import type { ResearchSearchProgress } from '@agent/contracts';

const progressContext = new AsyncLocalStorage<
  (progress: ResearchSearchProgress) => Promise<void>
>();

/** Context is isolated per search, including concurrent LangGraph executions. */
export function withResearchProgress<T>(
  report: (progress: ResearchSearchProgress) => Promise<void>,
  execute: () => Promise<T>,
): Promise<T> {
  return progressContext.run(report, execute);
}

export async function reportResearchProgress(progress: ResearchSearchProgress) {
  await progressContext.getStore()?.(progress);
}
