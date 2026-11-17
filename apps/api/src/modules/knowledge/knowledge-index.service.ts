import { Injectable } from '@nestjs/common';
import {
  KnowledgeAuditStatus,
  KnowledgePublishStatus,
  Prisma,
  VectorSyncStatus,
} from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { MilvusService } from '../../infrastructure/milvus/milvus.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VectorSyncProducer } from '../vector-sync/vector-sync.producer';
import { IngestionService } from '../ingestion/ingestion.service';
import {
  KnowledgeIndexFailedQueryDto,
  KnowledgePurgeVectorsDto,
  KnowledgeRebuildDto,
} from './dto/knowledge.dto';
import { KnowledgeIndexOverviewDto } from './dto/knowledge-response.dto';
import { KnowledgeItemService } from './knowledge-item.service';

/**
 * 知识向量索引维护：概览、重建、增量、脏数据清理、全量清空。
 */
@Injectable()
export class KnowledgeIndexService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly vectorSync: VectorSyncProducer,
    private readonly ingestion: IngestionService,
    private readonly items: KnowledgeItemService,
    private readonly milvus: MilvusService,
    private readonly notifications: BusinessNotificationWriter,
  ) {}

  async overview(): Promise<KnowledgeIndexOverviewDto> {
    const base = { deletedAt: null as Date | null };
    const [
      total,
      approved,
      published,
      pending,
      processing,
      ready,
      failed,
      dirtyCandidates,
    ] = await Promise.all([
      this.prisma.knowledgeItem.count({ where: base }),
      this.prisma.knowledgeItem.count({
        where: { ...base, auditStatus: KnowledgeAuditStatus.approved },
      }),
      this.prisma.knowledgeItem.count({
        where: { ...base, publishStatus: KnowledgePublishStatus.published },
      }),
      this.prisma.knowledgeItem.count({
        where: { ...base, vectorStatus: VectorSyncStatus.pending },
      }),
      this.prisma.knowledgeItem.count({
        where: { ...base, vectorStatus: VectorSyncStatus.processing },
      }),
      this.prisma.knowledgeItem.count({
        where: { ...base, vectorStatus: VectorSyncStatus.ready },
      }),
      this.prisma.knowledgeItem.count({
        where: { ...base, vectorStatus: VectorSyncStatus.failed },
      }),
      this.prisma.knowledgeItem.count({
        where: {
          OR: [
            { deletedAt: { not: null }, chunkCount: { gt: 0 } },
            {
              deletedAt: null,
              chunkCount: { gt: 0 },
              OR: [
                { publishStatus: { not: KnowledgePublishStatus.published } },
                { auditStatus: KnowledgeAuditStatus.rejected },
              ],
            },
            {
              deletedAt: null,
              vectorStatus: VectorSyncStatus.ready,
              publishStatus: { not: KnowledgePublishStatus.published },
            },
          ],
        },
      }),
    ]);

    return {
      total,
      approved,
      published,
      pending,
      processing,
      ready,
      failed,
      dirtyCandidates,
    };
  }

  async pageFailed(query: KnowledgeIndexFailedQueryDto) {
    const where: Prisma.KnowledgeItemWhereInput = {
      deletedAt: null,
      vectorStatus: VectorSyncStatus.failed,
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [rows, total] = await Promise.all([
      this.prisma.knowledgeItem.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          category: { select: { id: true, name: true, code: true } },
          tags: {
            include: {
              tag: { select: { id: true, name: true, code: true } },
            },
          },
          submitter: {
            select: {
              id: true,
              username: true,
              profile: { select: { displayName: true } },
            },
          },
          auditor: {
            select: {
              id: true,
              username: true,
              profile: { select: { displayName: true } },
            },
          },
        },
      }),
      this.prisma.knowledgeItem.count({ where }),
    ]);
    return new PageResultDto(
      await this.items.withHitCounts(rows),
      total,
      query.page,
      query.pageSize,
    );
  }

  async rebuild(dto: KnowledgeRebuildDto, actorId: string) {
    const ids = await this.resolvePublishedIds(dto.ids, dto.limit ?? 100);
    if (!ids.length) {
      throw new BusinessException(
        'KNOWLEDGE_INDEX_EMPTY',
        '没有可重建的已发布知识条目',
        400,
      );
    }
    await this.prisma.knowledgeItem.updateMany({
      where: { id: { in: ids } },
      data: {
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
      },
    });
    for (const id of ids) {
      await this.ingestion.reingestKnowledgeItem(id, actorId);
    }
    await this.audit.write({
      actorId,
      action: 'rebuild_index',
      resourceType: 'knowledge_index',
      detail: { count: ids.length },
    });
    await this.notifications.knowledgeIndexUpdated(actorId, ids.length);
    return { ok: true, count: ids.length };
  }

  async incremental(dto: KnowledgeRebuildDto, actorId: string) {
    const where: Prisma.KnowledgeItemWhereInput = {
      deletedAt: null,
      auditStatus: KnowledgeAuditStatus.approved,
      publishStatus: KnowledgePublishStatus.published,
      vectorStatus: {
        in: [VectorSyncStatus.pending, VectorSyncStatus.failed],
      },
      ...(dto.ids?.length ? { id: { in: [...new Set(dto.ids)] } } : {}),
    };
    const rows = await this.prisma.knowledgeItem.findMany({
      where,
      select: { id: true },
      take: dto.limit ?? 100,
      orderBy: { updatedAt: 'asc' },
    });
    const ids = rows.map((row) => row.id);
    if (!ids.length) {
      return { ok: true, count: 0 };
    }
    await this.prisma.knowledgeItem.updateMany({
      where: { id: { in: ids } },
      data: {
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
      },
    });
    for (const id of ids) {
      await this.ingestion.reingestKnowledgeItem(id, actorId);
    }
    await this.audit.write({
      actorId,
      action: 'incremental_index',
      resourceType: 'knowledge_index',
      detail: { count: ids.length },
    });
    await this.notifications.knowledgeIndexUpdated(actorId, ids.length);
    return { ok: true, count: ids.length };
  }

  async cleanupDirty(dto: KnowledgeRebuildDto, actorId: string) {
    const where: Prisma.KnowledgeItemWhereInput = {
      OR: [
        { deletedAt: { not: null } },
        {
          deletedAt: null,
          OR: [
            { publishStatus: { not: KnowledgePublishStatus.published } },
            { auditStatus: KnowledgeAuditStatus.rejected },
          ],
        },
      ],
      ...(dto.ids?.length ? { id: { in: [...new Set(dto.ids)] } } : {}),
    };
    const rows = await this.prisma.knowledgeItem.findMany({
      where,
      select: { id: true },
      take: dto.limit ?? 100,
      orderBy: { updatedAt: 'asc' },
    });
    const ids = rows.map((row) => row.id);
    for (const id of ids) {
      await this.vectorSync.enqueue({
        action: 'delete',
        entity: 'knowledge',
        id,
      });
    }
    if (ids.length) {
      await this.prisma.knowledgeItem.updateMany({
        where: {
          id: { in: ids },
          deletedAt: null,
        },
        data: {
          vectorStatus: VectorSyncStatus.pending,
          vectorError: null,
          chunkCount: 0,
          vectorSyncedAt: null,
        },
      });
    }
    await this.audit.write({
      actorId,
      action: 'cleanup_index',
      resourceType: 'knowledge_index',
      detail: { count: ids.length },
    });
    return { ok: true, count: ids.length };
  }

  /**
   * 清空全部向量（Milvus 知识分块库 + DB 状态），可选立即重新入队向量化。
   */
  async purgeAllVectors(dto: KnowledgePurgeVectorsDto, actorId: string) {
    if (!this.milvus.isReady()) {
      throw new BusinessException(
        'MILVUS_NOT_READY',
        'Milvus 未就绪，无法清空向量库',
        503,
      );
    }

    const reindex = dto.reindex === true;
    const reindexLimit = dto.reindexLimit ?? 500;

    await this.milvus.purgeChunkCollections();

    // 清理 PostgreSQL 中的知识分块与向量状态
    const deletedChunks = await this.prisma.documentChunk.deleteMany({});
    const knowledgeReset = await this.prisma.knowledgeItem.updateMany({
      where: { deletedAt: null },
      data: {
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
        chunkCount: 0,
        vectorSyncedAt: null,
      },
    });

    let knowledgeRequeued = 0;
    if (reindex) {
      const knowledgeIds = await this.prisma.knowledgeItem.findMany({
        where: {
          deletedAt: null,
          auditStatus: KnowledgeAuditStatus.approved,
          publishStatus: KnowledgePublishStatus.published,
        },
        select: { id: true },
        take: reindexLimit,
        orderBy: { updatedAt: 'asc' },
      });
      for (const row of knowledgeIds) {
        await this.ingestion.reingestKnowledgeItem(row.id, actorId);
      }
      knowledgeRequeued = knowledgeIds.length;
    }

    await this.audit.write({
      actorId,
      action: 'purge_all_vectors',
      resourceType: 'knowledge_index',
      detail: {
        reindex,
        deletedChunks: deletedChunks.count,
        knowledgeReset: knowledgeReset.count,
        knowledgeRequeued,
      },
    });

    return {
      ok: true,
      deletedChunks: deletedChunks.count,
      knowledgeReset: knowledgeReset.count,
      knowledgeRequeued,
    };
  }

  private async resolvePublishedIds(ids?: string[], limit = 100) {
    if (ids?.length) {
      const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
      if (unique.length > 100) {
        throw new BusinessException(
          'KNOWLEDGE_INDEX_TOO_MANY',
          '单次最多 100 条',
          400,
        );
      }
      const rows = await this.prisma.knowledgeItem.findMany({
        where: {
          id: { in: unique },
          deletedAt: null,
          auditStatus: KnowledgeAuditStatus.approved,
          publishStatus: KnowledgePublishStatus.published,
        },
        select: { id: true },
      });
      return rows.map((row) => row.id);
    }
    const rows = await this.prisma.knowledgeItem.findMany({
      where: {
        deletedAt: null,
        auditStatus: KnowledgeAuditStatus.approved,
        publishStatus: KnowledgePublishStatus.published,
      },
      select: { id: true },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
