import { Module } from '@nestjs/common';
import { AiQueryModule } from '../ai-query/ai-query.module';
import { ResearchModule } from '../../research/research.module';
import { ExternalSearchController } from './external-search.controller';
import { ExternalSearchService } from './external-search.service';

@Module({ imports: [AiQueryModule, ResearchModule], controllers: [ExternalSearchController], providers: [ExternalSearchService], exports: [ExternalSearchService] })
export class ExternalSearchModule {}
