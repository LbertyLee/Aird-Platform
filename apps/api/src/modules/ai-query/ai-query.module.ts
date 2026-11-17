import { Module } from '@nestjs/common';
import { SemanticModule } from '../semantic/semantic.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiQueryService } from './ai-query.service';
import { EvidenceService } from './evidence.service';
import { QueryRouterService } from './query-router.service';
import { RagQueryService } from './rag-query.service';
import { SqlValidatorService } from './sql-validator.service';
import { TextToSqlService } from './text-to-sql.service';
import { ExaSearchService } from '../../research/exa-search.service';
import { RerankerService } from './reranker.service';
import { ResearchPlanningGraphService } from '../search/research-planning-graph.service';
import { WorldBankDataService } from '../../research/world-bank-data.service';
import { InternationalDataApiService } from '../../research/international-data-api.service';

@Module({
  imports: [SemanticModule, KnowledgeModule],
  providers: [
    AiQueryService,
    WorldBankDataService,
    InternationalDataApiService,
    ResearchPlanningGraphService,
    QueryRouterService,
    TextToSqlService,
    SqlValidatorService,
    RagQueryService,
    EvidenceService,
    ExaSearchService,
    RerankerService,
  ],
  exports: [AiQueryService, EvidenceService, RagQueryService],
})
export class AiQueryModule {}
