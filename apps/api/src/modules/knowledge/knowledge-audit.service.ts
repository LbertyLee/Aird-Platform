import { Injectable } from '@nestjs/common';
import {
  KnowledgeAuditAction,
  KnowledgeAuditStatus,
  KnowledgePublishStatus,
  Prisma,
  VectorSyncStatus,
} from '@prisma/client';
import { extname } from 'node:path';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VectorSyncProducer } from '../vector-sync/vector-sync.producer';
import {
  ApproveKnowledgeDto,
  KnowledgeAuditPageQueryDto,
  RejectKnowledgeDto,
} from './dto/knowledge.dto';
import { KnowledgeAuditDetailDto } from './dto/knowledge-response.dto';
import { KnowledgeItemService } from './knowledge-item.service';

const EXTRACTABLE_EXT = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.html',
  '.htm',
  '.csv',
  '.json',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.pdf',
]);

/**
 * 知识入库审核：队列、内容校验、通过/驳回、来源溯源。
 */
@Injectable()
export class KnowledgeAuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly items: KnowledgeItemService,
    private readonly vectorSync: VectorSyncProducer,
  ) {}

  async page(query: KnowledgeAuditPageQueryDto) {
    const auditStatus = query.auditStatus ?? KnowledgeAuditStatus.pending;
    const where: Prisma.KnowledgeItemWhereInput = {
      deletedAt: null,
      auditStatus,
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(query.libraryVisibility
        ? {
            library: {
              visibility: query.libraryVisibility,
              deletedAt: null,
            },
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { summary: { contains: query.keyword, mode: 'insensitive' } },
              { fileName: { contains: query.keyword, mode: 'insensitive' } },
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
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
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
      rows.map((row) => this.items.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async detail(id: string): Promise<KnowledgeAuditDetailDto> {
    const item = await this.items.requireOne(id);
    const history = await this.prisma.knowledgeAuditRecord.findMany({
      where: { knowledgeItemId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: {
            id: true,
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });
    return {
      ...this.items.toView(item),
      auditHistory: history.map((record) => ({
        id: record.id,
        action: record.action,
        remark: record.remark,
        snapshot: (record.snapshot as Record<string, unknown> | null) ?? null,
        actor: record.actor
          ? {
              id: record.actor.id,
              username: record.actor.username,
              displayName: record.actor.profile?.displayName ?? null,
            }
          : null,
        createdAt: record.createdAt,
      })),
    };
  }

  async approve(id: string, dto: ApproveKnowledgeDto, actorId: string) {
    const row = await this.items.requireOne(id);
    if (row.auditStatus !== KnowledgeAuditStatus.pending) {
      throw new BusinessException(
        'KNOWLEDGE_AUDIT_STATE_INVALID',
        '仅待审核条目可通过',
        400,
      );
    }
    this.validateContent(row);

    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.knowledgeItem.update({
        where: { id },
        data: {
          auditStatus: KnowledgeAuditStatus.approved,
          auditedBy: actorId,
          auditedAt: new Date(),
          rejectReason: null,
        },
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
      });
      await tx.knowledgeAuditRecord.create({
        data: {
          knowledgeItemId: id,
          action: KnowledgeAuditAction.approve,
          actorId,
          remark: dto.remark,
          snapshot: {
            title: item.title,
            code: item.code,
            sourceType: item.sourceType,
            sourceMeta: item.sourceMeta,
            fileName: item.fileName,
            visibility: item.visibility,
          },
        },
      });
      return item;
    });

    await this.audit.write({
      actorId,
      action: 'approve',
      resourceType: 'knowledge_item',
      resourceId: id,
    });

    // 审核通过后自动发布并启动知识库接入流水线
    if (updated.fileKey || updated.content?.trim() || updated.summary?.trim()) {
      return this.items.publish(id, actorId);
    }
    return this.items.toView(updated);
  }

  async reject(id: string, dto: RejectKnowledgeDto, actorId: string) {
    const row = await this.items.requireOne(id);
    if (row.auditStatus !== KnowledgeAuditStatus.pending) {
      throw new BusinessException(
        'KNOWLEDGE_AUDIT_STATE_INVALID',
        '仅待审核条目可驳回',
        400,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const item = await tx.knowledgeItem.update({
        where: { id },
        data: {
          auditStatus: KnowledgeAuditStatus.rejected,
          publishStatus: KnowledgePublishStatus.draft,
          auditedBy: actorId,
          auditedAt: new Date(),
          rejectReason: dto.reason,
          vectorStatus: VectorSyncStatus.pending,
          vectorError: null,
          chunkCount: 0,
          vectorSyncedAt: null,
        },
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
      });
      await tx.knowledgeAuditRecord.create({
        data: {
          knowledgeItemId: id,
          action: KnowledgeAuditAction.reject,
          actorId,
          remark: dto.reason,
          snapshot: {
            title: item.title,
            code: item.code,
            sourceType: item.sourceType,
            sourceMeta: item.sourceMeta,
          },
        },
      });
      return item;
    });

    if (row.publishStatus === KnowledgePublishStatus.published) {
      await this.vectorSync.enqueue({
        action: 'delete',
        entity: 'knowledge',
        id,
      });
    }

    await this.audit.write({
      actorId,
      action: 'reject',
      resourceType: 'knowledge_item',
      resourceId: id,
      detail: { reason: dto.reason },
    });
    return this.items.toView(updated);
  }

  /**
   * 审核通过前的内容校验。
   */
  private validateContent(row: {
    title: string;
    code: string;
    summary: string | null;
    content: string | null;
    fileName: string | null;
    fileKey: string | null;
    mimeType: string | null;
    fileSize: number | null;
  }) {
    if (!row.title?.trim()) {
      throw new BusinessException(
        'KNOWLEDGE_VALIDATION_FAILED',
        '标题不能为空',
        400,
      );
    }
    if (!/^[a-zA-Z0-9_.:-]+$/.test(row.code)) {
      throw new BusinessException(
        'KNOWLEDGE_VALIDATION_FAILED',
        '编码仅允许字母、数字、下划线、点、冒号与连字符',
        400,
      );
    }
    const hasText = Boolean(row.summary?.trim() || row.content?.trim());
    const hasFile = Boolean(row.fileKey && row.fileName);
    if (!hasText && !hasFile) {
      throw new BusinessException(
        'KNOWLEDGE_VALIDATION_FAILED',
        '需提供正文/摘要或上传文件',
        400,
      );
    }
    if (hasFile && row.fileName) {
      const ext = extname(row.fileName).toLowerCase();
      if (!EXTRACTABLE_EXT.has(ext)) {
        throw new BusinessException(
          'KNOWLEDGE_VALIDATION_FAILED',
          '文件类型不在允许白名单内',
          400,
        );
      }
      if (row.fileSize != null && row.fileSize > 20 * 1024 * 1024) {
        throw new BusinessException(
          'KNOWLEDGE_VALIDATION_FAILED',
          '文件大小不能超过 20 MB',
          400,
        );
      }
    }
  }
}
