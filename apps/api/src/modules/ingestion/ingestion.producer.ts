import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { Queue } from 'bullmq';
import { INGESTION_QUEUE, type IngestionJobPayload } from './ingestion.types';

@Injectable()
export class IngestionProducer {
  private readonly logger = new Logger(IngestionProducer.name);

  constructor(
    @Optional() @InjectQueue(INGESTION_QUEUE) private readonly queue?: Queue,
  ) {}

  async enqueue(payload: IngestionJobPayload): Promise<void> {
    if (!this.queue) {
      throw new Error('Ingestion queue unavailable; learning has not started');
    }
    const existing = await this.queue.getJob(`ingest-${payload.jobId}`);
    if (existing && (await existing.getState()) === 'failed') {
      await existing.retry();
      return;
    }
    await this.queue.add('ingest', payload, {
      priority: Math.max(1, Math.min(payload.priority ?? 10, 100)),
      // BullMQ 5 rejects custom IDs containing `:`. Keep the database job ID
      // in the value while using a queue-safe delimiter for deduplication.
      jobId: `ingest-${payload.jobId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }
}
