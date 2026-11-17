import type { ResearchFilters, ResearchSearchMode } from '@agent/contracts';

export const SEARCH_QUEUE = 'research-search';
export interface SearchJobData {
  jobId: string;
  userId: string;
  query: string;
  filters?: Partial<ResearchFilters>;
  mode: ResearchSearchMode;
  model?: string;
}
