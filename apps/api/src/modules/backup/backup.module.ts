import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BackupController } from './backup.controller';
import { BackupProcessor } from './backup.processor';
import { BackupProducer } from './backup.producer';
import { BackupService } from './backup.service';
import { SYSTEM_BACKUP_QUEUE } from './backup.types';
import { isQueuesEnabled } from '../../common/utils/queues-enabled';

const queuesEnabled = isQueuesEnabled();
/**
 * 系统数据备份模块（定时自动 + 管理端手动）。
 */
@Module({
  imports: [
    ...(queuesEnabled ? [BullModule.registerQueue({
      name: SYSTEM_BACKUP_QUEUE,
    })] : []),
  ],
  controllers: [BackupController],
  providers: [BackupService, BackupProducer, ...(queuesEnabled ? [BackupProcessor] : [])],
  exports: [BackupService, BackupProducer],
})
export class BackupModule {}
