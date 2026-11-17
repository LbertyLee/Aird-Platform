import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { isQueuesEnabled } from '../../common/utils/queues-enabled';
import { AnalysisModule } from '../analysis/analysis.module';
import { ResearchModule } from '../../research/research.module';
import { RedisModule } from '../../infrastructure/redis/redis.module';
import { WorkJobsController } from './work-jobs.controller';
import { WorkJobsService } from './work-jobs.service';
import { WorkJobProcessor } from './work-job.processor';
import { WORK_QUEUE } from './work-job.types';

const queuesEnabled = isQueuesEnabled();
@Module({
  imports: [
    AnalysisModule,
    ResearchModule,
    RedisModule,
    ...(queuesEnabled ? [BullModule.registerQueue({ name: WORK_QUEUE })] : []),
  ],
  controllers: [WorkJobsController],
  providers: [WorkJobsService, ...(queuesEnabled ? [WorkJobProcessor] : [])],
})
export class WorkJobsModule {}
