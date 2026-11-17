import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import {
  DatasetVersionStatus,
  IngestionJobStatus,
  KnowledgeVersionStatus,
  Prisma,
  VectorSyncStatus,
} from '@prisma/client';
import { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { LlmUsageMeterService, type LlmUsageRecord } from '../../infrastructure/ai/llm-usage-meter.service';

type LearningBillingState = { reference: string; payerId: string; usage: LlmUsageRecord[]; operationSucceeded: boolean; settled?: boolean };
import { EmbeddingService } from '../../infrastructure/ai/embedding.service';
import {
  COL_KNOWLEDGE_CHUNKS,
  MilvusService,
} from '../../infrastructure/milvus/milvus.service';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentParserService } from '../../research/document-parser.service';
import { DatasetAutoLinkService } from '../dataset/dataset-auto-link.service';
import { FieldMappingAutoService } from '../indicator/field-mapping-auto.service';
import { DataQualityService } from './data-quality.service';
import { INGESTION_QUEUE, type IngestionJobPayload } from './ingestion.types';
import { SchemaDetectionService } from './schema-detection.service';
import { StructuredLoadService } from './structured-load.service';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { chunkKnowledgeText } from './knowledge-chunker';
import { tokenizeForSearch } from './keyword-search';
import { MembershipService } from '../membership/membership.service';

