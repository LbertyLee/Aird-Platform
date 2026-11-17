import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BackupJobStatus, BackupTrigger } from '@prisma/client';
import { IsBoolean, IsString, MinLength } from 'class-validator';

/**
 * 备份任务视图。
 */
export class BackupJobViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: BackupJobStatus })
  status!: BackupJobStatus;

  @ApiProperty({ enum: BackupTrigger })
  trigger!: BackupTrigger;

  @ApiProperty({ description: 'MinIO 备份集前缀' })
  prefix!: string;

  @ApiPropertyOptional({ nullable: true })
  startedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  finishedAt!: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: '数据库备份大小（字节，字符串避免精度丢失）',
  })
  dbSizeBytes!: string | null;

  @ApiProperty()
  filesCount!: number;

  @ApiProperty({ description: '对象文件总大小（字节，字符串）' })
  filesSizeBytes!: string;

  @ApiProperty()
  envIncluded!: boolean;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/**
 * 恢复进度快照。
 */
export class RestoreStatusDto {
  @ApiProperty()
  restoreId!: string;

  @ApiProperty()
  backupId!: string;

  @ApiProperty()
  prefix!: string;

  @ApiProperty({ enum: ['pending', 'running', 'success', 'failed'] })
  status!: 'pending' | 'running' | 'success' | 'failed';

  @ApiProperty({
    enum: ['queued', 'files', 'database', 'env', 'done'],
  })
  phase!: 'queued' | 'files' | 'database' | 'env' | 'done';

  @ApiProperty()
  filesRestored!: number;

  @ApiProperty()
  dbRestored!: boolean;

  @ApiPropertyOptional({ nullable: true })
  envFilePath!: string | null;

  @ApiProperty()
  restartRequired!: boolean;

  @ApiPropertyOptional({ nullable: true })
  errorMessage!: string | null;

  @ApiProperty()
  startedAt!: string;

  @ApiPropertyOptional({ nullable: true })
  finishedAt!: string | null;

  @ApiProperty()
  message!: string;
}

/**
 * 备份调度状态。
 */
export class BackupStatusDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  cron!: string;

  @ApiProperty()
  retentionDays!: number;

  @ApiProperty()
  prefix!: string;

  @ApiProperty({ description: '本机额外落盘目录，空表示未启用' })
  localDir!: string;

  @ApiProperty({ description: '一键恢复确认口令' })
  confirmText!: string;

  @ApiProperty()
  isRunning!: boolean;

  @ApiProperty()
  isRestoring!: boolean;

  @ApiPropertyOptional({ type: BackupJobViewDto, nullable: true })
  latest!: BackupJobViewDto | null;

  @ApiPropertyOptional({ type: RestoreStatusDto, nullable: true })
  restore!: RestoreStatusDto | null;
}

/**
 * 备份任务分页结果。
 */
export class BackupJobListResultDto {
  @ApiProperty({ type: [BackupJobViewDto] })
  items!: BackupJobViewDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

/**
 * 一键恢复请求。
 */
export class RestoreBackupDto {
  @ApiProperty({
    description: '确认口令，必须为「确认恢复」',
    example: '确认恢复',
  })
  @IsString()
  @MinLength(2)
  confirmText!: string;
}

/**
 * 更新自动备份开关。
 */
export class UpdateBackupScheduleDto {
  @ApiProperty({ description: '是否开启定时自动备份' })
  @IsBoolean()
  enabled!: boolean;
}

/**
 * 恢复任务已接受。
 */
export class RestoreAcceptedDto {
  @ApiProperty()
  restoreId!: string;

  @ApiProperty()
  backupId!: string;

  @ApiProperty()
  prefix!: string;

  @ApiProperty()
  message!: string;
}
