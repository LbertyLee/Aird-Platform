import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { SEARCH_QUEUE, type SearchJobData } from './search-job.types';

@Processor(SEARCH_QUEUE, { concurrency: 2 })
export class SearchJobProcessor extends WorkerHost {
  constructor(private readonly search: SearchOrchestratorService) { super(); }

  async process(job: Job<SearchJobData>) {
    const { jobId, userId, query, filters, mode } = job.data;
    const snapshot = await this.search.getSearchJob(userId, jobId);
    if (snapshot.status !== 'running') return;
    await this.search.runSearchJobBackground(jobId, userId, query, filters, mode, job.data.model);
  }

  @OnWorkerEvent('failed')
  async failed(job: Job<SearchJobData> | undefined) {
    if (job) await this.search.markSearchJobFailed(job.data.jobId);
  }
}
