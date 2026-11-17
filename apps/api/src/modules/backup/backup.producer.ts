import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { BackupService } from './backup.service';
import {
  SYSTEM_BACKUP_JOB_NAME,
  SYSTEM_BACKUP_QUEUE,
  SYSTEM_BACKUP_SCHEDULER_ID,
  SYSTEM_RESTORE_JOB_NAME,
  type SystemBackupJobData,
  type SystemRestoreJobData,
} from './backup.types';
import {
  BackupJobViewDto,
  BackupStatusDto,
  RestoreAcceptedDto,
} from './dto/backup-response.dto';

/**
 * 备份 / 恢复任务入队与定时调度同步。
 */
@Injectable()
export class BackupProducer {
  private readonly logger = new Logger(BackupProducer.name);

  constructor(
    private readonly backupService: BackupService,
    private readonly config: ConfigService,
    @Optional() @InjectQueue(SYSTEM_BACKUP_QUEUE) private readonly queue?: Queue,
  ) {}

  /**
   * 按开关注册或移除 BullMQ 定时备份。
   */
  async syncScheduler(enabled?: boolean): Promise<void> {
    if (!this.queue) return;
    const on =
      typeof enabled === 'boolean'
        ? enabled
        : await this.backupService.isScheduleEnabled();
    if (!on) {
      try {
        await this.queue.removeJobScheduler(SYSTEM_BACKUP_SCHEDULER_ID);
      } catch {
        // 调度器不存在时忽略
      }
      this.logger.log('System backup scheduler disabled');
      return;
    }

    const pattern = this.config.getOrThrow<string>('BACKUP_CRON');
    await this.queue.upsertJobScheduler(
      SYSTEM_BACKUP_SCHEDULER_ID,
      { pattern },
      {
        name: SYSTEM_BACKUP_JOB_NAME,
        data: { trigger: 'scheduled' } satisfies SystemBackupJobData,
        opts: {
          attempts: 1,
          removeOnComplete: 30,
          removeOnFail: 50,
        },
      },
    );
    this.logger.log(`System backup scheduler ready → cron "${pattern}"`);
  }

  /**
   * 手动开关自动备份，并立即同步调度器。
   */
  async setAutoBackup(enabled: boolean): Promise<BackupStatusDto> {
    await this.backupService.setScheduleEnabled(enabled);
    await this.syncScheduler(enabled);
    return this.backupService.getStatus() as Promise<BackupStatusDto>;
  }

  /**
   * 创建备份记录并入队执行。
   */
  async enqueueManual(): Promise<BackupJobViewDto> {
    if (!this.queue) throw new Error('Redis queue unavailable');
    const job = await this.backupService.createManualJob();
    await this.queue!.add(
      SYSTEM_BACKUP_JOB_NAME,
      {
        trigger: 'manual',
        jobId: job.id,
      } satisfies SystemBackupJobData,
      {
        attempts: 1,
        removeOnComplete: 30,
        removeOnFail: 50,
      },
    );
    return job;
  }

  /**
   * 校验确认口令后入队一键恢复。
   */
  async enqueueRestore(
    backupId: string,
    confirmText: string,
  ): Promise<RestoreAcceptedDto> {
    if (!this.queue) throw new Error('Redis queue unavailable');
    const prepared = await this.backupService.prepareRestore(
      backupId,
      confirmText,
    );
    await this.queue!.add(
      SYSTEM_RESTORE_JOB_NAME,
      {
        backupId: prepared.backupId,
      } satisfies SystemRestoreJobData,
      {
        attempts: 1,
        removeOnComplete: 30,
        removeOnFail: 50,
      },
    );
    return {
      restoreId: prepared.restoreId,
      backupId: prepared.backupId,
      prefix: prepared.prefix,
      message: '恢复任务已开始，请勿关闭服务；完成后请重启 API',
    };
  }
}
