import { Module } from '@nestjs/common';
import { AiQueryModule } from '../ai-query/ai-query.module';
import { ResearchModule } from '../../research/research.module';
import { DataAnalysisController } from './data-analysis.controller';
import { DataAnalysisService } from './data-analysis.service';

@Module({
  imports: [AiQueryModule, ResearchModule],
  controllers: [DataAnalysisController],
  providers: [DataAnalysisService],
  exports: [DataAnalysisService],
})
export class DataAnalysisModule {}
