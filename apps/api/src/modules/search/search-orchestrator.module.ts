import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { isQueuesEnabled } from '../../common/utils/queues-enabled';
import { SEARCH_QUEUE } from './search-job.types';
import { SearchJobProcessor } from './search-job.processor';
import { AiQueryModule } from '../ai-query/ai-query.module';
import { DataAnalysisModule } from '../data-analysis/data-analysis.module';
import { ExternalSearchModule } from '../external-search/external-search.module';
import { MembershipModule } from '../membership/membership.module';
import { SearchOrchestratorController } from './search-orchestrator.controller';
import { SearchModelAdminController } from './search-model-admin.controller';
import { SearchOrchestratorService } from './search-orchestrator.service';
import { ResearchModule } from '../../research/research.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { RedisModule } from '../../infrastructure/redis/redis.module';

const queuesEnabled = isQueuesEnabled();
@Module({
  imports: [
    ...(queuesEnabled ? [BullModule.registerQueue({ name: SEARCH_QUEUE })] : []),
    AiQueryModule,
    DataAnalysisModule,
    ExternalSearchModule,
    ResearchModule,
    KnowledgeModule,
    MembershipModule,
    RedisModule,
  ],
  controllers: [SearchOrchestratorController, SearchModelAdminController],
  providers: [SearchOrchestratorService, BusinessNotificationWriter,
    ...(queuesEnabled ? [SearchJobProcessor] : [])],
})
export class SearchOrchestratorModule {}
