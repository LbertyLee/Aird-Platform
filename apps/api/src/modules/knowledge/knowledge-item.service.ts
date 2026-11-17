import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import {
  KnowledgeAuditAction,
  KnowledgeAuditStatus,
  KnowledgePublishStatus,
  KnowledgeSourceType,
  KnowledgeVisibility,
  Prisma,
  VectorSyncStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  buildDatasetFilePreview,
  getDatasetContentType,
  normalizeUploadedFileName,
  validateDatasetFile,
} from '../dataset/dataset-file-preview';
import { IngestionService } from '../ingestion/ingestion.service';
import { MembershipService } from '../membership/membership.service';
import { VectorSyncProducer } from '../vector-sync/vector-sync.producer';
import {
  CreateKnowledgeItemDto,
  KnowledgeItemPageQueryDto,
  UpdateKnowledgeItemDto,
} from './dto/knowledge.dto';
import { KnowledgeItemViewDto } from './dto/knowledge-response.dto';
import { KnowledgeCatalogService } from './knowledge-catalog.service';
import { KnowledgeLibraryService } from './knowledge-library.service';
import { isUserSupplementLibraryCode } from './knowledge.constants';
import { DEFAULT_KNOWLEDGE_GROUP_CODE } from '../dictionary/dictionary-type.constants';

