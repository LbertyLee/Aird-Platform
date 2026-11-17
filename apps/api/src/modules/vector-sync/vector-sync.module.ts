import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { DocumentParseModule } from '../../research/document-parse.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { VectorSyncProcessor } from './vector-sync.processor';
import { VectorSyncProducer } from './vector-sync.producer';
import { VECTOR_SYNC_QUEUE } from './vector-sync.types';
import { isQueuesEnabled } from '../../common/utils/queues-enabled';

const queuesEnabled = isQueuesEnabled();
/**
 * 向量同步模块。
 */
@Module({
  imports: [
    DocumentParseModule,
    IngestionModule,
    ...(queuesEnabled
      ? [
          BullModule.registerQueue({
            name: VECTOR_SYNC_QUEUE,
          }),
        ]
      : []),
  ],
  providers: [
    VectorSyncProducer,
    ...(queuesEnabled ? [VectorSyncProcessor] : []),
  ],
  exports: [VectorSyncProducer],
})
export class VectorSyncModule {}
