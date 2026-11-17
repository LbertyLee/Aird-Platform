import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BackupJobStatus, BackupTrigger, Prisma } from '@prisma/client';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PageQueryDto, PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import {
  BACKUP_ENV_KEYS,
  BACKUP_OBJECT_PREFIXES,
  BACKUP_SCHEDULE_REDIS_KEY,
  RESTORE_CONFIRM_TEXT,
  RESTORE_STATUS_REDIS_KEY,
  type BackupScheduleConfig,
  type RestoreStatusSnapshot,
} from './backup.types';
import { BackupJobViewDto } from './dto/backup-response.dto';

type PgConn = {
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
};

/**
 * 系统备份 / 一键恢复：PostgreSQL + MinIO 业务文件 + 环境配置快照。
 */
@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private running = false;
  private restoring = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 分页查询备份任务。
   */
  async pageJobs(query: PageQueryDto): Promise<PageResultDto<BackupJobViewDto>> {
    const { skip, take } = query.toSkipTake();
    const where: Prisma.BackupJobWhereInput = {};
    if (query.keyword?.trim()) {
      const kw = query.keyword.trim();
      where.OR = [
        { id: { contains: kw } },
        { prefix: { contains: kw } },
        { errorMessage: { contains: kw } },
      ];
    }
    const [total, rows] = await Promise.all([
      this.prisma.backupJob.count({ where }),
      this.prisma.backupJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
    ]);
    return new PageResultDto(
      rows.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * 备份调度配置与最近状态（供管理端展示）。
   */
  async getStatus() {
    const latest = await this.prisma.backupJob.findFirst({
      orderBy: { createdAt: 'desc' },
    });
    const running = await this.prisma.backupJob.findFirst({
      where: { status: BackupJobStatus.running },
      orderBy: { startedAt: 'desc' },
    });
    const restore = await this.readRestoreStatus();
    const isRestoring =
      this.restoring ||
      restore?.status === 'pending' ||
      restore?.status === 'running';
    const enabled = await this.isScheduleEnabled();
    return {
      enabled,
      cron: this.config.getOrThrow<string>('BACKUP_CRON'),
      retentionDays: this.config.getOrThrow<number>('BACKUP_RETENTION_DAYS'),
      prefix: this.normalizePrefix(
        this.config.getOrThrow<string>('BACKUP_PREFIX'),
      ),
      localDir: this.config.get<string>('BACKUP_LOCAL_DIR') || '',
      confirmText: RESTORE_CONFIRM_TEXT,
      isRunning: Boolean(running) || this.running,
      isRestoring,
      latest: latest ? this.toView(latest) : null,
      restore,
    };
  }

  /**
   * 自动备份是否开启：优先 Redis 运行时开关，否则回退环境变量。
   */
  async isScheduleEnabled(): Promise<boolean> {
    const raw = await this.redis.get(BACKUP_SCHEDULE_REDIS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as BackupScheduleConfig;
        if (typeof parsed.enabled === 'boolean') return parsed.enabled;
      } catch {
        // fall through
      }
    }
    return this.config.get<boolean>('BACKUP_ENABLED') ?? true;
  }

  /**
   * 持久化自动备份开关（Redis）。
   */
  async setScheduleEnabled(enabled: boolean): Promise<boolean> {
    const payload: BackupScheduleConfig = {
      enabled,
      updatedAt: new Date().toISOString(),
    };
    await this.redis.set(BACKUP_SCHEDULE_REDIS_KEY, JSON.stringify(payload));
    this.logger.log(`Backup schedule enabled=${enabled}`);
    return enabled;
  }

  /**
   * 创建手动备份任务记录（由队列异步执行）。
   */
  async createManualJob(): Promise<BackupJobViewDto> {
    await this.assertIdle();
    const id = randomUUID().replace(/-/g, '').slice(0, 24);
    const prefix = `${this.normalizePrefix(this.config.getOrThrow<string>('BACKUP_PREFIX'))}${id}/`;
    const row = await this.prisma.backupJob.create({
      data: {
        id,
        status: BackupJobStatus.pending,
        trigger: BackupTrigger.manual,
        prefix,
      },
    });
    return this.toView(row);
  }

  /**
   * 校验并准备一键恢复（入队前同步调用）。
   */
  async prepareRestore(backupId: string, confirmText: string): Promise<{
    backupId: string;
    prefix: string;
    restoreId: string;
  }> {
    if (confirmText.trim() !== RESTORE_CONFIRM_TEXT) {
      throw new BusinessException(
        'BACKUP_RESTORE_CONFIRM_INVALID',
        `请输入确认口令：${RESTORE_CONFIRM_TEXT}`,
      );
    }
    await this.assertIdle();
    const backup = await this.prisma.backupJob.findUnique({
      where: { id: backupId },
    });
    if (!backup) {
      throw new BusinessException('BACKUP_NOT_FOUND', '备份任务不存在');
    }
    if (backup.status !== BackupJobStatus.success) {
      throw new BusinessException(
        'BACKUP_RESTORE_NOT_READY',
        '仅成功完成的备份可恢复',
      );
    }

    const dumpKey = `${backup.prefix}database.dump`;
    const exists = await this.minio.objectExists(dumpKey);
    if (!exists) {
      throw new BusinessException(
        'BACKUP_RESTORE_MISSING',
        `备份文件不存在：${dumpKey}`,
      );
    }

    const restoreId = randomUUID().replace(/-/g, '').slice(0, 24);
    await this.writeRestoreStatus({
      restoreId,
      backupId,
      prefix: backup.prefix,
      status: 'pending',
      phase: 'queued',
      filesRestored: 0,
      dbRestored: false,
      envFilePath: null,
      restartRequired: true,
      errorMessage: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      message: '恢复任务已入队',
    });
    return { backupId, prefix: backup.prefix, restoreId };
  }

  /**
   * 执行一次完整备份（定时 / 手动共用）。
   */
  async runBackup(input: {
    trigger: 'scheduled' | 'manual';
    jobId?: string;
  }): Promise<BackupJobViewDto> {
    if (this.running || this.restoring) {
      throw new BusinessException('BACKUP_BUSY', '已有备份/恢复任务正在执行');
    }

    const trigger =
      input.trigger === 'manual'
        ? BackupTrigger.manual
        : BackupTrigger.scheduled;

    let jobId = input.jobId;
    let prefix: string;

    if (jobId) {
      const existing = await this.prisma.backupJob.findUnique({
        where: { id: jobId },
      });
      if (!existing) {
        throw new BusinessException('BACKUP_NOT_FOUND', '备份任务不存在');
      }
      if (
        existing.status === BackupJobStatus.running ||
        existing.status === BackupJobStatus.success
      ) {
        return this.toView(existing);
      }
      prefix = existing.prefix;
      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: BackupJobStatus.running,
          startedAt: new Date(),
          errorMessage: null,
        },
      });
    } else {
      await this.assertIdle();
      jobId = randomUUID().replace(/-/g, '').slice(0, 24);
      prefix = `${this.normalizePrefix(this.config.getOrThrow<string>('BACKUP_PREFIX'))}${jobId}/`;
      await this.prisma.backupJob.create({
        data: {
          id: jobId,
          status: BackupJobStatus.running,
          trigger,
          prefix,
          startedAt: new Date(),
        },
      });
    }

    this.running = true;
    const workDir = await mkdtemp(join(tmpdir(), 'aird-backup-'));
    try {
      const dumpPath = join(workDir, 'database.dump');
      await this.dumpPostgres(dumpPath);
      const dumpStat = await stat(dumpPath);
      const dumpKey = `${prefix}database.dump`;
      await this.minio.putObjectFromFile(
        dumpKey,
        dumpPath,
        'application/octet-stream',
      );

      const envSnapshot = this.buildEnvSnapshot();
      const envBody = Buffer.from(JSON.stringify(envSnapshot, null, 2), 'utf8');
      const envKey = `${prefix}env.snapshot.json`;
      await this.minio.putObject(envKey, envBody, 'application/json');

      const fileStats = await this.backupObjectFiles(prefix);

      const manifest = {
        id: jobId,
        createdAt: new Date().toISOString(),
        trigger,
        prefix,
        database: {
          key: dumpKey,
          sizeBytes: dumpStat.size,
          format: 'postgresql-custom',
        },
        env: {
          key: envKey,
          sizeBytes: envBody.length,
          keys: Object.keys(envSnapshot),
        },
        files: {
          count: fileStats.count,
          sizeBytes: fileStats.sizeBytes,
          prefixes: [...BACKUP_OBJECT_PREFIXES],
          objects: fileStats.objects,
        },
        checksum: {
          databaseSha256: await this.sha256File(dumpPath),
          envSha256: createHash('sha256').update(envBody).digest('hex'),
        },
      };
      const manifestBody = Buffer.from(
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
      await this.minio.putObject(
        `${prefix}manifest.json`,
        manifestBody,
        'application/json',
      );

      await this.writeLocalCopy({
        dumpPath,
        envBody,
        manifestBody,
        jobId,
      });

      const finished = await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: BackupJobStatus.success,
          finishedAt: new Date(),
          dbSizeBytes: BigInt(dumpStat.size),
          filesCount: fileStats.count,
          filesSizeBytes: BigInt(fileStats.sizeBytes),
          envIncluded: true,
          errorMessage: null,
        },
      });

      await this.pruneOldBackups();
      this.logger.log(
        `Backup ${jobId} success: db=${dumpStat.size}B files=${fileStats.count}`,
      );
      return this.toView(finished);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '备份失败（未知错误）';
      this.logger.error(`Backup ${jobId} failed: ${message}`);
      await this.prisma.backupJob.update({
        where: { id: jobId },
        data: {
          status: BackupJobStatus.failed,
          finishedAt: new Date(),
          errorMessage: message.slice(0, 1900),
        },
      });
      if (error instanceof BusinessException) throw error;
      throw new BusinessException('BACKUP_FAILED', message);
    } finally {
      this.running = false;
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * 一键恢复：MinIO 文件 → PostgreSQL → 环境快照落盘。
   * 进度写入 Redis（数据库会被覆盖，不能只靠 backup_jobs）。
   */
  async runRestore(input: {
    backupId: string;
  }): Promise<RestoreStatusSnapshot> {
    if (this.running || this.restoring) {
      throw new BusinessException('BACKUP_BUSY', '已有备份/恢复任务正在执行');
    }

    const existing = await this.readRestoreStatus();
    let prefix =
      existing?.backupId === input.backupId ? existing.prefix : undefined;
    if (!prefix) {
      const backup = await this.prisma.backupJob.findUnique({
        where: { id: input.backupId },
      });
      prefix = backup?.prefix;
    }
    if (!prefix) {
      throw new BusinessException('BACKUP_NOT_FOUND', '备份任务不存在');
    }

    const restoreId =
      existing?.backupId === input.backupId && existing.status !== 'success'
        ? existing.restoreId
        : randomUUID().replace(/-/g, '').slice(0, 24);

    this.restoring = true;
    const workDir = await mkdtemp(join(tmpdir(), 'aird-restore-'));
    let snapshot: RestoreStatusSnapshot = {
      restoreId,
      backupId: input.backupId,
      prefix,
      status: 'running',
      phase: 'files',
      filesRestored: 0,
      dbRestored: false,
      envFilePath: null,
      restartRequired: true,
      errorMessage: null,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      finishedAt: null,
      message: '正在恢复 MinIO 业务文件…',
    };
    await this.writeRestoreStatus(snapshot);

    try {
      const filesRestored = await this.restoreObjectFiles(prefix);
      snapshot = {
        ...snapshot,
        filesRestored,
        phase: 'database',
        message: '正在恢复 PostgreSQL…',
      };
      await this.writeRestoreStatus(snapshot);

      const dumpPath = join(workDir, 'database.dump');
      await this.minio.downloadObjectToFile(
        `${prefix}database.dump`,
        dumpPath,
      );
      await this.restorePostgres(dumpPath);
      snapshot = {
        ...snapshot,
        dbRestored: true,
        phase: 'env',
        message: '正在落盘环境配置快照…',
      };
      await this.writeRestoreStatus(snapshot);

      const envFilePath = await this.restoreEnvSnapshot(prefix, restoreId);
      snapshot = {
        ...snapshot,
        envFilePath,
        status: 'success',
        phase: 'done',
        finishedAt: new Date().toISOString(),
        message:
          '恢复完成。请重启 API 使环境变量生效，并按需重建向量索引（Milvus）。',
      };
      await this.writeRestoreStatus(snapshot);
      await this.persistRestoreStatusToMinio(snapshot);
      this.logger.log(
        `Restore ${restoreId} from backup ${input.backupId} success`,
      );
      return snapshot;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '恢复失败（未知错误）';
      this.logger.error(`Restore from ${input.backupId} failed: ${message}`);
      snapshot = {
        ...snapshot,
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorMessage: message.slice(0, 1900),
        message: `恢复失败：${message}`,
      };
      await this.writeRestoreStatus(snapshot);
      await this.persistRestoreStatusToMinio(snapshot).catch(() => undefined);
      if (error instanceof BusinessException) throw error;
      throw new BusinessException('BACKUP_RESTORE_FAILED', message);
    } finally {
      this.restoring = false;
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async assertIdle(): Promise<void> {
    if (this.running || this.restoring) {
      throw new BusinessException('BACKUP_BUSY', '已有备份/恢复任务正在执行');
    }
    const restore = await this.readRestoreStatus();
    if (restore?.status === 'pending' || restore?.status === 'running') {
      throw new BusinessException('BACKUP_BUSY', '已有恢复任务正在执行');
    }
    const staleBefore = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const running = await this.prisma.backupJob.findFirst({
      where: {
        status: BackupJobStatus.running,
        startedAt: { gt: staleBefore },
      },
    });
    if (running) {
      throw new BusinessException('BACKUP_BUSY', '已有备份任务正在执行');
    }
  }

  private async readRestoreStatus(): Promise<RestoreStatusSnapshot | null> {
    const raw = await this.redis.get(RESTORE_STATUS_REDIS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as RestoreStatusSnapshot;
    } catch {
      return null;
    }
  }

  private async writeRestoreStatus(
    snapshot: RestoreStatusSnapshot,
  ): Promise<void> {
    await this.redis.set(
      RESTORE_STATUS_REDIS_KEY,
      JSON.stringify(snapshot),
      7 * 24 * 3600,
    );
  }

  private async persistRestoreStatusToMinio(
    snapshot: RestoreStatusSnapshot,
  ): Promise<void> {
    const root = this.normalizePrefix(
      this.config.getOrThrow<string>('BACKUP_PREFIX'),
    );
    await this.minio.putObject(
      `${root}_last-restore.json`,
      Buffer.from(JSON.stringify(snapshot, null, 2), 'utf8'),
      'application/json',
    );
  }

  private normalizePrefix(prefix: string): string {
    const trimmed = prefix.trim().replace(/^\/+/, '');
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  private parseDatabaseUrl(url: string): PgConn {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    if (!database) {
      throw new BusinessException(
        'BACKUP_DB_URL_INVALID',
        'DATABASE_URL 缺少数据库名',
      );
    }
    return {
      host: parsed.hostname || 'localhost',
      port: parsed.port || '5432',
      user: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
      database: database.split('?')[0],
    };
  }

  private async dumpPostgres(outFile: string): Promise<void> {
    const conn = this.parseDatabaseUrl(
      this.config.getOrThrow<string>('DATABASE_URL'),
    );
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'pg_dump',
        [
          '-Fc',
          '-f',
          outFile,
          '-h',
          conn.host,
          '-p',
          conn.port,
          '-U',
          conn.user,
          '-d',
          conn.database,
        ],
        {
          env: {
            ...process.env,
            PGPASSWORD: conn.password,
          },
          windowsHide: true,
        },
      );
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(
            new BusinessException(
              'BACKUP_PG_DUMP_MISSING',
              '未找到 pg_dump，请安装 PostgreSQL 客户端（生产镜像已包含 postgresql-client）',
            ),
          );
          return;
        }
        reject(error);
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(
          new BusinessException(
            'BACKUP_PG_DUMP_FAILED',
            `pg_dump 失败(code=${code}): ${stderr.slice(0, 500) || '无输出'}`,
          ),
        );
      });
    });
  }

  private async restorePostgres(dumpFile: string): Promise<void> {
    const conn = this.parseDatabaseUrl(
      this.config.getOrThrow<string>('DATABASE_URL'),
    );
    await this.prisma.$disconnect().catch(() => undefined);
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          'pg_restore',
          [
            '--clean',
            '--if-exists',
            '--no-owner',
            '--no-acl',
            '-h',
            conn.host,
            '-p',
            conn.port,
            '-U',
            conn.user,
            '-d',
            conn.database,
            dumpFile,
          ],
          {
            env: {
              ...process.env,
              PGPASSWORD: conn.password,
            },
            windowsHide: true,
          },
        );
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            reject(
              new BusinessException(
                'BACKUP_PG_RESTORE_MISSING',
                '未找到 pg_restore，请安装 PostgreSQL 客户端',
              ),
            );
            return;
          }
          reject(error);
        });
        child.on('close', (code) => {
          // pg_restore: 0 成功；1 常为可忽略警告
          if (code === 0 || code === 1) {
            if (code === 1) {
              this.logger.warn(
                `pg_restore finished with warnings: ${stderr.slice(0, 800)}`,
              );
            }
            resolve();
            return;
          }
          reject(
            new BusinessException(
              'BACKUP_PG_RESTORE_FAILED',
              `pg_restore 失败(code=${code}): ${stderr.slice(0, 500) || '无输出'}`,
            ),
          );
        });
      });
    } finally {
      await this.prisma.$connect().catch((error) => {
        this.logger.error(
          `Prisma reconnect after restore failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    }
  }

  private async restoreObjectFiles(backupPrefix: string): Promise<number> {
    const filesPrefix = `${backupPrefix}files/`;
    const listed = await this.minio.listObjects(filesPrefix, {
      buckets: [this.minio.getBucket()],
    });
    let count = 0;
    for (const item of listed) {
      if (!item.key.startsWith(filesPrefix)) continue;
      const destKey = item.key.slice(filesPrefix.length);
      if (!destKey) continue;
      if (
        !BACKUP_OBJECT_PREFIXES.some((prefix) => destKey.startsWith(prefix))
      ) {
        continue;
      }
      await this.minio.copyObject(item.bucket, item.key, destKey);
      count += 1;
    }
    return count;
  }

  private async restoreEnvSnapshot(
    backupPrefix: string,
    restoreId: string,
  ): Promise<string | null> {
    let envBody: Buffer;
    try {
      envBody = await this.minio.getObject(`${backupPrefix}env.snapshot.json`);
    } catch {
      return null;
    }

    const localDir = (this.config.get<string>('BACKUP_LOCAL_DIR') || '').trim();
    const targetDir = localDir
      ? join(localDir, `restore-${restoreId}`)
      : join(tmpdir(), `aird-restore-env-${restoreId}`);
    await mkdir(targetDir, { recursive: true });
    const jsonPath = join(targetDir, 'env.snapshot.json');
    const dotenvPath = join(targetDir, 'env.restored.env');
    await writeFile(jsonPath, envBody);

    const parsed = JSON.parse(envBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const lines: string[] = [
      `# Restored from backup at ${new Date().toISOString()}`,
      '# Merge carefully into runtime .env, then restart API.',
    ];
    for (const key of BACKUP_ENV_KEYS) {
      const value = parsed[key];
      if (value === undefined || value === null) continue;
      lines.push(`${key}=${String(value)}`);
    }
    await writeFile(dotenvPath, `${lines.join('\n')}\n`, 'utf8');
    this.logger.log(`Env snapshot written → ${dotenvPath}`);
    return dotenvPath;
  }

  private buildEnvSnapshot(): Record<string, string | number | boolean | null> {
    const snapshot: Record<string, string | number | boolean | null> = {
      capturedAt: new Date().toISOString(),
    };
    for (const key of BACKUP_ENV_KEYS) {
      const value = this.config.get(key);
      if (value === undefined || value === null) {
        snapshot[key] = null;
      } else if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        snapshot[key] = value;
      } else {
        snapshot[key] = String(value);
      }
    }
    return snapshot;
  }

  private async backupObjectFiles(backupPrefix: string): Promise<{
    count: number;
    sizeBytes: number;
    objects: Array<{
      sourceBucket: string;
      sourceKey: string;
      destKey: string;
      size: number;
    }>;
  }> {
    const objects: Array<{
      sourceBucket: string;
      sourceKey: string;
      destKey: string;
      size: number;
    }> = [];
    let sizeBytes = 0;

    for (const objectPrefix of BACKUP_OBJECT_PREFIXES) {
      const listed = await this.minio.listObjects(objectPrefix, {
        excludePrefix: backupPrefix,
      });
      for (const item of listed) {
        if (item.key.startsWith(backupPrefix)) continue;
        const destKey = `${backupPrefix}files/${item.key}`;
        await this.minio.copyObject(item.bucket, item.key, destKey);
        objects.push({
          sourceBucket: item.bucket,
          sourceKey: item.key,
          destKey,
          size: item.size,
        });
        sizeBytes += item.size;
      }
    }

    return { count: objects.length, sizeBytes, objects };
  }

  private async writeLocalCopy(input: {
    dumpPath: string;
    envBody: Buffer;
    manifestBody: Buffer;
    jobId: string;
  }): Promise<void> {
    const localDir = (this.config.get<string>('BACKUP_LOCAL_DIR') || '').trim();
    if (!localDir) return;
    const targetDir = join(localDir, input.jobId);
    await mkdir(targetDir, { recursive: true });
    await copyFile(input.dumpPath, join(targetDir, 'database.dump'));
    await writeFile(join(targetDir, 'env.snapshot.json'), input.envBody);
    await writeFile(join(targetDir, 'manifest.json'), input.manifestBody);
    this.logger.log(`Local backup copy written → ${targetDir}`);
  }

  private async pruneOldBackups(): Promise<void> {
    const days = this.config.getOrThrow<number>('BACKUP_RETENTION_DAYS');
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const expired = await this.prisma.backupJob.findMany({
      where: {
        createdAt: { lt: cutoff },
        status: { in: [BackupJobStatus.success, BackupJobStatus.failed] },
      },
      select: { id: true, prefix: true },
    });
    for (const row of expired) {
      try {
        await this.minio.deleteByPrefix(row.prefix);
      } catch (error) {
        this.logger.warn(
          `Failed to prune MinIO prefix ${row.prefix}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      await this.prisma.backupJob.delete({ where: { id: row.id } });
    }
  }

  private async sha256File(filePath: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      hash.update(chunk);
    }
    return hash.digest('hex');
  }

  private toView(row: {
    id: string;
    status: BackupJobStatus;
    trigger: BackupTrigger;
    prefix: string;
    startedAt: Date | null;
    finishedAt: Date | null;
    dbSizeBytes: bigint | null;
    filesCount: number;
    filesSizeBytes: bigint;
    envIncluded: boolean;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): BackupJobViewDto {
    return {
      id: row.id,
      status: row.status,
      trigger: row.trigger,
      prefix: row.prefix,
      startedAt: row.startedAt?.toISOString() ?? null,
      finishedAt: row.finishedAt?.toISOString() ?? null,
      dbSizeBytes: row.dbSizeBytes?.toString() ?? null,
      filesCount: row.filesCount,
      filesSizeBytes: row.filesSizeBytes.toString(),
      envIncluded: row.envIncluded,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