const itemInclude = {
  category: { select: { id: true, name: true, code: true } },
  tags: {
    include: { tag: { select: { id: true, name: true, code: true } } },
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
} satisfies Prisma.KnowledgeItemInclude;

/** 用户端/研究端统一入库选项（最终仍走 create + upload） */
export type IngestUserUploadOptions = {
  libraryId?: string;
  groupCode?: string;
  visibility?: KnowledgeVisibility;
  tagIds?: string[];
  tagNames?: string[];
  title?: string;
  code?: string;
  summary?: string;
  sourceMeta?: Record<string, unknown>;
  sourceType?: KnowledgeSourceType;
};

type ItemWithRelations = Prisma.KnowledgeItemGetPayload<{
  include: typeof itemInclude;
}>;

/**
 * 知识条目 CRUD、上传、发布门禁与研究端待审入库。
 */
@Injectable()
export class KnowledgeItemService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeItemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly minio: MinioService,
    private readonly vectorSync: VectorSyncProducer,
    private readonly catalog: KnowledgeCatalogService,
    private readonly libraries: KnowledgeLibraryService,
    private readonly ingestion: IngestionService,
    private readonly membership: MembershipService,
  ) {}

  onApplicationBootstrap() {
    // Recover existing public submissions without delaying application startup.
    void this.recoverPendingPublicItems().catch((error: unknown) => {
      this.logger.error(`public knowledge recovery failed: ${String(error)}`);
    });
  }

  private async recoverPendingPublicItems() {
    let cursor: string | undefined;
    while (true) {
      const rows = await this.prisma.knowledgeItem.findMany({
        where: {
          deletedAt: null,
          auditStatus: KnowledgeAuditStatus.pending,
          OR: [
            { library: { visibility: KnowledgeVisibility.public, deletedAt: null } },
            { libraryId: null, visibility: KnowledgeVisibility.public },
          ],
        },
        select: { id: true, submittedBy: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!rows.length) return;
      for (const row of rows) {
        try {
          const approved = await this.prisma.$transaction(async (tx) => {
            const result = await tx.knowledgeItem.updateMany({
              where: { id: row.id, deletedAt: null, auditStatus: KnowledgeAuditStatus.pending, OR: [{ library: { visibility: KnowledgeVisibility.public, deletedAt: null } }, { libraryId: null, visibility: KnowledgeVisibility.public }] },
              data: { auditStatus: KnowledgeAuditStatus.approved, auditedBy: null, auditedAt: new Date(), rejectReason: null },
            });
            if (!result.count) return false;
            await tx.knowledgeAuditRecord.create({
              data: { knowledgeItemId: row.id, action: KnowledgeAuditAction.approve, remark: '系统自动审核通过' },
            });
            return true;
          });
          if (approved) await this.publishAndIngest(row.id, row.submittedBy);
        } catch (error) {
          this.logger.error(`public knowledge recovery failed id=${row.id}: ${String(error)}`);
          await this.prisma.knowledgeItem.updateMany({ where: { id: row.id, auditStatus: KnowledgeAuditStatus.approved }, data: { vectorStatus: VectorSyncStatus.failed, vectorError: String(error).slice(0, 1024) } }).catch(() => undefined);
        }
      }
      cursor = rows[rows.length - 1].id;
    }
  }

  /**
   * 研究端快捷上传：落入当前用户的「用户补充数据知识库」（私有免审）。
   * 实际处理委托 {@link ingestUserUpload}，保证与用户端存入同链路。
   */
  async ingestPendingUpload(
    file: Express.Multer.File,
    actorId: string | null = null,
  ) {
    return this.ingestUserUpload(file, actorId, {
      summary: '用户通过搜索上传的补充资料',
      sourceMeta: {
        uploadChannel: 'research',
        libraryCode: 'user-supplement-data',
      },
    });
  }

  /**
   * 用户端/研究端统一入库入口：create → upload → 自动发布并学习。
   * 不传 libraryId 时写入当前用户的「用户补充数据知识库」。
   */
  async ingestUserUpload(
    file: Express.Multer.File,
    actorId: string | null = null,
    options: IngestUserUploadOptions = {},
  ) {
    file.originalname = normalizeUploadedFileName(file.originalname);
    validateDatasetFile(file);

    if (actorId && (options.sourceType ?? KnowledgeSourceType.research_upload) === KnowledgeSourceType.research_upload) {
      await this.membership.assertCanLearnKnowledge(actorId);
    }

    let libraryId = options.libraryId?.trim() || undefined;
    let libraryCode: string | undefined;
    if (libraryId) {
      const library = await this.libraries.assertUserCanDeposit(
        libraryId,
        actorId,
      );
      libraryCode = library.code;
    } else {
      const library = await this.libraries.ensureUserSupplementLibrary(actorId);
      libraryId = library.id;
      libraryCode = library.code;
    }

    const tagIds = await this.resolveTagIds(
      options.tagIds,
      options.tagNames,
      actorId,
    );
    const code =
      options.code?.trim().slice(0, 128) || `user-kb-${randomUUID()}`;
    const item = await this.create(
      {
        title: (options.title?.trim() || file.originalname).slice(0, 256),
        code,
        summary:
          options.summary ??
          (libraryCode && isUserSupplementLibraryCode(libraryCode)
            ? '用户通过搜索上传的补充资料'
            : '用户端存入知识库'),
        libraryId,
        visibility: options.visibility ?? KnowledgeVisibility.private,
        groupCode: options.groupCode ?? (
          (await this.libraries.listGroupsForUser(libraryId)).some(
            (group) => group.code === DEFAULT_KNOWLEDGE_GROUP_CODE,
          ) ? DEFAULT_KNOWLEDGE_GROUP_CODE : ''
        ),
        tagIds: tagIds.length ? tagIds : undefined,
      },
      actorId,
      options.sourceType ?? KnowledgeSourceType.research_upload,
      {
        originalName: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
        uploadChannel: options.sourceMeta?.uploadChannel ?? 'user',
        libraryCode,
        ...options.sourceMeta,
      },
    );
    try {
      return await this.upload(item.id, file, actorId);
    } catch (error) {
      try {
        await this.remove(item.id, actorId);
      } catch {
        this.logger.warn(`knowledge cleanup failed id=${item.id}`);
      }
      throw error;
    }
  }

  /**
   * 将已有知识条目的文件复制后按同一链路重新入库（用于「勾选来源存入」）。
   */
  async ingestCopyFromItem(
    sourceItemId: string,
    actorId: string | null,
    options: IngestUserUploadOptions = {},
  ) {
    const row = await this.requireOne(sourceItemId);
    if (!row.fileKey || !row.fileName) {
      throw new BusinessException(
        'KNOWLEDGE_FILE_MISSING',
        '来源知识条目尚无文件，无法存入',
        400,
      );
    }
    const buffer = await this.minio.getObject(row.fileKey);
    const file = this.toMulterFile({
      buffer,
      fileName: row.fileName,
      mimeType: row.mimeType || getDatasetContentType(row.fileName),
    });
    return this.ingestUserUpload(file, actorId, {
      ...options,
      title: options.title?.trim() || row.title,
      summary: options.summary ?? row.summary ?? undefined,
      sourceMeta: {
        copiedFromKnowledgeItemId: sourceItemId,
        ...options.sourceMeta,
      },
    });
  }

  /**
   * 将纯文本包装为 .md 文件后走同一入库链路（网页/Exa 来源）。
   */
  async ingestFromTextContent(
    input: { title: string; text: string },
    actorId: string | null,
    options: IngestUserUploadOptions = {},
  ) {
    const title = input.title.trim() || '未命名来源';
    const text = input.text?.trim();
    if (!text) {
      throw new BusinessException(
        'KNOWLEDGE_TEXT_EMPTY',
        '来源正文为空，无法存入知识库',
        400,
      );
    }
    const safeBase =
      title
        .replace(/[\\/:*?"<>|]+/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) || 'source';
    const fileName = `${safeBase}.md`;
    const buffer = Buffer.from(text, 'utf8');
    const file = this.toMulterFile({
      buffer,
      fileName,
      mimeType: 'text/markdown; charset=utf-8',
    });
    return this.ingestUserUpload(file, actorId, {
      ...options,
      title: options.title?.trim() || title,
      summary: options.summary ?? text.slice(0, 200).replace(/\s+/g, ' '),
      sourceMeta: {
        textIngest: true,
        ...options.sourceMeta,
      },
    });
  }

  private toMulterFile(input: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  }): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname: input.fileName,
      encoding: '7bit',
      mimetype: input.mimeType,
      size: input.buffer.length,
      buffer: input.buffer,
      destination: '',
      filename: input.fileName,
      path: '',
      stream: undefined as unknown as Express.Multer.File['stream'],
    };
  }

  private async resolveTagIds(
    tagIds: string[] | undefined,
    tagNames: string[] | undefined,
    actorId: string | null,
  ): Promise<string[]> {
    const fromNames = tagNames?.length
      ? await this.catalog.ensureTagsByNames(tagNames, actorId)
      : [];
    return [...new Set([...(tagIds ?? []), ...fromNames])];
  }

  async create(
    dto: CreateKnowledgeItemDto,
    actorId: string | null,
    sourceType: KnowledgeSourceType = KnowledgeSourceType.admin,
    sourceMeta?: Record<string, unknown>,
  ) {
    const exists = await this.prisma.knowledgeItem.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException(
        'KNOWLEDGE_CODE_EXISTS',
        '知识条目编码已存在',
        409,
      );
    }
    if (dto.categoryId) {
      await this.catalog.requireCategory(dto.categoryId);
    }
    const library = dto.libraryId
      ? await this.requireLibrary(dto.libraryId)
      : null;
    const groupCode =
      dto.groupCode?.trim() ||
      (dto.groupCode === undefined && sourceType === KnowledgeSourceType.research_upload
        ? DEFAULT_KNOWLEDGE_GROUP_CODE
        : null);
    if (groupCode) {
      await this.libraries.assertDocumentGroup(groupCode, dto.libraryId);
    }
    if (dto.tagIds?.length) {
      await this.assertTags(dto.tagIds);
    }

    // 公用知识库记录系统自动审核；私有知识库免审核。
    const needsAudit = library
      ? library.visibility === KnowledgeVisibility.public
      : dto.visibility === KnowledgeVisibility.public;
    const visibility = library ? library.visibility : dto.visibility;
    const auditStatus = KnowledgeAuditStatus.approved;

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.libraryId) await this.libraries.lockDocumentGroups(tx, dto.libraryId);
      if (groupCode) await this.libraries.assertDocumentGroup(groupCode, dto.libraryId, tx);
      const created = await tx.knowledgeItem.create({
      data: {
        title: dto.title.trim(),
        code: dto.code.trim(),
        summary: dto.summary,
        content: dto.content,
        visibility,
        auditStatus,
        publishStatus: KnowledgePublishStatus.draft,
        categoryId: dto.categoryId,
        libraryId: dto.libraryId,
        groupCode,
        sourceType,
        sourceMeta: (sourceMeta ?? undefined) as
          Prisma.InputJsonValue | undefined,
        submittedBy: actorId,
        auditedBy: needsAudit ? null : actorId,
        auditedAt: new Date(),
        vectorStatus: VectorSyncStatus.pending,
        tags: dto.tagIds?.length
          ? {
              create: dto.tagIds.map((tagId) => ({ tagId })),
            }
          : undefined,
      },
      include: itemInclude,
      });
      if (needsAudit) {
        await tx.knowledgeAuditRecord.create({ data: {
          knowledgeItemId: created.id, action: KnowledgeAuditAction.approve,
          remark: '系统自动审核通过',
        } });
      }
      return created;
    });

    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'knowledge_item',
      resourceId: row.id,
      detail: { auditStatus, sourceType, needsAudit },
    });
    return this.toView(row);
  }

  /**
   * 用户端编辑：支持标签名（自动建标）与分组调整。
   */
  async updateForUser(
    id: string,
    input: {
      title?: string;
      tags?: string[];
      groupCode?: string | null;
      summary?: string | null;
    },
    actorId: string,
  ) {
    const tagIds =
      input.tags !== undefined
        ? await this.catalog.ensureTagsByNames(input.tags, actorId)
        : undefined;
    return this.update(
      id,
      {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.groupCode !== undefined
          ? { groupCode: input.groupCode }
          : {}),
        ...(tagIds !== undefined ? { tagIds } : {}),
      },
      actorId,
    );
  }

  async update(id: string, dto: UpdateKnowledgeItemDto, actorId: string) {
    const current = await this.requireOne(id);
    if (dto.categoryId) {
      await this.catalog.requireCategory(dto.categoryId);
    }
    const nextLibraryId =
      dto.libraryId !== undefined ? dto.libraryId : current.libraryId;
    const library = nextLibraryId
      ? await this.requireLibrary(nextLibraryId)
      : null;
    if (dto.groupCode) {
      await this.libraries.assertDocumentGroup(dto.groupCode.trim(), nextLibraryId);
    }
    if (dto.tagIds) {
      await this.assertTags(dto.tagIds);
    }

    const needsAudit = library
      ? library.visibility === KnowledgeVisibility.public
      : (dto.visibility ?? current.visibility) === KnowledgeVisibility.public;


    const row = await this.prisma.$transaction(async (tx) => {
      for (const libraryId of [...new Set([current.libraryId, nextLibraryId].filter((value): value is string => !!value))].sort()) {
        await this.libraries.lockDocumentGroups(tx, libraryId);
      }
      if (dto.groupCode) await this.libraries.assertDocumentGroup(dto.groupCode.trim(), nextLibraryId, tx);
      if (dto.tagIds) {
        await tx.knowledgeItemTag.deleteMany({
          where: { knowledgeItemId: id },
        });
        if (dto.tagIds.length) {
          await tx.knowledgeItemTag.createMany({
            data: dto.tagIds.map((tagId) => ({
              knowledgeItemId: id,
              tagId,
            })),
          });
        }
      }

      const updated = await tx.knowledgeItem.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
          ...(dto.summary !== undefined ? { summary: dto.summary } : {}),
          ...(dto.content !== undefined ? { content: dto.content } : {}),
          ...(dto.visibility !== undefined
            ? { visibility: dto.visibility }
            : {}),
          ...(library ? { visibility: library.visibility } : {}),
          ...(dto.categoryId !== undefined
            ? { categoryId: dto.categoryId }
            : {}),
          ...(dto.libraryId !== undefined ? { libraryId: dto.libraryId } : {}),
          ...(dto.groupCode !== undefined
            ? { groupCode: dto.groupCode?.trim() || null }
            : {}),
          ...((current.auditStatus === KnowledgeAuditStatus.pending ||
              (needsAudit && current.auditStatus === KnowledgeAuditStatus.rejected))
            ? { auditStatus: KnowledgeAuditStatus.approved, auditedBy: needsAudit ? null : actorId, auditedAt: new Date(), rejectReason: null }
            : {}),
        },
        include: itemInclude,
      });

      if (needsAudit && current.auditStatus !== KnowledgeAuditStatus.approved) {
        await tx.knowledgeAuditRecord.create({ data: { knowledgeItemId: id, action: KnowledgeAuditAction.approve, remark: '系统自动审核通过' } });
      }
      return updated;
    });

    const affectsSearchableText =
      dto.title !== undefined ||
      dto.summary !== undefined ||
      dto.content !== undefined ||
      dto.categoryId !== undefined ||
      dto.tagIds !== undefined;
    if (needsAudit && current.auditStatus !== KnowledgeAuditStatus.approved && (row.fileKey || row.content?.trim() || row.summary?.trim())) {
      await this.publishAndIngest(id, actorId);
    } else if (
      affectsSearchableText &&
      row.auditStatus === KnowledgeAuditStatus.approved &&
      row.publishStatus === KnowledgePublishStatus.published
    ) {
      await this.prisma.knowledgeItem.update({
        where: { id },
        data: { vectorStatus: VectorSyncStatus.pending, vectorError: null },
      });
      await this.publishAndIngest(id, actorId);
    }

    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'knowledge_item',
      resourceId: id,
      detail: needsAudit ? { autoApproved: true } : undefined,
    });
    return this.toView(row);
  }

  async remove(id: string, actorId: string | null) {
    const row = await this.requireOne(id);
    await this.prisma.knowledgeItem.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    if (row.fileKey) {
      try {
        await this.minio.deleteObject(row.fileKey);
      } catch {
        this.logger.warn(`knowledge file delete failed id=${id}`);
      }
    }
    await this.vectorSync.enqueue({
      action: 'delete',
      entity: 'knowledge',
      id,
    });
    if (row.libraryId) {
      await this.refreshLibraryStats(row.libraryId, actorId);
    }
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'knowledge_item',
      resourceId: id,
    });
    return { ok: true };
  }

  async detail(id: string) {
    return this.toView(await this.requireOne(id));
  }

  async chunks(id: string) {
    await this.requireOne(id);
    const version = await this.prisma.knowledgeVersion.findFirst({
      where: { knowledgeItemId: id, isCurrent: true },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true },
    });
    if (!version) return { version: null, chunks: [] };
    const chunks = await this.prisma.documentChunk.findMany({
      where: { knowledgeVersionId: version.id },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true, chunkIndex: true, content: true, tokenCount: true,
        pageNumber: true, section: true, sheetName: true, tableName: true,
      },
    });
    return { version, chunks };
  }

  /**
   * 合并来源元数据（不改变审核/发布状态）。
   */
  async mergeSourceMeta(id: string, patch: Record<string, unknown>) {
    const row = await this.requireOne(id);
    const current = (row.sourceMeta as Record<string, unknown> | null) ?? {};
    await this.prisma.knowledgeItem.update({
      where: { id },
      data: {
        sourceMeta: {
          ...current,
          ...patch,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private buildPageWhere(query: KnowledgeItemPageQueryDto) {
    const where: Prisma.KnowledgeItemWhereInput = {
      deletedAt: null,
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(query.auditStatus ? { auditStatus: query.auditStatus } : {}),
      ...(query.publishStatus ? { publishStatus: query.publishStatus } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.libraryId ? { libraryId: query.libraryId } : {}),
      ...(query.groupCode ? { groupCode: query.groupCode } : {}),
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
    return where;
  }

  /** 全量聚合，用于分页列表外的分组与学习状态统计。 */
  async statistics(query: KnowledgeItemPageQueryDto) {
    const where = this.buildPageWhere({
      ...query,
      groupCode: undefined,
    } as KnowledgeItemPageQueryDto);
    const buckets = await this.prisma.knowledgeItem.groupBy({
      by: ['groupCode', 'auditStatus', 'vectorStatus', 'publishStatus'],
      where,
      _count: { _all: true },
    });
    return buckets.map(({ _count, ...bucket }) => ({
      ...bucket,
      count: _count._all,
    }));
  }

  async page(query: KnowledgeItemPageQueryDto) {
    const where = this.buildPageWhere(query);
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.knowledgeItem.findMany({
        where,
        skip,
        take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: itemInclude,
      }),
      this.prisma.knowledgeItem.count({ where }),
    ]);
    return new PageResultDto(
      await this.withHitCounts(items),
      total,
      query.page,
      query.pageSize,
    );
  }

  async publish(id: string, actorId: string) {
    const row = await this.requireOne(id);
    if (row.auditStatus !== KnowledgeAuditStatus.approved) {
      throw new BusinessException(
        'KNOWLEDGE_NOT_APPROVED',
        '仅审核通过的知识条目可发布',
        400,
      );
    }
    const updated = await this.prisma.knowledgeItem.update({
      where: { id },
      data: {
        publishStatus: KnowledgePublishStatus.published,
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
      },
      include: itemInclude,
    });
    await this.publishAndIngest(id, actorId);
    await this.audit.write({
      actorId,
      action: 'publish',
      resourceType: 'knowledge_item',
      resourceId: id,
    });
    return this.toView(updated);
  }

  /**
   * 重新触发接入学习（已有文件即可；会自动发布）。
   */
  async relearn(id: string, actorId: string) {
    const row = await this.requireOne(id);
    if (row.sourceType === KnowledgeSourceType.research_upload && row.submittedBy) {
      await this.membership.assertCanLearnKnowledge(row.submittedBy);
    }
    if (!row.fileKey) {
      throw new BusinessException(
        'KNOWLEDGE_FILE_MISSING',
        '知识条目尚未上传文件，无法学习',
        400,
      );
    }
    const library = row.libraryId
      ? await this.prisma.knowledgeLibrary.findUnique({
          where: { id: row.libraryId },
          select: { visibility: true },
        })
      : null;
    const isPrivate =
      (library?.visibility ?? row.visibility) === KnowledgeVisibility.private;

    // 历史待审核条目自动通过后重新学习
    if (row.auditStatus === KnowledgeAuditStatus.pending) {

      await this.prisma.knowledgeItem.update({
        where: { id },
        data: {
          auditStatus: KnowledgeAuditStatus.approved,
          auditedBy: isPrivate ? actorId : null,
          auditedAt: new Date(),
          rejectReason: null,
        },
      });
    }
    if (row.auditStatus === KnowledgeAuditStatus.rejected) {
      throw new BusinessException(
        'KNOWLEDGE_REJECTED',
        '已驳回条目无法学习，请重新上传或修改后提交',
        400,
      );
    }
    await this.publishAndIngest(id, actorId, undefined, true);
    const refreshed = await this.requireOne(id);
    await this.audit.write({
      actorId,
      action: 'relearn',
      resourceType: 'knowledge_item',
      resourceId: id,
    });
    return this.toView(refreshed);
  }

  async unpublish(id: string, actorId: string) {
    await this.requireOne(id);
    const updated = await this.prisma.knowledgeItem.update({
      where: { id },
      data: {
        publishStatus: KnowledgePublishStatus.unpublished,
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
        chunkCount: 0,
        vectorSyncedAt: null,
      },
      include: itemInclude,
    });
    await this.vectorSync.enqueue({
      action: 'delete',
      entity: 'knowledge',
      id,
    });
    await this.audit.write({
      actorId,
      action: 'unpublish',
      resourceType: 'knowledge_item',
      resourceId: id,
    });
    return this.toView(updated);
  }

  async upload(id: string, file: Express.Multer.File, actorId: string | null) {
    const row = await this.requireOne(id);
    file.originalname = normalizeUploadedFileName(file.originalname);
    validateDatasetFile(file);
    const fileName = file.originalname;
    const ext = extname(fileName).toLowerCase();
    const key = this.ingestion.buildKnowledgeObjectKey(id, fileName);
    const contentType = getDatasetContentType(fileName);
    await this.minio.putObject(key, file.buffer, contentType);

    // 公用知识库文件自动审核通过后学习
    const library = row.libraryId
      ? await this.prisma.knowledgeLibrary.findUnique({
          where: { id: row.libraryId },
          select: { visibility: true },
        })
      : null;
    const autoApprove = (library ? library.visibility : row.visibility) === KnowledgeVisibility.public;

    let updated: ItemWithRelations;
    try {
      updated = await this.prisma.knowledgeItem.update({
        where: { id },
        data: {
          fileKey: key,
          fileName,
          mimeType: contentType,
          fileSize: file.size,
          vectorStatus: VectorSyncStatus.pending,
          vectorError: null,
          ...(autoApprove ? { auditStatus: KnowledgeAuditStatus.approved, auditedBy: null, auditedAt: new Date(), rejectReason: null } : {}),
        },
        include: itemInclude,
      });
    } catch (error) {
      try {
        await this.minio.deleteObject(key);
      } catch {
        this.logger.warn(`new knowledge file cleanup failed id=${id}`);
      }
      throw error;
    }

    if (row.fileKey && row.fileKey !== key) {
      try {
        await this.minio.deleteObject(row.fileKey);
      } catch {
        this.logger.warn(`old knowledge file cleanup failed id=${id}`);
      }
    }

    if (row.publishStatus === KnowledgePublishStatus.published) {
      await this.vectorSync.enqueue({
        action: 'delete',
        entity: 'knowledge',
        id,
      });
    }

    await this.audit.write({
      actorId,
      action: 'upload',
      resourceType: 'knowledge_item',
      resourceId: id,
      detail: { fileName, size: file.size, autoApproved: autoApprove },
    });

    if (updated.libraryId) {
      await this.refreshLibraryStats(updated.libraryId, actorId);
    }

    // 已过审条目上传后自动发布并启动接入流水线
    if (updated.auditStatus === KnowledgeAuditStatus.approved) {
      await this.publishAndIngest(id, actorId, file.buffer);
      const refreshed = await this.requireOne(id);
      return this.toView(refreshed);
    }

    return this.toView(updated);
  }

  /**
   * 发布知识条目并启动 ingestion（结构化解析 + 分块向量化）。
   */
  private async publishAndIngest(
    id: string,
    actorId: string | null,
    buffer?: Buffer,
    force = false,
  ) {
    const row = await this.requireOne(id);
    let fileKey = row.fileKey;
    let fileSize = row.fileSize ?? 0;
    const sourceMeta =
      row.sourceMeta && typeof row.sourceMeta === 'object'
        ? (row.sourceMeta as Record<string, unknown>)
        : {};
    const isInlineContent = sourceMeta.inlineContent === true;
    if (
      (!fileKey || isInlineContent) &&
      (row.content?.trim() || row.summary?.trim())
    ) {
      const text = row.content?.trim() || row.summary!.trim();
      const fileName = `${row.code}.md`;
      const inlineBuffer = Buffer.from(text, 'utf8');
      fileKey = this.ingestion.buildKnowledgeObjectKey(id, fileName);
      fileSize = inlineBuffer.length;
      await this.minio.putObject(
        fileKey,
        inlineBuffer,
        'text/markdown; charset=utf-8',
      );
      await this.prisma.knowledgeItem.update({
        where: { id },
        data: {
          fileKey,
          fileName,
          mimeType: 'text/markdown; charset=utf-8',
          fileSize,
          sourceMeta: {
            ...sourceMeta,
            inlineContent: true,
          } as Prisma.InputJsonValue,
        },
      });
      buffer = inlineBuffer;
    }
    if (!fileKey) return;
    await this.prisma.knowledgeItem.update({
      where: { id },
      data: {
        publishStatus: KnowledgePublishStatus.published,
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
      },
    });
    // The file and item have already been persisted at this point.  Queue/DB
    // failures in the asynchronous ingestion pipeline must not turn a
    // successful upload into an HTTP 500 response (the client would retry and
    // create another item).  Keep the item available and expose the failure
    // through vectorStatus/vectorError for the retry operation.
    try {
      await this.ingestion.startKnowledgeIngestion({
        knowledgeItemId: id,
        fileKey,
        fileSize,
        actorId,
        buffer,
        force,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`knowledge ingestion enqueue failed id=${id}: ${message}`);
      await this.prisma.knowledgeItem.update({
        where: { id },
        data: {
          vectorStatus: VectorSyncStatus.failed,
          vectorError: message.slice(0, 1024),
        },
      });
    }
  }

  async preview(id: string) {
    const row = await this.requireOne(id);
    if (!row.fileKey || !row.fileName) {
      throw new BusinessException(
        'KNOWLEDGE_FILE_MISSING',
        '知识条目尚未上传文件',
        404,
      );
    }
    const fileName = normalizeUploadedFileName(row.fileName);
    if (extname(fileName).toLowerCase() === '.pdf') {
      return {
        kind: 'pdf' as const,
        fileName,
        mimeType: 'application/pdf' as const,
      };
    }
    const buf = await this.minio.getObject(row.fileKey);
    return buildDatasetFilePreview(buf, fileName);
  }

  async fileStream(id: string) {
    const row = await this.requireOne(id);
    if (!row.fileKey || !row.fileName) {
      throw new BusinessException(
        'KNOWLEDGE_FILE_MISSING',
        '知识条目尚未上传文件',
        404,
      );
    }
    const fileName = normalizeUploadedFileName(row.fileName);
    const buf = await this.minio.getObject(row.fileKey);
    return {
      buffer: buf,
      fileName,
      contentType: row.mimeType || getDatasetContentType(fileName),
    };
  }

  async requireOne(id: string) {
    const row = await this.prisma.knowledgeItem.findFirst({
      where: { id, deletedAt: null },
      include: itemInclude,
    });
    if (!row) {
      throw new BusinessException('KNOWLEDGE_NOT_FOUND', '知识条目不存在', 404);
    }
    return row;
  }

  toView(row: ItemWithRelations): KnowledgeItemViewDto {
    return {
      id: row.id,
      title: row.title,
      code: row.code,
      summary: row.summary,
      content: row.content,
      visibility: row.visibility,
      auditStatus: row.auditStatus,
      publishStatus: row.publishStatus,
      categoryId: row.categoryId,
      category: row.category,
      libraryId: row.libraryId,
      groupCode: row.groupCode,
      sourceType: row.sourceType,
      sourceMeta: (row.sourceMeta as Record<string, unknown> | null) ?? null,
      fileName: row.fileName,
      mimeType: row.mimeType,
      fileSize: row.fileSize,
      chunkCount: row.chunkCount,
      hitCount: Number((row as { hitCount?: number | null }).hitCount ?? 0),
      vectorStatus: row.vectorStatus,
      vectorError: row.vectorError,
      vectorSyncedAt: row.vectorSyncedAt,
      rejectReason: row.rejectReason,
      auditedAt: row.auditedAt,
      submitter: row.submitter
        ? {
            id: row.submitter.id,
            username: row.submitter.username,
            displayName: row.submitter.profile?.displayName ?? null,
          }
        : null,
      auditor: row.auditor
        ? {
            id: row.auditor.id,
            username: row.auditor.username,
            displayName: row.auditor.profile?.displayName ?? null,
          }
        : null,
      tags: row.tags.map((link) => link.tag),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** Prisma Client 未 regenerate 时仍可读取 hit_count */
  async withHitCounts(
    rows: ItemWithRelations[],
  ): Promise<KnowledgeItemViewDto[]> {
    const views = rows.map((row) => this.toView(row));
    if (!views.length) return views;
    const counts = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; hit_count: number }>
    >(
      `SELECT id, hit_count FROM knowledge_items WHERE id = ANY($1::text[])`,
      views.map((v) => v.id),
    );
    const map = new Map(
      counts.map((c) => [c.id, Number(c.hit_count) || 0] as const),
    );
    return views.map((v) => ({
      ...v,
      hitCount: map.get(v.id) ?? v.hitCount ?? 0,
    }));
  }

  private async assertTags(tagIds: string[]) {
    const unique = [...new Set(tagIds)];
    const count = await this.prisma.knowledgeTag.count({
      where: { id: { in: unique }, deletedAt: null },
    });
    if (count !== unique.length) {
      throw new BusinessException(
        'KNOWLEDGE_TAG_NOT_FOUND',
        '存在无效标签',
        400,
      );
    }
  }

  private async requireLibrary(libraryId: string) {
    const row = await this.prisma.knowledgeLibrary.findFirst({
      where: { id: libraryId, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(
        'KNOWLEDGE_LIBRARY_NOT_FOUND',
        '知识库不存在',
        404,
      );
    }
    return row;
  }

  private async assertLibrary(libraryId: string) {
    await this.requireLibrary(libraryId);
  }

  private async refreshLibraryStats(
    libraryId: string,
    actorId?: string | null,
  ) {
    const agg = await this.prisma.knowledgeItem.aggregate({
      where: {
        libraryId,
        deletedAt: null,
        fileKey: { not: null },
      },
      _count: { id: true },
      _sum: { fileSize: true },
    });
    await this.prisma.knowledgeLibrary.update({
      where: { id: libraryId },
      data: {
        fileTotal: agg._count.id,
        fileSize: agg._sum.fileSize ?? 0,
        ...(actorId ? { updatedBy: actorId } : {}),
      },
    });
  }
}
