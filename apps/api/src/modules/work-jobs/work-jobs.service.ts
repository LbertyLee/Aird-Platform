import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { ResearchService } from '../../research/research.service';
import { AnalysisSessionService } from '../analysis/analysis-session.service';
import { backgroundJobId } from '../../common/utils/background-job-id';
import {
  WORK_QUEUE,
  WORK_JOB_TTL_SECONDS,
  type WorkJobData,
  type WorkJobRecord,
} from './work-job.types';

@Injectable()
export class WorkJobsService {
  private readonly logger = new Logger(WorkJobsService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly analysis: AnalysisSessionService,
    private readonly research: ResearchService,
    @Optional()
    @InjectQueue(WORK_QUEUE)
    private readonly queue?: Queue<WorkJobData>,
  ) {}

  async start(
    userId: string,
    work:
      | Omit<Extract<WorkJobData, { kind: 'analysis' }>, 'userId' | 'jobId'>
      | Omit<Extract<WorkJobData, { kind: 'report' }>, 'userId' | 'jobId'>,
    requestId?: string,
  ) {
    const jobId = backgroundJobId(userId, work, requestId);
    const now = new Date().toISOString();
    const record: WorkJobRecord = {
      jobId,
      userId,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    if (
      await this.redis.setIfAbsent(
        this.key(jobId),
        JSON.stringify(record),
        WORK_JOB_TTL_SECONDS,
      )
    ) {
      const data: WorkJobData = { ...work, jobId, userId };
      if (this.queue) {
        try {
          await this.queue.add(work.kind, data, {
            jobId,
            attempts: 1,
            removeOnComplete: { age: WORK_JOB_TTL_SECONDS, count: 1000 },
            removeOnFail: { age: WORK_JOB_TTL_SECONDS, count: 1000 },
          });
        } catch (error) {
          this.logger.error(`Unable to enqueue work job ${jobId}`, error);
          await this.fail(userId, jobId, '任务提交失败，请稍后重试。');
        }
      } else {
        // HTTP disconnects only stop the client waiting; computation continues.
        void this.execute(data).catch((error: unknown) =>
          this.logger.error(`Work job ${jobId} failed`, error),
        );
      }
    }
    return { jobId };
  }

  async get(userId: string, jobId: string) {
    const raw = await this.redis.get(this.key(jobId));
    const record = raw ? (JSON.parse(raw) as WorkJobRecord) : null;
    if (!record || record.userId !== userId)
      throw new NotFoundException('任务不存在或已过期，请重新提交。');
    const { userId: _owner, ...snapshot } = record;
    return snapshot;
  }

  async execute(data: WorkJobData) {
    const current = await this.get(data.userId, data.jobId);
    if (current.status !== 'running') return;
    try {
      const result =
        data.kind === 'analysis'
          ? await this.analysis.create(data.userId, data.input)
          : await this.research.generateReport(
              data.input.query,
              data.input.sourceIds,
              data.userId,
            );
      await this.write({
        ...current,
        userId: data.userId,
        status: 'completed',
        result,
      });
    } catch (error) {
      this.logger.error(`Work job ${data.jobId} failed`, error);
      await this.fail(
        data.userId,
        data.jobId,
        error instanceof Error ? error.message : '任务执行失败，请重试。',
      );
    }
  }

  async fail(
    userId: string,
    jobId: string,
    error = '任务执行中断，请重新提交。',
  ) {
    const current = await this.get(userId, jobId);
    if (current.status === 'running')
      await this.write({ ...current, userId, status: 'failed', error });
  }

  private key(jobId: string) {
    return `research:work-job:${jobId}`;
  }
  private write(record: WorkJobRecord) {
    return this.redis.set(
      this.key(record.jobId),
      JSON.stringify({ ...record, updatedAt: new Date().toISOString() }),
      WORK_JOB_TTL_SECONDS,
    );
  }
}
