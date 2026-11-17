import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { WorkJobsService } from './work-jobs.service';
import { WORK_QUEUE, type WorkJobData } from './work-job.types';

@Processor(WORK_QUEUE, { concurrency: 2 })
export class WorkJobProcessor extends WorkerHost {
  constructor(private readonly jobs: WorkJobsService) {
    super();
  }
  process(job: Job<WorkJobData>) {
    return this.jobs.execute(job.data);
  }

  @OnWorkerEvent('failed')
  async failed(job: Job<WorkJobData> | undefined) {
    if (job) await this.jobs.fail(job.data.userId, job.data.jobId);
  }
}
