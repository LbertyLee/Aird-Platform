export const SYSTEM_BACKUP_QUEUE = 'system-backup';

export const SYSTEM_BACKUP_SCHEDULER_ID = 'system-backup-daily';

export const SYSTEM_BACKUP_JOB_NAME = 'run-backup';

export const SYSTEM_RESTORE_JOB_NAME = 'run-restore';

/** 一键恢复确认口令 */
export const RESTORE_CONFIRM_TEXT = '确认恢复';

/** Redis 中恢复进度键（pg_restore 会覆盖库表，不能只靠 DB 记状态） */
export const RESTORE_STATUS_REDIS_KEY = 'system:backup:restore:status';

/** Redis 中自动备份开关（覆盖环境变量，可运行时切换） */
export const BACKUP_SCHEDULE_REDIS_KEY = 'system:backup:schedule';

export type BackupScheduleConfig = {
  enabled: boolean;
  updatedAt: string;
};

export type SystemBackupJobData = {
  trigger: 'scheduled' | 'manual';
  jobId?: string;
};

export type SystemRestoreJobData = {
  backupId: string;
  triggeredBy?: string;
};

export type RestoreStatusSnapshot = {
  restoreId: string;
  backupId: string;
  prefix: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  phase: 'queued' | 'files' | 'database' | 'env' | 'done';
  filesRestored: number;
  dbRestored: boolean;
  envFilePath: string | null;
  restartRequired: boolean;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  message: string;
};

/** 需要纳入备份集的业务对象前缀 */
export const BACKUP_OBJECT_PREFIXES = ['datasets/', 'knowledge/'] as const;

/** 环境配置快照纳入的键（恢复连通性 + JWT 连续） */
export const BACKUP_ENV_KEYS = [
  'NODE_ENV',
  'API_PORT',
  'DATABASE_URL',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'REDIS_DB',
  'MINIO_ENDPOINT',
  'MINIO_PUBLIC_ENDPOINT',
  'MINIO_ACCESS_KEY',
  'MINIO_SECRET_KEY',
  'MINIO_BUCKET',
  'MINIO_FALLBACK_BUCKETS',
  'JWT_SECRET',
  'JWT_ACCESS_TTL_SEC',
  'JWT_REFRESH_TTL_SEC',
  'CORS_ORIGINS',
  'STORAGE_DRIVER',
  'MILVUS_ADDRESS',
  'AI_API_KEY',
  'EMBEDDING_PROVIDER',
  'EMBEDDING_BASE_URL',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIM',
  'EMBEDDING_BATCH_SIZE',
  'EMBEDDING_CONCURRENCY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_REASONING_MODEL',
  'PDF_OCR_MODEL',
  'EXA_API_KEY',
  'EXA_SEARCH_COUNT',
  'RESEARCH_CACHE_TTL_SECONDS',
  'RESEARCH_CACHE_VERSION',
  'BACKUP_ENABLED',
  'BACKUP_CRON',
  'BACKUP_RETENTION_DAYS',
  'BACKUP_PREFIX',
  'BACKUP_LOCAL_DIR',
] as const;
