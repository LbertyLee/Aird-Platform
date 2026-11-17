import type { CreateAnalysisSessionDto } from '../analysis/dto/analysis-session.dto';
import type { GenerateResearchReportDto } from '../../research/dto/search-research.dto';

export const WORK_QUEUE = 'research-work';
export const WORK_JOB_TTL_SECONDS = 7200;
export type WorkJobData = { jobId: string; userId: string } & (
  | { kind: 'analysis'; input: CreateAnalysisSessionDto }
  | { kind: 'report'; input: GenerateResearchReportDto }
);
export interface WorkJobRecord {
  jobId: string;
  userId: string;
  status: 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
  result?: unknown;
  error?: string;
}
