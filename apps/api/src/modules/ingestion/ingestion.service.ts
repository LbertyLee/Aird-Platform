import { Injectable, Logger } from '@nestjs/common';
import {
  DatasetVersionStatus,
  IngestionJobStatus,
  IngestionTargetType,
  KnowledgeVersionStatus,
  StorageType,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { IngestionProducer } from './ingestion.producer';
import { MembershipService } from '../membership/membership.service';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly producer: IngestionProducer,
    private readonly minio: MinioService,
    private readonly membership: MembershipService,
  ) {}

  async startDatasetIngestion(input: {
    datasetId: string;
    fileKey: string;
    fileName: string;
    fileSize: number;
    mimeType?: string | null;
    actorId?: string | null;
    buffer?: Buffer;
  }) {
    const checksum = input.buffer
      ? createHash('sha256').update(input.buffer).digest('hex')
      : null;
    const latest = await this.prisma.datasetVersion.findFirst({
      where: { datasetId: input.datasetId },
      orderBy: { version: 'desc' },
      select: { version: true, checksum: true },
    });
    if (checksum && latest?.checksum === checksum) {
      const existing = await this.prisma.datasetVersion.findFirst({
        where: { datasetId: input.datasetId, checksum, status: 'ready' },
      });
      if (existing)
        return { versionId: existing.id, jobId: null, deduplicated: true };
    }
    const version = (latest?.version ?? 0) + 1;
    await this.prisma.datasetVersion.updateMany({
      where: { datasetId: input.datasetId, isCurrent: true },
      data: { isCurrent: false },
    });
    const datasetVersion = await this.prisma.datasetVersion.create({
      data: {
        datasetId: input.datasetId,
        version,
        checksum,
        rawObjectPath: input.fileKey,
        sizeBytes: input.fileSize,
        status: DatasetVersionStatus.uploaded,
        isCurrent: true,
        createdBy: input.actorId ?? null,
      },
    });
    const job = await this.prisma.ingestionJob.create({
      data: {
        targetType: IngestionTargetType.dataset,
        targetId: input.datasetId,
        datasetVersionId: datasetVersion.id,
        status: IngestionJobStatus.pending,
        currentStep: 'queued',
      },
    });
    await this.prisma.dataset.update({
      where: { id: input.datasetId },
      data: {
        fileKey: input.fileKey,
        fileName: input.fileName,
        mimeType: input.mimeType ?? null,
        fileSize: input.fileSize,
      },
    });
    await this.producer.enqueue({
      jobId: job.id,
      targetType: 'dataset',
      targetId: input.datasetId,
      versionId: datasetVersion.id,
    });
    return { versionId: datasetVersion.id, jobId: job.id, deduplicated: false };
  }

  async startKnowledgeIngestion(input: {
    knowledgeItemId: string;
    fileKey: string;
    fileSize: number;
    actorId?: string | null;
    buffer?: Buffer;
    force?: boolean;
  }) {
    const checksum = input.buffer
      ? createHash('sha256').update(input.buffer).digest('hex')
      : await this.checksumFromObject(input.fileKey);
    const latest = await this.prisma.knowledgeVersion.findFirst({
      where: { knowledgeItemId: input.knowledgeItemId },
      orderBy: { version: 'desc' },
      select: { version: true, checksum: true },
    });
    const active = await this.prisma.ingestionJob.findFirst({
      where: { targetType: IngestionTargetType.knowledge, targetId: input.knowledgeItemId, status: { in: [IngestionJobStatus.pending, IngestionJobStatus.running] } },
      select: { id: true, knowledgeVersionId: true },
    });
    if (active) return { versionId: active.knowledgeVersionId, jobId: active.id, deduplicated: true };
    if (!input.force && checksum && latest?.checksum === checksum) {
      const existing = await this.prisma.knowledgeVersion.findFirst({
        where: {
          knowledgeItemId: input.knowledgeItemId,
          checksum,
          status: 'ready',
        },
      });
      if (existing)
        return { versionId: existing.id, jobId: null, deduplicated: true };
    }
    const payer = await this.prisma.knowledgeItem.findUniqueOrThrow({
      where: { id: input.knowledgeItemId }, select: { sourceType: true, submittedBy: true },
    });
    if (payer.sourceType === 'research_upload' && payer.submittedBy) {
      await this.membership.assertCanLearnKnowledge(payer.submittedBy);
    }
    const version = (latest?.version ?? 0) + 1;
    const knowledgeVersion = await this.prisma.knowledgeVersion.create({
      data: {
        knowledgeItemId: input.knowledgeItemId,
        version,
        checksum,
        minioObjectPath: input.fileKey,
        fileSize: input.fileSize,
        status: KnowledgeVersionStatus.uploaded,
        // Keep the previous ready version queryable until this version has
        // completed parsing, chunk persistence, embedding, and Milvus upsert.
        isCurrent: false,
        createdBy: input.actorId ?? null,
      },
    });
    const job = await this.prisma.ingestionJob.create({
      data: {
        targetType: IngestionTargetType.knowledge,
        targetId: input.knowledgeItemId,
        knowledgeVersionId: knowledgeVersion.id,
        status: IngestionJobStatus.pending,
        currentStep: 'queued',
      },
    });
    try {
      await this.producer.enqueue({
        jobId: job.id,
        targetType: 'knowledge',
        targetId: input.knowledgeItemId,
        versionId: knowledgeVersion.id,
      });
    } catch (error) {
      // 未启动的任务不扣费，也不能以 pending 状态阻塞后续重试。
      const message = error instanceof Error ? error.message : String(error);
      await this.prisma.$transaction([
        this.prisma.ingestionJob.update({
          where: { id: job.id },
          data: { status: IngestionJobStatus.failed, errorMessage: message, completedAt: new Date() },
        }),
        this.prisma.knowledgeVersion.update({
          where: { id: knowledgeVersion.id },
          data: { status: KnowledgeVersionStatus.failed, errorMessage: message },
        }),
      ]);
      throw error;
    }
    return {
      versionId: knowledgeVersion.id,
      jobId: job.id,
      deduplicated: false,
    };
  }

  private async checksumFromObject(fileKey: string): Promise<string | null> {
    try {
      const buffer = await this.minio.getObject(fileKey);
      return createHash('sha256').update(buffer).digest('hex');
    } catch {
      return null;
    }
  }

  /** Rebuild through the same versioned pipeline as first-time ingestion. */
  async reingestKnowledgeItem(
    knowledgeItemId: string,
    actorId?: string | null,
  ) {
    const item = await this.prisma.knowledgeItem.findFirst({
      where: { id: knowledgeItemId, deletedAt: null },
      select: { fileKey: true, fileSize: true },
    });
    if (!item?.fileKey) {
      throw new Error('Knowledge item has no source file to reingest');
    }
    return this.startKnowledgeIngestion({
      knowledgeItemId,
      fileKey: item.fileKey,
      fileSize: item.fileSize ?? 0,
      actorId,
      force: true,
    });
  }

  buildDatasetObjectKey(datasetId: string, fileName: string) {
    const ext = extname(fileName).toLowerCase();
    return `datasets/${datasetId}/versions/${randomUUID()}${ext}`;
  }

  buildKnowledgeObjectKey(knowledgeItemId: string, fileName: string) {
    const ext = extname(fileName).toLowerCase();
    return `knowledge/${knowledgeItemId}/versions/${randomUUID()}${ext}`;
  }

  async getJob(jobId: string) {
    return this.prisma.ingestionJob.findUnique({ where: { id: jobId } });
  }

  async retryJob(jobId: string, actorId?: string | null) {
    const job = await this.prisma.ingestionJob.findUnique({ where: { id: jobId } });
    if (!job) throw new Error('Ingestion job not found');
    if (job.status !== IngestionJobStatus.failed && job.status !== IngestionJobStatus.cancelled) throw new Error('Only failed or cancelled jobs can be retried');
    if (job.targetType !== IngestionTargetType.knowledge || !job.knowledgeVersionId) throw new Error('Manual retry currently supports knowledge ingestion only');
    if (job.billingState) {
      // 有实际用量的任务必须先完成原任务结算，不能以新任务绕过欠费。
      await this.producer.enqueue({ jobId: job.id, targetType: 'knowledge', targetId: job.targetId, versionId: job.knowledgeVersionId });
      return { versionId: job.knowledgeVersionId, jobId: job.id, deduplicated: false, retried: true };
    }
    return { ...(await this.reingestKnowledgeItem(job.targetId, actorId)), retried: true };
  }

  async pageJobs(query: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    targetType?: IngestionTargetType;
    status?: IngestionJobStatus;
    targetId?: string;
    toSkipTake: () => { skip: number; take: number };
  }) {
    const where = {
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.targetId ? { targetId: query.targetId } : {}),
      ...(query.keyword
        ? {
            OR: [
              { id: { contains: query.keyword } },
              { targetId: { contains: query.keyword } },
              {
                errorMessage: {
                  contains: query.keyword,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.ingestionJob.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.ingestionJob.count({ where }),
    ]);
    return {
      items,
      total,
      page: query.page ?? 1,
      pageSize: query.pageSize ?? 20,
    };
  }

  storageTypeFromParsed(storageType: 'structured' | 'knowledge'): StorageType {
    return storageType === 'structured'
      ? StorageType.STRUCTURED
      : StorageType.KNOWLEDGE;
  }
}
