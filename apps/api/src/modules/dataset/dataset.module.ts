import { Module } from '@nestjs/common';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { DatasetAutoLinkModule } from './dataset-auto-link.module';
import { DatasetController } from './dataset.controller';
import { DatasetService } from './dataset.service';

/**
 * 来源管理模块（网站/目录配置，不负责文件接入流水线）。
 */
@Module({
  imports: [DatasetAutoLinkModule],
  controllers: [DatasetController],
  providers: [DatasetService, AuditLogWriter],
  exports: [DatasetService],
})
export class DatasetModule {}
