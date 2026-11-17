import { Injectable } from '@nestjs/common';
import { CommonStatus, Prisma } from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  CreateKnowledgeCategoryDto,
  CreateKnowledgeTagDto,
  KnowledgeTagPageQueryDto,
  UpdateKnowledgeCategoryDto,
  UpdateKnowledgeTagDto,
} from './dto/knowledge.dto';
import { KnowledgeCategoryTreeDto } from './dto/knowledge-response.dto';

/**
 * 知识类目与标签管理。
 */
@Injectable()
export class KnowledgeCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  async createCategory(dto: CreateKnowledgeCategoryDto, actorId: string) {
    const exists = await this.prisma.knowledgeCategory.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException(
        'KNOWLEDGE_CATEGORY_CODE_EXISTS',
        '分类编码已存在',
        409,
      );
    }
    if (dto.parentId) {
      await this.requireCategory(dto.parentId);
    }
    const row = await this.prisma.knowledgeCategory.create({
      data: {
        name: dto.name,
        code: dto.code,
        parentId: dto.parentId,
        sort: dto.sort ?? 0,
        status: dto.status ?? CommonStatus.active,
        description: dto.description,
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'knowledge_category',
      resourceId: row.id,
    });
    return row;
  }

  async updateCategory(
    id: string,
    dto: UpdateKnowledgeCategoryDto,
    actorId: string,
  ) {
    await this.requireCategory(id);
    if (dto.parentId === id) {
      throw new BusinessException(
        'KNOWLEDGE_CATEGORY_PARENT_INVALID',
        '父分类不能是自身',
        400,
      );
    }
    if (dto.parentId) {
      await this.requireCategory(dto.parentId);
      const wouldCycle = await this.isDescendant(dto.parentId, id);
      if (wouldCycle) {
        throw new BusinessException(
          'KNOWLEDGE_CATEGORY_PARENT_CYCLE',
          '不能将分类移动到其子节点下',
          400,
        );
      }
    }
    const row = await this.prisma.knowledgeCategory.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId } : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'knowledge_category',
      resourceId: id,
    });
    return row;
  }

  async removeCategory(id: string, actorId: string) {
    await this.requireCategory(id);
    const childCount = await this.prisma.knowledgeCategory.count({
      where: { parentId: id, deletedAt: null },
    });
    if (childCount > 0) {
      throw new BusinessException(
        'KNOWLEDGE_CATEGORY_HAS_CHILDREN',
        '请先删除或移动子分类',
        400,
      );
    }
    const itemCount = await this.prisma.knowledgeItem.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (itemCount > 0) {
      throw new BusinessException(
        'KNOWLEDGE_CATEGORY_IN_USE',
        '分类下仍有知识条目，无法删除',
        400,
      );
    }
    await this.prisma.knowledgeCategory.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'knowledge_category',
      resourceId: id,
    });
    return { ok: true };
  }

  async categoryTree(): Promise<KnowledgeCategoryTreeDto[]> {
    const rows = await this.prisma.knowledgeCategory.findMany({
      where: { deletedAt: null },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
    const map = new Map<string, KnowledgeCategoryTreeDto>();
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        code: row.code,
        parentId: row.parentId,
        sort: row.sort,
        status: row.status,
        description: row.description,
        children: [],
      });
    }
    const roots: KnowledgeCategoryTreeDto[] = [];
    for (const node of map.values()) {
      if (node.parentId && map.has(node.parentId)) {
        map.get(node.parentId)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  async createTag(dto: CreateKnowledgeTagDto, actorId: string) {
    const exists = await this.prisma.knowledgeTag.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException(
        'KNOWLEDGE_TAG_CODE_EXISTS',
        '标签编码已存在',
        409,
      );
    }
    const row = await this.prisma.knowledgeTag.create({
      data: {
        name: dto.name,
        code: dto.code,
        status: dto.status ?? CommonStatus.active,
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'knowledge_tag',
      resourceId: row.id,
    });
    return row;
  }

  /**
   * 按名称解析标签；不存在则自动创建（用户端逗号分隔标签输入）。
   */
  async ensureTagsByNames(
    names: string[],
    actorId: string | null,
  ): Promise<string[]> {
    const cleaned = [
      ...new Set(
        names
          .map((n) => n.trim())
          .filter((n) => n.length > 0)
          .map((n) => n.slice(0, 64)),
      ),
    ];
    if (!cleaned.length) return [];

    const existing = await this.prisma.knowledgeTag.findMany({
      where: {
        deletedAt: null,
        name: { in: cleaned, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    const byLower = new Map(
      existing.map((t) => [t.name.toLowerCase(), t.id] as const),
    );
    const ids: string[] = [];
    for (const name of cleaned) {
      const hit = byLower.get(name.toLowerCase());
      if (hit) {
        ids.push(hit);
        continue;
      }
      const codeBase = name
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
      const code = `user-tag-${codeBase || 'tag'}-${Date.now().toString(36)}`.slice(
        0,
        128,
      );
      const created = await this.prisma.knowledgeTag.create({
        data: {
          name,
          code,
          status: CommonStatus.active,
        },
      });
      await this.audit.write({
        actorId,
        action: 'create',
        resourceType: 'knowledge_tag',
        resourceId: created.id,
        detail: { auto: true, from: 'user_deposit' },
      });
      byLower.set(name.toLowerCase(), created.id);
      ids.push(created.id);
    }
    return ids;
  }

  async updateTag(id: string, dto: UpdateKnowledgeTagDto, actorId: string) {
    await this.requireTag(id);
    const row = await this.prisma.knowledgeTag.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'knowledge_tag',
      resourceId: id,
    });
    return row;
  }

  async removeTag(id: string, actorId: string) {
    await this.requireTag(id);
    await this.prisma.knowledgeItemTag.deleteMany({ where: { tagId: id } });
    await this.prisma.knowledgeTag.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'knowledge_tag',
      resourceId: id,
    });
    return { ok: true };
  }

  async pageTags(query: KnowledgeTagPageQueryDto) {
    const where: Prisma.KnowledgeTagWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.knowledgeTag.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.knowledgeTag.count({ where }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  async requireCategory(id: string) {
    const row = await this.prisma.knowledgeCategory.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(
        'KNOWLEDGE_CATEGORY_NOT_FOUND',
        '分类不存在',
        404,
      );
    }
    return row;
  }

  async requireTag(id: string) {
    const row = await this.prisma.knowledgeTag.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException('KNOWLEDGE_TAG_NOT_FOUND', '标签不存在', 404);
    }
    return row;
  }

  private async isDescendant(
    candidateId: string,
    ancestorId: string,
  ): Promise<boolean> {
    let currentId: string | null = candidateId;
    const guard = new Set<string>();
    while (currentId) {
      if (currentId === ancestorId) return true;
      if (guard.has(currentId)) break;
      guard.add(currentId);
      const parent: { parentId: string | null } | null =
        await this.prisma.knowledgeCategory.findFirst({
          where: { id: currentId, deletedAt: null },
          select: { parentId: true },
        });
      currentId = parent?.parentId ?? null;
    }
    return false;
  }
}
