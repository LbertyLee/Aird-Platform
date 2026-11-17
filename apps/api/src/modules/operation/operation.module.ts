import { Module } from '@nestjs/common';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { AnnouncementController, UserAnnouncementController } from './announcement.controller';
import { AnnouncementService } from './announcement.service';
import { SearchOpsController } from './search-ops.controller';
import { SearchOpsService } from './search-ops.service';

/**
 * 运营管理：消息公告、业务通知、搜索运营。
 */
@Module({
  controllers: [AnnouncementController, UserAnnouncementController, SearchOpsController],
  providers: [
    AnnouncementService,
    SearchOpsService,
    AuditLogWriter,
    BusinessNotificationWriter,
  ],
  exports: [AnnouncementService, SearchOpsService],
})
export class OperationModule {}