@Processor(INGESTION_QUEUE, { lockDuration: 10 * 60 * 1000 })
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly minio: MinioService,
    private readonly parser: DocumentParserService,
    private readonly schemaDetection: SchemaDetectionService,
    private readonly quality: DataQualityService,
    private readonly structuredLoad: StructuredLoadService,
    private readonly embedding: EmbeddingService,
    private readonly milvus: MilvusService,
    private readonly autoLink: DatasetAutoLinkService,
    private readonly fieldMappingAuto: FieldMappingAutoService,
    private readonly notifications: BusinessNotificationWriter,
    private readonly membership: MembershipService,
    private readonly usageMeter: LlmUsageMeterService,
  ) {
    super();
  }

  async process(job: Job<IngestionJobPayload>): Promise<void> {
    const { jobId, targetType, targetId, versionId } = job.data;
    const persisted = await this.prisma.ingestionJob.findUniqueOrThrow({ where: { id: jobId } });
    if (persisted.status === IngestionJobStatus.succeeded) return;
    // 管理员审核/重建不改变付款人；只向用户上传来源的创建人计费。
    const item = targetType === 'knowledge'
      ? await this.prisma.knowledgeItem.findUniqueOrThrow({ where: { id: targetId }, select: { sourceType: true, submittedBy: true } })
      : null;
    const payerId = item?.sourceType === 'research_upload' ? item.submittedBy : null;
    await this.updateJob(jobId, {
      status: IngestionJobStatus.running,
      startedAt: new Date(),
      currentStep: 'parse',
      progress: 5,
    });
    try {
      let completed = false;
      if (persisted.billingState) {
        const state = persisted.billingState as unknown as LearningBillingState;
        await this.settleLearningUsage(jobId, state);
        completed = state.operationSucceeded;
      }
      if (!completed) {
        if (payerId) await this.membership.assertCanLearnKnowledge(payerId);
        const measured = await this.usageMeter.measure(async () => {
          try {
            if (targetType === 'dataset') {
        await this.processDataset(jobId, targetId, versionId);
      } else {
        await this.processKnowledge(jobId, targetId, versionId);
      }
            return { succeeded: true as const };
          } catch (error) {
            return { succeeded: false as const, error };
          }
        });
        if (payerId) {
          const state: LearningBillingState = {
            reference: `${jobId}:${randomUUID()}`, payerId,
            usage: measured.usage, operationSucceeded: measured.result.succeeded,
          };
          // 先保存供应商用量，再扣费；失败后重试只补结算，不重复执行已完成的学习。
          await this.updateJob(jobId, { billingState: state as unknown as Prisma.InputJsonValue });
          await this.settleLearningUsage(jobId, state);
        }
        if (!measured.result.succeeded) throw measured.result.error;
      }
      if (targetType === 'knowledge') await this.completeKnowledge(targetId, versionId);
      await this.updateJob(jobId, {
        status: IngestionJobStatus.succeeded,
        currentStep: 'done',
        progress: 100,
        completedAt: new Date(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `ingestion failed ${targetType}/${targetId}: ${message}`,
      );
      const attempts = job.opts.attempts ?? 1;
      const finalAttempt = job.attemptsMade + 1 >= attempts;
      await this.updateJob(jobId, {
        status: finalAttempt ? IngestionJobStatus.failed : IngestionJobStatus.pending,
        retryCount: job.attemptsMade + 1,
        errorMessage: message,
        ...(finalAttempt ? { completedAt: new Date() } : {}),
      });
      if (targetType === 'dataset' && finalAttempt) {
        await this.prisma.datasetVersion.update({
          where: { id: versionId },
          data: { status: DatasetVersionStatus.failed, errorMessage: message },
        });
      } else {
        if (finalAttempt) {
          await this.prisma.knowledgeVersion.update({ where: { id: versionId }, data: { status: KnowledgeVersionStatus.failed, errorMessage: message } });
          await this.prisma.knowledgeItem.update({ where: { id: targetId }, data: { vectorStatus: VectorSyncStatus.failed, vectorError: message } });
        }
      }
      throw err;
    }
  }

  private async settleLearningUsage(jobId: string, state: LearningBillingState) {
    if (state.settled) return;
    await this.membership.consumeKnowledgeLearningPoints(state.payerId, state.reference, state.usage);
    await this.updateJob(jobId, { billingState: { ...state, settled: true } as unknown as Prisma.InputJsonValue });
  }

  private async processDataset(
    jobId: string,
    datasetId: string,
    versionId: string,
  ) {
    const version = await this.prisma.datasetVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { dataset: true },
    });
    const buffer = await this.minio.getObject(version.rawObjectPath);
    const fileName = version.dataset.fileName ?? 'dataset.csv';
    const mimeType = version.dataset.mimeType ?? 'application/octet-stream';
    await this.prisma.datasetVersion.update({
      where: { id: versionId },
      data: { status: DatasetVersionStatus.parsing },
    });
    await this.updateJob(jobId, { currentStep: 'parse', progress: 15 });

    const parsed = await this.parser.parseBuffer(fileName, mimeType, buffer);
    await this.prisma.knowledgeVersion.update({ where: { id: versionId }, data: { status: KnowledgeVersionStatus.parsed } });
    const storageType =
      parsed.storageType === 'structured' ? 'STRUCTURED' : 'KNOWLEDGE';
    await this.prisma.datasetVersion.update({
      where: { id: versionId },
      data: { storageType: storageType as 'STRUCTURED' | 'KNOWLEDGE' },
    });

    if (parsed.storageType === 'structured') {
      const records = Array.isArray(parsed.structuredData)
        ? (parsed.structuredData as Record<string, unknown>[])
        : [];
      await this.updateJob(jobId, {
        currentStep: 'schema_detect',
        progress: 30,
      });
      await this.prisma.datasetVersion.update({
        where: { id: versionId },
        data: { status: DatasetVersionStatus.schema_detected },
      });
      const { fields, schemaJson, schemaHash } =
        this.schemaDetection.detectFromRecords(records);
      await this.updateJob(jobId, { currentStep: 'validate', progress: 45 });
      await this.prisma.datasetVersion.update({
        where: { id: versionId },
        data: { status: DatasetVersionStatus.validating },
      });
      const report = this.quality.validate(records, fields);
      if (report.status === 'failed') {
        throw new Error(report.details.map((d) => d.message).join('; '));
      }
      await this.updateJob(jobId, { currentStep: 'normalize', progress: 55 });
      await this.prisma.datasetVersion.update({
        where: { id: versionId },
        data: { status: DatasetVersionStatus.normalized },
      });
      await this.structuredLoad.saveSchema(
        versionId,
        fields,
        schemaJson,
        schemaHash,
      );
      const rowCount = await this.structuredLoad.loadRecords(
        versionId,
        records,
      );
      await this.prisma.datasetVersion.update({
        where: { id: versionId },
        data: { rowCount },
      });
      await this.autoLink.applyAutoLinks(datasetId);
      await this.fieldMappingAuto.applyForDatasetVersion(versionId);
    }

    await this.updateJob(jobId, { currentStep: 'finalize', progress: 90 });
    await this.prisma.datasetVersion.update({
      where: { id: versionId },
      data: { status: DatasetVersionStatus.ready },
    });
  }

  private async processKnowledge(
    jobId: string,
    knowledgeItemId: string,
    versionId: string,
  ) {
    const version = await this.prisma.knowledgeVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { knowledgeItem: true },
    });
    const item = version.knowledgeItem;
    const buffer = await this.minio.getObject(version.minioObjectPath);
    const fileName = item.fileName ?? 'document.pdf';
    const mimeType = item.mimeType ?? 'application/octet-stream';
    await this.prisma.knowledgeVersion.update({
      where: { id: versionId },
      data: { status: KnowledgeVersionStatus.parsing },
    });
    await this.updateJob(jobId, { currentStep: 'parse', progress: 20 });
    const parsed = await this.parser.parseBuffer(fileName, mimeType, buffer);
    const libraryConfig = item.libraryId
      ? await this.prisma.knowledgeLibrary.findFirst({ where: { id: item.libraryId, deletedAt: null }, select: { structuredIndexMode: true } })
      : null;
    const indexMode = libraryConfig?.structuredIndexMode ?? 'hybrid';
    const shouldMaterializeStructured = parsed.storageType === 'structured' && indexMode !== 'vector_only';
    const shouldVectorize = parsed.storageType !== 'structured' || indexMode !== 'sql_only';
    if (!shouldVectorize) {
      await this.prisma.$transaction(async (tx) => {
        await tx.knowledgeVersion.update({ where: { id: versionId }, data: { status: KnowledgeVersionStatus.ready, isCurrent: true } });
        await tx.knowledgeItem.update({ where: { id: knowledgeItemId }, data: { chunkCount: 0, vectorStatus: VectorSyncStatus.ready, vectorSyncedAt: new Date(), vectorError: null } });
      });
      return;
    }

    // CSV/Excel/JSON：沉淀到 DatasetVersion，供 Semantic Layer / 字段映射 / Text-to-SQL
    if (shouldMaterializeStructured) {
      await this.updateJob(jobId, { currentStep: 'structure', progress: 35 });
      await this.materializeStructuredFromKnowledge({
        knowledgeItemId,
        knowledgeVersionId: versionId,
        fileKey: version.minioObjectPath,
        fileName,
        mimeType,
        fileSize: version.fileSize ?? buffer.length,
        checksum: version.checksum,
        title: item.title,
        code: item.code,
        records: Array.isArray(parsed.structuredData)
          ? (parsed.structuredData as Record<string, unknown>[])
          : [],
        actorId: version.createdBy,
      });
    }

    await this.prisma.knowledgeVersion.update({
      where: { id: versionId },
      data: { status: KnowledgeVersionStatus.chunking },
    });
    await this.updateJob(jobId, { currentStep: 'chunk', progress: 55 });
    const library = item.libraryId
      ? await this.prisma.knowledgeLibrary.findFirst({
          where: { id: item.libraryId, deletedAt: null },
          select: { chunkMethod: true, chunkSize: true, chunkOverlap: true },
        })
      : null;
    const chunkSize = library?.chunkSize ?? 800;
    const chunkOverlap = Math.min(
      library?.chunkOverlap ?? 120,
      Math.max(0, chunkSize - 1),
    );
    // The searchable representation is identical for initial ingestion and reindexing.
    const searchableText = [
      `标题: ${item.title}`,
      `编码: ${item.code}`,
      item.summary ? `摘要: ${item.summary}` : '',
      item.content ? `正文: ${item.content}` : '',
      parsed.storageType === 'structured' && Array.isArray(parsed.structuredData) && parsed.structuredData.length > 1000
        ? parsed.textContent.slice(0, 30000)
        : parsed.textContent,
    ]
      .filter(Boolean)
      .join('\n\n');
    const chunks = chunkKnowledgeText(
      searchableText,
      chunkSize,
      chunkOverlap,
      library?.chunkMethod ?? 'smart',
    );
    await this.prisma.documentChunk.deleteMany({
      where: { knowledgeVersionId: versionId },
    });
    const chunkRows = await Promise.all(
      chunks.map((content, chunkIndex) =>
        this.prisma.documentChunk.create({
          data: {
            knowledgeVersionId: versionId,
            chunkIndex,
            content,
            tokenCount: Math.ceil(content.length / 4),
            searchText: tokenizeForSearch(content),
            sheetName: typeof parsed.metadata?.sheet === 'string' ? parsed.metadata.sheet : undefined,
            tableName: typeof parsed.metadata?.table === 'string' ? parsed.metadata.table : undefined,
            metadataJson: (parsed.metadata ?? {}) as Prisma.InputJsonValue,
          },
        }),
      ),
    );
    await this.prisma.knowledgeVersion.update({ where: { id: versionId }, data: { status: KnowledgeVersionStatus.chunked } });
    await this.prisma.knowledgeVersion.update({
      where: { id: versionId },
      data: { status: KnowledgeVersionStatus.indexing },
    });
    await this.updateJob(jobId, { currentStep: 'embed', progress: 75 });
    if (!chunks.length) throw new Error('Knowledge document contains no searchable text');
    if (!this.embedding.isReady() || !this.milvus.isReady()) {
      throw new Error('Embedding or Milvus is not ready; indexing aborted');
    }
    const vectors = await this.embedding.embedMany(chunks);
    if (vectors.length !== chunks.length) {
      throw new Error(`Embedding count mismatch: expected ${chunks.length}, got ${vectors.length}`);
    }
    const vectorPrefix = `${knowledgeItemId}_${versionId}`;
    const rows = chunkRows.map((row, i) => ({
      id: `${vectorPrefix}_${row.chunkIndex}`,
      vector: vectors[i],
      knowledge_id: knowledgeItemId,
      knowledge_version_id: versionId,
      chunk_index: row.chunkIndex,
      text: chunks[i].slice(0, 4096),
    }));
    await this.milvus.upsert(COL_KNOWLEDGE_CHUNKS, rows);
    await this.prisma.knowledgeVersion.update({ where: { id: versionId }, data: { status: KnowledgeVersionStatus.indexed } });
    await Promise.all(
      chunkRows.map((row) =>
        this.prisma.documentChunk.update({
          where: { id: row.id },
          data: { milvusId: `${vectorPrefix}_${row.chunkIndex}` },
        }),
      ),
    );
  }

  /** 结算成功后才切换当前版本；补结算重试复用已有向量。 */
  private async completeKnowledge(knowledgeItemId: string, versionId: string) {
    const version = await this.prisma.knowledgeVersion.findUniqueOrThrow({ where: { id: versionId }, include: { knowledgeItem: true } });
    const item = version.knowledgeItem;
    const chunkCount = await this.prisma.documentChunk.count({ where: { knowledgeVersionId: versionId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeVersion.updateMany({
        where: { knowledgeItemId, isCurrent: true },
        data: { isCurrent: false },
      });
      await tx.knowledgeVersion.update({
        where: { id: versionId },
        data: { status: KnowledgeVersionStatus.ready, isCurrent: true },
      });
      await tx.knowledgeItem.update({
        where: { id: knowledgeItemId },
        data: {
          chunkCount,
          vectorStatus: VectorSyncStatus.ready,
          vectorSyncedAt: new Date(),
          vectorError: null,
        },
      });
    });
    try {
      await this.milvus.deleteByFilter(
        COL_KNOWLEDGE_CHUNKS,
        `knowledge_id == "${knowledgeItemId}" && knowledge_version_id != "${versionId}"`,
      );
    } catch (cleanupError) {
      this.logger.warn(`old knowledge vectors cleanup failed ${knowledgeItemId}: ${String(cleanupError)}`);
    }
    const receiverId = item.submittedBy ?? version.createdBy;
    if (receiverId) {
      await this.notifications.fileLearned(
        receiverId,
        item.title || item.fileName || item.code,
      );
    }
  }

  /**
   * 知识库结构化文件 → 内部 Dataset + Version（供字段映射使用）。
   */
  private async materializeStructuredFromKnowledge(input: {
    knowledgeItemId: string;
    knowledgeVersionId: string;
    fileKey: string;
    fileName: string;
    mimeType: string;
    fileSize: number;
    checksum: string | null;
    title: string;
    code: string;
    records: Record<string, unknown>[];
    actorId?: string | null;
  }) {
    const datasetCode = `kb_${input.code}`.slice(0, 128);
    let dataset = await this.prisma.dataset.findFirst({
      where: { code: datasetCode, deletedAt: null },
    });
    if (!dataset) {
      dataset = await this.prisma.dataset.create({
        data: {
          name: input.title,
          code: datasetCode,
          description: `由知识条目 ${input.code} 结构化接入自动生成`,
          remark: `knowledgeItemId=${input.knowledgeItemId}`,
          visibility: 'private',
          publishStatus: 'published',
          status: 'active',
          fileKey: input.fileKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          createdBy: input.actorId ?? null,
        },
      });
    } else {
      dataset = await this.prisma.dataset.update({
        where: { id: dataset.id },
        data: {
          name: input.title,
          fileKey: input.fileKey,
          fileName: input.fileName,
          mimeType: input.mimeType,
          fileSize: input.fileSize,
          publishStatus: 'published',
        },
      });
    }

    await this.prisma.datasetVersion.updateMany({
      where: { datasetId: dataset.id, isCurrent: true },
      data: { isCurrent: false },
    });
    const latest = await this.prisma.datasetVersion.findFirst({
      where: { datasetId: dataset.id },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const datasetVersion = await this.prisma.datasetVersion.create({
      data: {
        datasetId: dataset.id,
        version: (latest?.version ?? 0) + 1,
        checksum: input.checksum,
        rawObjectPath: input.fileKey,
        sizeBytes: input.fileSize,
        status: DatasetVersionStatus.schema_detected,
        isCurrent: true,
        storageType: 'STRUCTURED',
        createdBy: input.actorId ?? null,
      },
    });

    const { fields, schemaJson, schemaHash } =
      this.schemaDetection.detectFromRecords(input.records);
    const report = this.quality.validate(input.records, fields);
    if (report.status === 'failed') {
      throw new Error(report.details.map((d) => d.message).join('; '));
    }
    await this.prisma.datasetVersion.update({
      where: { id: datasetVersion.id },
      data: { status: DatasetVersionStatus.normalized },
    });
    await this.structuredLoad.saveSchema(
      datasetVersion.id,
      fields,
      schemaJson,
      schemaHash,
    );
    const rowCount = await this.structuredLoad.loadRecords(
      datasetVersion.id,
      input.records,
    );
    await this.prisma.datasetVersion.update({
      where: { id: datasetVersion.id },
      data: {
        rowCount,
        status: DatasetVersionStatus.ready,
      },
    });
    await this.autoLink.applyAutoLinks(dataset.id);
    await this.fieldMappingAuto.applyForDatasetVersion(datasetVersion.id);

    const prevMeta =
      (
        await this.prisma.knowledgeItem.findUnique({
          where: { id: input.knowledgeItemId },
          select: { sourceMeta: true },
        })
      )?.sourceMeta ?? {};
    const metaObj =
      prevMeta && typeof prevMeta === 'object' && !Array.isArray(prevMeta)
        ? (prevMeta as Record<string, unknown>)
        : {};
    await this.prisma.knowledgeItem.update({
      where: { id: input.knowledgeItemId },
      data: {
        sourceMeta: {
          ...metaObj,
          structuredDatasetId: dataset.id,
          structuredDatasetVersionId: datasetVersion.id,
          structuredRowCount: rowCount,
          knowledgeVersionId: input.knowledgeVersionId,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async updateJob(
    jobId: string,
    data: Partial<{
      billingState: Prisma.InputJsonValue | Prisma.NullTypes.DbNull;
      status: IngestionJobStatus;
      currentStep: string;
      progress: number;
      errorMessage: string;
      retryCount: number;
      startedAt: Date;
      completedAt: Date;
    }>,
  ) {
    await this.prisma.ingestionJob.update({ where: { id: jobId }, data });
  }
}
