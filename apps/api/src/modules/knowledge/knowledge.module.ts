import { Module } from '@nestjs/common';
import { MembershipModule } from '../membership/membership.module';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { IngestionModule } from '../ingestion/ingestion.module';
import { VectorSyncModule } from '../vector-sync/vector-sync.module';
import { KnowledgeAuditController } from './knowledge-audit.controller';
import { KnowledgeAuditService } from './knowledge-audit.service';
import { KnowledgeCatalogService } from './knowledge-catalog.service';
import { KnowledgeCategoryController } from './knowledge-category.controller';
import { KnowledgeIndexController } from './knowledge-index.controller';
import { KnowledgeIndexService } from './knowledge-index.service';
import { KnowledgeItemController } from './knowledge-item.controller';
import { KnowledgeItemService } from './knowledge-item.service';
import { KnowledgeLibraryController } from './knowledge-library.controller';
import { KnowledgeLibraryService } from './knowledge-library.service';
import { KnowledgeUserLibraryController } from './knowledge-user-library.controller';
import { KnowledgeUserLibraryService } from './knowledge-user-library.service';
import { KnowledgeAccessScopeService } from './knowledge-access-scope.service';
import { KnowledgeTagController } from './knowledge-tag.controller';

/**
 * 知识库管理：知识库容器、审核、类目、权限、索引。
 */
@Module({
  imports: [VectorSyncModule, IngestionModule, MembershipModule],
  controllers: [
    KnowledgeLibraryController,
    KnowledgeUserLibraryController,
    KnowledgeCategoryController,
    KnowledgeTagController,
    KnowledgeItemController,
    KnowledgeAuditController,
    KnowledgeIndexController,
  ],
  providers: [
    KnowledgeLibraryService,
    KnowledgeUserLibraryService,
    KnowledgeCatalogService,
    KnowledgeItemService,
    KnowledgeAuditService,
    KnowledgeIndexService,
    KnowledgeAccessScopeService,
    AuditLogWriter,
    BusinessNotificationWriter,
  ],
  exports: [
    KnowledgeItemService,
    KnowledgeLibraryService,
    KnowledgeAccessScopeService,
  ],
})
export class KnowledgeModule {}
