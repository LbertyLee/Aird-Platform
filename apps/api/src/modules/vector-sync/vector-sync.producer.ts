import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { VECTOR_SYNC_QUEUE, type VectorSyncJob } from './vector-sync.types';

/**
 * 向量同步任务入队。
 */
@Injectable()
export class VectorSyncProducer {
  /**
   * @param queue vector-sync 队列
   */
  constructor(
    @Optional() @InjectQueue(VECTOR_SYNC_QUEUE) private readonly queue?: Queue<VectorSyncJob>,
  ) {}

  /**
   * 入队同步任务。
   */
  async enqueue(job: VectorSyncJob): Promise<void> {
    if (!this.queue) return;
    await this.queue.add(job.action, job, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
