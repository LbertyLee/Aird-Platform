import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, OnModuleInit } from '@nestjs/common';
import { Job } from 'bullmq';
import { BackupProducer } from './backup.producer';
import { BackupService } from './backup.service';
import {
  SYSTEM_BACKUP_QUEUE,
  SYSTEM_RESTORE_JOB_NAME,
  type SystemBackupJobData,
  type SystemRestoreJobData,
} from './backup.types';

/**
 * 系统备份 / 恢复队列 Worker + 启动时同步定时调度。
 */
@Processor(SYSTEM_BACKUP_QUEUE)
export class BackupProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(BackupProcessor.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly producer: BackupProducer,
  ) {
    super();
  }

  /**
   * 应用启动时按 Redis/环境开关同步定时备份。
   */
  async onModuleInit(): Promise<void> {
    await this.producer.syncScheduler();
  }

  async process(
    job: Job<SystemBackupJobData | SystemRestoreJobData>,
  ): Promise<void> {
    if (job.name === SYSTEM_RESTORE_JOB_NAME) {
      const data = job.data as SystemRestoreJobData;
      this.logger.log(
        `Restore job ${job.id} start (backupId=${data.backupId})`,
      );
      await this.backupService.runRestore({ backupId: data.backupId });
      return;
    }

    const data = job.data as SystemBackupJobData;
    const trigger = data?.trigger === 'manual' ? 'manual' : 'scheduled';
    if (trigger === 'scheduled') {
      const enabled = await this.backupService.isScheduleEnabled();
      if (!enabled) {
        this.logger.log(`Skip scheduled backup ${job.id}: auto backup off`);
        return;
      }
    }
    this.logger.log(
      `Backup job ${job.id} start (trigger=${trigger}, jobId=${data?.jobId ?? '-'})`,
    );
    await this.backupService.runBackup({
      trigger,
      jobId: data?.jobId,
    });
  }
}
