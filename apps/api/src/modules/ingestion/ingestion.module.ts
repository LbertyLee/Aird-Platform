import { BullModule } from '@nestjs/bullmq';
import { MembershipModule } from '../membership/membership.module';
import { Module } from '@nestjs/common';
import { DocumentParseModule } from '../../research/document-parse.module';
import { DatasetAutoLinkModule } from '../dataset/dataset-auto-link.module';
import { IndicatorModule } from '../indicator/indicator.module';
import { DataQualityService } from './data-quality.service';
import { IngestionAdminController } from './ingestion-admin.controller';
import { IngestionController } from './ingestion.controller';
import { IngestionProcessor } from './ingestion.processor';
import { IngestionProducer } from './ingestion.producer';
import { IngestionService } from './ingestion.service';
import { INGESTION_QUEUE } from './ingestion.types';
import { SchemaDetectionService } from './schema-detection.service';
import { StructuredLoadService } from './structured-load.service';
import { isQueuesEnabled } from '../../common/utils/queues-enabled';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';

const queuesEnabled = isQueuesEnabled();
@Module({
  imports: [
    MembershipModule,
    ...(queuesEnabled
      ? [BullModule.registerQueue({ name: INGESTION_QUEUE })]
      : []),
    DatasetAutoLinkModule,
    IndicatorModule,
    DocumentParseModule,
  ],
  controllers: [IngestionController, IngestionAdminController],
  providers: [
    IngestionService,
    IngestionProducer,
    SchemaDetectionService,
    DataQualityService,
    StructuredLoadService,
    BusinessNotificationWriter,
    ...(queuesEnabled ? [IngestionProcessor] : []),
  ],
  exports: [IngestionService, IngestionProducer],
})
export class IngestionModule {}
