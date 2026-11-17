import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { ResearchModule } from '../../research/research.module';
import { AnalysisSessionController } from './analysis-session.controller';
import { AnalysisSessionService } from './analysis-session.service';

@Module({
  imports: [KnowledgeModule, ResearchModule],
  controllers: [AnalysisSessionController],
  providers: [AnalysisSessionService],
  exports: [AnalysisSessionService],
})
export class AnalysisModule {}
