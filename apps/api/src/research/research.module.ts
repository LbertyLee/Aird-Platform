import { UnWppDataService } from './un-wpp-data.service';
import { Module } from '@nestjs/common';
import { AiQueryModule } from '../modules/ai-query/ai-query.module';
import { IngestionModule } from '../modules/ingestion/ingestion.module';
import { KnowledgeModule } from '../modules/knowledge/knowledge.module';
import { ExaSearchService } from './exa-search.service';
import { ExaContentHydrationService } from './exa-content-hydration.service';
import { DocumentParseModule } from './document-parse.module';
import { ResearchAdminController } from './research-admin.controller';
import { ResearchController } from './research.controller';
import { ResearchRepository } from './research.repository';
import { ResearchService } from './research.service';
import { QueryPlannerService } from './query-planner.service';
import { ReportService } from './report.service';
import { ResearchCatalogService } from './research-catalog.service';
import { WorldBankDataService } from './world-bank-data.service';
import { UserOptionsController } from './user-options.controller';
import { UserKnowledgeController } from './user-knowledge.controller';
import { SiteDataDiscoveryService } from './site-data-discovery.service';

@Module({
  imports: [
    KnowledgeModule,
    AiQueryModule,
    IngestionModule,
    DocumentParseModule,
  ],
  controllers: [
    ResearchController,
    ResearchAdminController,
    UserOptionsController,
    UserKnowledgeController,
  ],
  providers: [
    ResearchService,
    ResearchRepository,
    ExaSearchService,
    ExaContentHydrationService,
    QueryPlannerService,
    ReportService,
    ResearchCatalogService,
    WorldBankDataService,
    UnWppDataService,
    SiteDataDiscoveryService,
  ],
  exports: [
    ResearchService,
    ResearchRepository,
    ResearchCatalogService,
    QueryPlannerService,
    ExaSearchService,
    ExaContentHydrationService,
    WorldBankDataService,
    UnWppDataService,
    SiteDataDiscoveryService,
  ],
})
export class ResearchModule {}
