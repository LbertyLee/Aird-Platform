import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  CommonStatus,
  KnowledgeLibraryType,
  KnowledgeVisibility,
  Prisma,
} from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateKnowledgeLibraryDto,
  KnowledgeLibraryPageQueryDto,
  UpdateKnowledgeLibraryDto,
} from './dto/knowledge.dto';
import { KnowledgeLibraryViewDto } from './dto/knowledge-response.dto';
import {
  USER_SUPPLEMENT_LIBRARY_CODE,
  USER_SUPPLEMENT_LIBRARY_INTRO,
  USER_SUPPLEMENT_LIBRARY_NAME,
  isUserSupplementLibraryCode,
  userSupplementLibraryCode,
} from './knowledge.constants';

/**
 * 平台知识库（容器）应用服务。
 */
@Injectable()
export class KnowledgeLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  /**
   * 确保当前用户的私有「用户补充数据知识库」存在（每人一份）。
   * 无 userId 时回退到历史全局库（兼容匿名上传）。
   * 会把该用户曾写入全局库的文档迁到个人库。
   */
  async ensureUserSupplementLibrary(actorId?: string | null) {
    if (!actorId) {
      return this.ensureLegacySharedSupplementLibrary();
    }

    const code = userSupplementLibraryCode(actorId);
    let existing = await this.prisma.knowledgeLibrary.findFirst({
      where: { code, deletedAt: null },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });

    if (!existing) {
      existing = await this.prisma.knowledgeLibrary.create({
        data: {
          name: USER_SUPPLEMENT_LIBRARY_NAME,
          code,
          type: KnowledgeLibraryType.normal,
          visibility: KnowledgeVisibility.private,
          intro: USER_SUPPLEMENT_LIBRARY_INTRO,
          icon: '📎',
          color: '#e8f5e9',
          createdBy: actorId,
          updatedBy: actorId,
        },
        include: {
          creator: { include: { profile: true } },
          updater: { include: { profile: true } },
        },
      });
      await this.audit.write({
        actorId,
        action: 'create',
        resourceType: 'knowledge_library',
        resourceId: existing.id,
        detail: {
          code: existing.code,
          name: existing.name,
          system: true,
          perUser: true,
        },
      });
    } else {
      const needsMetaFix =
        existing.visibility !== KnowledgeVisibility.private ||
        existing.status !== CommonStatus.active ||
        existing.createdBy !== actorId;
      if (needsMetaFix) {
        existing = await this.prisma.knowledgeLibrary.update({
          where: { id: existing.id },
          data: {
            visibility: KnowledgeVisibility.private,
            status: CommonStatus.active,
            name: USER_SUPPLEMENT_LIBRARY_NAME,
            intro: USER_SUPPLEMENT_LIBRARY_INTRO,
            createdBy: existing.createdBy ?? actorId,
            updatedBy: actorId,
          },
          include: {
            creator: { include: { profile: true } },
            updater: { include: { profile: true } },
          },
        });
      }
    }

    await this.migrateLegacySupplementItems(actorId, existing.id);

    const fresh = await this.prisma.knowledgeLibrary.findFirst({
      where: { id: existing.id },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    return this.toView(fresh ?? existing);
  }

  /** 历史全局补充库（无登录上传回退 / 管理端种子） */
  private async ensureLegacySharedSupplementLibrary() {
    const existing = await this.prisma.knowledgeLibrary.findFirst({
      where: { code: USER_SUPPLEMENT_LIBRARY_CODE, deletedAt: null },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    if (existing) {
      return this.toView(existing);
    }
    const ownerId = await this.findPlatformAdminId();
    const row = await this.prisma.knowledgeLibrary.create({
      data: {
        name: USER_SUPPLEMENT_LIBRARY_NAME,
        code: USER_SUPPLEMENT_LIBRARY_CODE,
        type: KnowledgeLibraryType.normal,
        visibility: KnowledgeVisibility.private,
        intro: USER_SUPPLEMENT_LIBRARY_INTRO,
        icon: '📎',
        color: '#e8f5e9',
        createdBy: ownerId ?? undefined,
        updatedBy: ownerId ?? undefined,
      },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    await this.audit.write({
      actorId: ownerId ?? null,
      action: 'create',
      resourceType: 'knowledge_library',
      resourceId: row.id,
      detail: {
        code: row.code,
        name: row.name,
        system: true,
      },
    });
    return this.toView(row);
  }

  /**
   * 将用户在历史全局补充库中的文档迁到个人补充库，并重算容量。
   */
  private async migrateLegacySupplementItems(
    userId: string,
    targetLibraryId: string,
  ) {
    const legacy = await this.prisma.knowledgeLibrary.findFirst({
      where: { code: USER_SUPPLEMENT_LIBRARY_CODE, deletedAt: null },
      select: { id: true },
    });
    if (!legacy || legacy.id === targetLibraryId) return;

    const moved = await this.prisma.knowledgeItem.updateMany({
      where: {
        libraryId: legacy.id,
        submittedBy: userId,
        deletedAt: null,
      },
      data: { libraryId: targetLibraryId },
    });
    if (!moved.count) return;

    await Promise.all([
      this.recalcLibraryStats(legacy.id),
      this.recalcLibraryStats(targetLibraryId),
    ]);
  }

  private async recalcLibraryStats(libraryId: string) {
    const agg = await this.prisma.knowledgeItem.aggregate({
      where: { libraryId, deletedAt: null },
      _count: { _all: true },
      _sum: { fileSize: true },
    });
    await this.prisma.knowledgeLibrary.update({
      where: { id: libraryId },
      data: {
        fileTotal: agg._count._all,
        fileSize: agg._sum.fileSize ?? 0,
      },
    });
  }

  isUserSupplementLibrary(code: string) {
    return isUserSupplementLibraryCode(code);
  }

  /**
   * 用户端「存入知识库」可选列表：公用库 + 本人创建的私有库（含个人补充库）。
   */
  async listForUser(userId: string | null) {
    if (userId) {
      await this.ensureUserSupplementLibrary(userId);
    }
    const rows = await this.prisma.knowledgeLibrary.findMany({
      where: {
        deletedAt: null,
        status: CommonStatus.active,
        OR: [
          { visibility: KnowledgeVisibility.public },
          ...(userId ? [{ createdBy: userId }] : []),
        ],
      },
      orderBy: [{ visibility: 'asc' }, { updatedAt: 'desc' }],
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * 用户端知识库首页：本人创建的知识库（含个人补充库）。
   */
  async listMine(userId: string) {
    await this.ensureUserSupplementLibrary(userId);
    const rows = await this.prisma.knowledgeLibrary.findMany({
      where: {
        deletedAt: null,
        status: CommonStatus.active,
        createdBy: userId,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    return rows.map((row) => this.toView(row));
  }

  /**
   * 用户端知识库概览：列表 + 文档/学习统计。
   */
  async overviewForUser(userId: string) {
    const libraries = await this.listMine(userId);
    const libraryIds = libraries.map((l) => l.id);
    if (!libraryIds.length) {
      return {
        stats: {
          libraryCount: 0,
          documentCount: 0,
          learnedCount: 0,
          failedCount: 0,
        },
        libraries: [],
      };
    }

    const items = await this.prisma.knowledgeItem.findMany({
      where: {
        libraryId: { in: libraryIds },
        deletedAt: null,
      },
      select: {
        libraryId: true,
        vectorStatus: true,
      },
    });

    const docCountByLib = new Map<string, number>();
    let learnedCount = 0;
    let failedCount = 0;
    for (const item of items) {
      if (item.libraryId) {
        docCountByLib.set(
          item.libraryId,
          (docCountByLib.get(item.libraryId) ?? 0) + 1,
        );
      }
      if (item.vectorStatus === 'ready') learnedCount += 1;
      if (item.vectorStatus === 'failed') failedCount += 1;
    }

    return {
      stats: {
        libraryCount: libraries.length,
        documentCount: items.length,
        learnedCount,
        failedCount,
      },
      libraries: libraries.map((lib) => ({
        ...lib,
        fileTotal: docCountByLib.get(lib.id) ?? lib.fileTotal ?? 0,
      })),
    };
  }

  /**
   * 用户端新建知识库；图标默认取名称首字。
   */
  async createForUser(
    dto: CreateKnowledgeLibraryDto,
    actorId: string,
  ): Promise<KnowledgeLibraryViewDto> {
    const name = dto.name.trim();
    const firstChar =
      [...name].find((ch) => /[\u4e00-\u9fffA-Za-z0-9]/.test(ch)) || '知';
    return this.create(
      {
        ...dto,
        name,
        icon: dto.icon?.trim() || firstChar,
        color: dto.color?.trim() || '#3b82f6',
        type: dto.type ?? KnowledgeLibraryType.normal,
      },
      actorId,
    );
  }

  /**
   * 用户端知识分组下拉（字典 knowledge_group）。
   */
  async listGroupsForUser(libraryId?: string, client: Prisma.TransactionClient = this.prisma) {
    const rows = await client.dictionaryItem.findMany({
      where: {
        type: 'knowledge_group',
        status: CommonStatus.active,
        deletedAt: null,
      },
      orderBy: [{ sort: 'asc' }, { name: 'asc' }],
      select: { code: true, name: true },
    });
    if (!libraryId) return rows;
    const overrides = await client.knowledgeDocumentGroup.findMany({ where: { libraryId } });
    const merged = new Map(rows.map((row) => [row.code, row]));
    for (const row of overrides) {
      if (row.deletedAt) merged.delete(row.code);
      else merged.set(row.code, { code: row.code, name: row.name });
    }
    return [...merged.values()];
  }

  /** 与分组删除及文档写入共用库级行锁，避免删除后又写回失效分组。 */
  async lockDocumentGroups(tx: Prisma.TransactionClient, libraryId: string) {
    await tx.$queryRaw`SELECT id FROM knowledge_libraries WHERE id = ${libraryId} FOR UPDATE`;
  }

  async assertDocumentGroup(code: string, libraryId?: string | null, tx: Prisma.TransactionClient = this.prisma) {
    const groups = await this.listGroupsForUser(libraryId ?? undefined, tx);
    if (!groups.some((group) => group.code === code)) {
      throw new BusinessException('KNOWLEDGE_GROUP_INVALID', '知识分组不存在或已删除', 400);
    }
  }

  async saveDocumentGroup(libraryId: string, userId: string, name: string, code?: string) {
    await this.detailForUser(libraryId, userId);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 64) {
      throw new BusinessException('KNOWLEDGE_GROUP_NAME_INVALID', '分组名称须为 1 至 64 个字符', 400);
    }
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocumentGroups(tx, libraryId);
      const groups = await this.listGroupsForUser(libraryId, tx);
      if (code && !groups.some((group) => group.code === code)) {
        throw new BusinessException('KNOWLEDGE_GROUP_INVALID', '知识分组不存在或已删除', 404);
      }
      if (groups.some((group) => group.code !== code && group.name.toLowerCase() === trimmed.toLowerCase())) {
        throw new BusinessException('KNOWLEDGE_GROUP_NAME_EXISTS', '该知识库已存在同名分组', 409);
      }
      if (['全部文档', '未分组'].includes(trimmed)) {
        throw new BusinessException('KNOWLEDGE_GROUP_NAME_INVALID', '请使用其他分组名称', 400);
      }
      const groupCode = code ?? `custom-${randomUUID()}`;
      const row = await tx.knowledgeDocumentGroup.upsert({
        where: { libraryId_code: { libraryId, code: groupCode } },
        create: { libraryId, code: groupCode, name: trimmed },
        update: { name: trimmed },
      });
      return { code: row.code, name: row.name };
    });
  }

  async deleteDocumentGroup(libraryId: string, userId: string, code: string) {
    await this.detailForUser(libraryId, userId);
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocumentGroups(tx, libraryId);
      const groups = await this.listGroupsForUser(libraryId, tx);
      const group = groups.find((entry) => entry.code === code);
      if (!group) {
        throw new BusinessException('KNOWLEDGE_GROUP_INVALID', '知识分组不存在或已删除', 404);
      }
      await tx.knowledgeDocumentGroup.upsert({
        where: { libraryId_code: { libraryId, code } },
        create: { libraryId, code, name: group.name, deletedAt: new Date() },
        update: { deletedAt: new Date() },
      });
      const result = await tx.knowledgeItem.updateMany({
        where: { libraryId, groupCode: code },
        data: { groupCode: null },
      });
      return { movedCount: result.count };
    });
  }

  /**
   * 用户端知识库详情（仅本人创建的库可查看）。
   */
  async detailForUser(id: string, userId: string) {
    const row = await this.requireOne(id);
    if (row.createdBy !== userId) {
      throw new BusinessException(
        'KNOWLEDGE_LIBRARY_FORBIDDEN',
        '无权查看该知识库',
        403,
      );
    }
    return this.toView(row);
  }

  /**
   * 用户端更新知识库配置（仅创建人）。
   */
  async updateForUser(
    id: string,
    dto: UpdateKnowledgeLibraryDto,
    userId: string,
  ) {
    await this.detailForUser(id, userId);
    return this.update(id, dto, userId);
  }

  /**
   * 校验当前用户是否可向该知识库存入文档。
   */
  async assertUserCanDeposit(libraryId: string, userId: string | null) {
    const row = await this.requireOne(libraryId);
    if (row.status !== CommonStatus.active) {
      throw new BusinessException(
        'KNOWLEDGE_LIBRARY_INACTIVE',
        '知识库已停用，无法存入',
        400,
      );
    }
    if (this.isUserSupplementLibrary(row.code)) {
      if (userId && row.createdBy === userId) {
        return this.toView(row);
      }
      throw new BusinessException(
        'KNOWLEDGE_LIBRARY_FORBIDDEN',
        '无权向该知识库存入文档',
        403,
      );
    }
    if (row.visibility === KnowledgeVisibility.public) {
      return this.toView(row);
    }
    if (userId && row.createdBy === userId) {
      return this.toView(row);
    }
    throw new BusinessException(
      'KNOWLEDGE_LIBRARY_FORBIDDEN',
      '无权向该知识库存入文档',
      403,
    );
  }

  /** 回退到平台管理员，保证系统库有创建人/更新人。 */
  private async findPlatformAdminId(): Promise<string | undefined> {
    const row = await this.prisma.user.findFirst({
      where: {
        deletedAt: null,
        userRoles: {
          some: { role: { code: 'platform_admin', deletedAt: null } },
        },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return row?.id;
  }

  private buildPageWhere(query: KnowledgeLibraryPageQueryDto) {
    const where: Prisma.KnowledgeLibraryWhereInput = {
      deletedAt: null,
      ...(query.groupCode ? { groupCode: query.groupCode } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { intro: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    return where;
  }

  /** 全量聚合，用于分页列表外的分组/类型/可见性统计。 */
  async statistics(query: KnowledgeLibraryPageQueryDto) {
    const where = this.buildPageWhere({
      ...query,
      groupCode: undefined,
      type: undefined,
      visibility: undefined,
    } as KnowledgeLibraryPageQueryDto);
    const buckets = await this.prisma.knowledgeLibrary.groupBy({
      by: ['groupCode', 'type', 'visibility'],
      where,
      _count: { _all: true },
    });
    return buckets.map(({ _count, ...bucket }) => ({
      ...bucket,
      count: _count._all,
    }));
  }

  async page(query: KnowledgeLibraryPageQueryDto) {
    const where = this.buildPageWhere(query);
    const { skip, take } = query.toSkipTake();
    const [rows, total] = await Promise.all([
      this.prisma.knowledgeLibrary.findMany({
        where,
        skip,
        take,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        include: {
          creator: { include: { profile: true } },
          updater: { include: { profile: true } },
        },
      }),
      this.prisma.knowledgeLibrary.count({ where }),
    ]);
    return new PageResultDto(
      rows.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async detail(id: string): Promise<KnowledgeLibraryViewDto> {
    const row = await this.requireOne(id);
    return this.toView(row);
  }

  async create(dto: CreateKnowledgeLibraryDto, actorId: string) {
    const code = (dto.code?.trim() || this.genCode(dto.name)).slice(0, 128);
    await this.assertCodeUnique(code);
    if (dto.groupCode) {
      await this.assertGroupCode(dto.groupCode);
    }
    const row = await this.prisma.knowledgeLibrary.create({
      data: {
        name: dto.name.trim(),
        code,
        type: dto.type ?? KnowledgeLibraryType.normal,
        visibility: dto.visibility ?? KnowledgeVisibility.private,
        intro: dto.intro?.trim() || null,
        groupCode: dto.groupCode?.trim() || null,
        icon: dto.icon?.trim() || '📚',
        color: dto.color?.trim() || '#e6efff',
        structuredIndexMode: dto.structuredIndexMode?.trim() || 'hybrid',
        createdBy: actorId,
        updatedBy: actorId,
      },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'knowledge_library',
      resourceId: row.id,
      detail: { code: row.code, name: row.name },
    });
    return this.toView(row);
  }

  async update(id: string, dto: UpdateKnowledgeLibraryDto, actorId: string) {
    const current = await this.requireOne(id);
    if (this.isUserSupplementLibrary(current.code)) {
      if (
        dto.visibility !== undefined &&
        dto.visibility !== KnowledgeVisibility.private
      ) {
        throw new BusinessException(
          'SYSTEM_LIBRARY_LOCKED',
          '系统内置「用户补充数据知识库」必须保持私有（免审）',
          400,
        );
      }
      if (dto.status === CommonStatus.disabled) {
        throw new BusinessException(
          'SYSTEM_LIBRARY_LOCKED',
          '系统内置「用户补充数据知识库」不可停用',
          400,
        );
      }
    }
    if (dto.groupCode) {
      await this.assertGroupCode(dto.groupCode);
    }
    const row = await this.prisma.knowledgeLibrary.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
        ...(dto.visibility !== undefined
          ? { visibility: dto.visibility }
          : {}),
        ...(dto.intro !== undefined
          ? { intro: dto.intro?.trim() || null }
          : {}),
        ...(dto.groupCode !== undefined
          ? { groupCode: dto.groupCode?.trim() || null }
          : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon.trim() || '📚' } : {}),
        ...(dto.color !== undefined
          ? { color: dto.color.trim() || '#e6efff' }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.chunkMethod !== undefined
          ? { chunkMethod: dto.chunkMethod.trim() || 'smart' }
          : {}),
        ...(dto.chunkSize !== undefined ? { chunkSize: dto.chunkSize } : {}),
        ...(dto.chunkOverlap !== undefined
          ? { chunkOverlap: dto.chunkOverlap }
          : {}),
        ...(dto.structuredIndexMode !== undefined
          ? { structuredIndexMode: dto.structuredIndexMode.trim() || 'hybrid' }
          : {}),
        ...(dto.embeddingModel !== undefined
          ? { embeddingModel: dto.embeddingModel.trim() || 'text-embedding-v3' }
          : {}),
        ...(dto.recallTopK !== undefined ? { recallTopK: dto.recallTopK } : {}),
        ...(dto.similarityThreshold !== undefined
          ? { similarityThreshold: dto.similarityThreshold }
          : {}),
        ...(dto.hybridSemanticWeight !== undefined
          ? { hybridSemanticWeight: dto.hybridSemanticWeight }
          : {}),
        ...(dto.hybridKeywordWeight !== undefined
          ? { hybridKeywordWeight: dto.hybridKeywordWeight }
          : {}),
        updatedBy: actorId,
      },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'knowledge_library',
      resourceId: id,
    });
    return this.toView(row);
  }

  async remove(id: string, actorId: string) {
    const current = await this.requireOne(id);
    if (this.isUserSupplementLibrary(current.code)) {
      throw new BusinessException(
        'SYSTEM_LIBRARY_LOCKED',
        '系统内置「用户补充数据知识库」不可删除',
        400,
      );
    }
    await this.prisma.knowledgeLibrary.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: actorId },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'knowledge_library',
      resourceId: id,
    });
    return { ok: true };
  }

  private async requireOne(id: string) {
    const row = await this.prisma.knowledgeLibrary.findFirst({
      where: { id, deletedAt: null },
      include: {
        creator: { include: { profile: true } },
        updater: { include: { profile: true } },
      },
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

  private async assertCodeUnique(code: string, excludeId?: string) {
    const exists = await this.prisma.knowledgeLibrary.findFirst({
      where: {
        code,
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (exists) {
      throw new BusinessException(
        'KNOWLEDGE_LIBRARY_CODE_EXISTS',
        '知识库编码已存在',
        409,
      );
    }
  }

  private async assertGroupCode(groupCode: string) {
    const row = await this.prisma.dictionaryItem.findFirst({
      where: {
        type: 'knowledge_group',
        code: groupCode,
        status: CommonStatus.active,
        deletedAt: null,
      },
    });
    if (!row) {
      throw new BusinessException(
        'KNOWLEDGE_GROUP_INVALID',
        '知识分组不存在或已停用',
        400,
      );
    }
  }

  private genCode(name: string): string {
    const stamp = Date.now().toString(36);
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    return `kb-${slug || 'lib'}-${stamp}`;
  }

  toView(
    row: Prisma.KnowledgeLibraryGetPayload<{
      include: {
        creator: { include: { profile: true } };
        updater: { include: { profile: true } };
      };
    }>,
  ): KnowledgeLibraryViewDto {
    return {
      id: row.id,
      name: row.name,
      code: row.code,
      type: row.type,
      visibility: row.visibility,
      intro: row.intro,
      groupCode: row.groupCode,
      icon: row.icon,
      color: row.color,
      fileTotal: row.fileTotal,
      fileSize: row.fileSize,
      chunkMethod: row.chunkMethod,
      chunkSize: row.chunkSize,
      chunkOverlap: row.chunkOverlap,
      structuredIndexMode: row.structuredIndexMode,
      embeddingModel: row.embeddingModel,
      recallTopK: row.recallTopK,
      similarityThreshold: row.similarityThreshold,
      hybridSemanticWeight: row.hybridSemanticWeight,
      hybridKeywordWeight: row.hybridKeywordWeight,
      status: row.status,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      creatorName:
        row.creator?.profile?.displayName || row.creator?.username || null,
      updaterName:
        row.updater?.profile?.displayName || row.updater?.username || null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
