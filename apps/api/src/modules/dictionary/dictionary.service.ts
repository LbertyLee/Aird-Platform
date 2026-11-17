import { Injectable } from '@nestjs/common';
import { CommonStatus, Prisma, VectorSyncStatus } from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { EmbeddingService } from '../../infrastructure/ai/embedding.service';
import {
  COL_DICTIONARIES,
  MilvusService,
} from '../../infrastructure/milvus/milvus.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { VectorSyncProducer } from '../vector-sync/vector-sync.producer';
import { SYSTEM_DICT_CODES } from './dictionary-type.constants';
import {
  DEFAULT_PRIVACY_POLICY_HTML,
  DEFAULT_USER_AGREEMENT_HTML,
} from './legal-document-defaults';
import {
  CreateDictionaryDto,
  CreateDictionaryTypeDto,
  DictionaryPageQueryDto,
  DictionarySearchDto,
  DictionaryTypeQueryDto,
  UpdateDictionaryDto,
  UpdateDictionaryTypeDto,
} from './dto/dictionary.dto';

/**
 * 基础字典库应用服务。
 */
@Injectable()
export class DictionaryService {
  /**
   * @param prisma Prisma
   * @param audit 审计
   * @param vectorSync 向量同步
   * @param embedding Embedding
   * @param milvus Milvus
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly vectorSync: VectorSyncProducer,
    private readonly embedding: EmbeddingService,
    private readonly milvus: MilvusService,
  ) {}

  /** 字典类型列表 */
  async listTypes(query: DictionaryTypeQueryDto = {}) {
    return this.prisma.dictionaryType.findMany({
      where: {
        deletedAt: null,
        ...(query.activeOnly ? { status: CommonStatus.active } : {}),
      },
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Return only the agreement fields required by the public registration page. */
  async publicLegalDocuments() {
    const rows = await this.prisma.dictionaryItem.findMany({
      where: {
        type: SYSTEM_DICT_CODES.legal_documents,
        status: CommonStatus.active,
        deletedAt: null,
      },
      select: { code: true, name: true },
    });
    const values = Object.fromEntries(rows.map(({ code, name }) => [code, name]));
    return {
      userAgreement: {
        content:
          values.user_agreement_content ?? DEFAULT_USER_AGREEMENT_HTML,
        version: values.user_agreement_version || 'V1.0',
        updatedAt: values.user_agreement_updated_at || '2026-10-26',
        effectiveAt: values.user_agreement_effective_at || '2026-10-26',
      },
      privacyPolicy: {
        content:
          values.privacy_policy_content ?? DEFAULT_PRIVACY_POLICY_HTML,
        version: values.privacy_policy_version || 'V1.0',
        updatedAt: values.privacy_policy_updated_at || '2026-10-26',
        effectiveAt: values.privacy_policy_effective_at || '2026-10-26',
      },
    };
  }

  /** 创建字典类型 */
  async createType(dto: CreateDictionaryTypeDto, actorId: string) {
    const code = dto.code.trim();
    const exists = await this.prisma.dictionaryType.findFirst({
      where: { code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException('DICT_TYPE_EXISTS', '字典类型编码已存在', 409);
    }
    const row = await this.prisma.dictionaryType.create({
      data: {
        code,
        name: dto.name.trim(),
        description: dto.description,
        sort: dto.sort ?? 0,
        status: dto.status ?? CommonStatus.active,
        isSystem: false,
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'dictionary_type',
      resourceId: row.id,
      detail: { code: row.code },
    });
    return row;
  }

  /** 更新字典类型 */
  async updateType(id: string, dto: UpdateDictionaryTypeDto, actorId: string) {
    const current = await this.requireType(id);
    if (dto.code && dto.code !== current.code) {
      if (current.isSystem) {
        throw new BusinessException(
          'DICT_TYPE_SYSTEM_LOCKED',
          '系统内置类型禁止修改编码',
          400,
        );
      }
      const conflict = await this.prisma.dictionaryType.findFirst({
        where: { code: dto.code, deletedAt: null, NOT: { id } },
      });
      if (conflict) {
        throw new BusinessException(
          'DICT_TYPE_EXISTS',
          '字典类型编码已存在',
          409,
        );
      }
      const itemCount = await this.prisma.dictionaryItem.count({
        where: { type: current.code, deletedAt: null },
      });
      if (itemCount > 0) {
        throw new BusinessException(
          'DICT_TYPE_HAS_ITEMS',
          '该类型下仍有字典项，禁止修改编码',
          409,
        );
      }
    }

    const row = await this.prisma.dictionaryType.update({
      where: { id },
      data: {
        ...(dto.code && !current.isSystem ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.sort !== undefined ? { sort: dto.sort } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'dictionary_type',
      resourceId: id,
    });
    return row;
  }

  /** 删除字典类型（软删） */
  async removeType(id: string, actorId: string) {
    const current = await this.requireType(id);
    if (current.isSystem) {
      throw new BusinessException(
        'DICT_TYPE_SYSTEM_LOCKED',
        '系统内置类型禁止删除',
        400,
      );
    }
    const itemCount = await this.prisma.dictionaryItem.count({
      where: { type: current.code, deletedAt: null },
    });
    if (itemCount > 0) {
      throw new BusinessException(
        'DICT_TYPE_HAS_ITEMS',
        '该类型下仍有字典项，请先删除或迁移字典项',
        409,
      );
    }
    await this.prisma.dictionaryType.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'dictionary_type',
      resourceId: id,
      detail: { code: current.code },
    });
    return { ok: true };
  }

  async create(dto: CreateDictionaryDto, actorId: string) {
    await this.requireTypeByCode(dto.type);
    const exists = await this.prisma.dictionaryItem.findFirst({
      where: { type: dto.type, code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException('DICT_CODE_EXISTS', '字典编码已存在', 409);
    }
    const row = await this.prisma.dictionaryItem.create({
      data: {
        type: dto.type,
        locationKind: dto.locationKind,
        code: dto.code,
        name: dto.name,
        aliases: dto.aliases ?? [],
        description: dto.description,
        sort: dto.sort ?? 0,
        status: dto.status,
        vectorStatus:
          dto.type === SYSTEM_DICT_CODES.legal_documents
            ? VectorSyncStatus.ready
            : VectorSyncStatus.pending,
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'dictionary',
      resourceId: row.id,
    });
    if (dto.type !== SYSTEM_DICT_CODES.legal_documents) {
      await this.vectorSync.enqueue({
        action: 'upsert',
        entity: 'dictionary',
        id: row.id,
      });
    }
    return row;
  }

  async update(id: string, dto: UpdateDictionaryDto, actorId: string) {
    const current = await this.requireOne(id);
    const row = await this.prisma.dictionaryItem.update({
      where: { id },
      data: {
        ...dto,
        vectorStatus:
          current.type === SYSTEM_DICT_CODES.legal_documents
            ? VectorSyncStatus.ready
            : VectorSyncStatus.pending,
        vectorError: null,
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'dictionary',
      resourceId: id,
    });
    if (row.type !== SYSTEM_DICT_CODES.legal_documents) {
      await this.vectorSync.enqueue({
        action: 'upsert',
        entity: 'dictionary',
        id,
      });
    }
    return row;
  }

  async remove(id: string, actorId: string) {
    return this.batchRemove([id], actorId);
  }

  /**
   * 批量软删除字典项；被数据集或指标引用时禁止删除。
   */
  async batchRemove(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BusinessException('DICT_IDS_REQUIRED', '请选择要删除的字典项');
    }
    const rows = await this.prisma.dictionaryItem.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
    });
    if (rows.length === 0) {
      throw new BusinessException('DICT_NOT_FOUND', '字典项不存在', 404);
    }

    await this.assertNotReferenced(rows);

    const deletableIds = rows.map((row) => row.id);
    await this.prisma.dictionaryItem.updateMany({
      where: { id: { in: deletableIds } },
      data: { deletedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'dictionary',
      resourceId: deletableIds.join(','),
      detail: { deleted: deletableIds.length, ids: deletableIds },
    });
    await Promise.all(
      deletableIds.map((id) =>
        this.vectorSync.enqueue({
          action: 'delete',
          entity: 'dictionary',
          id,
        }),
      ),
    );
    return { ok: true, deleted: deletableIds.length };
  }

  async detail(id: string) {
    return this.requireOne(id);
  }

  async page(query: DictionaryPageQueryDto) {
    const where: Prisma.DictionaryItemWhereInput = {
      deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { description: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.dictionaryItem.findMany({
        where,
        skip,
        take,
        orderBy: [{ sort: 'asc' }, { updatedAt: 'desc' }],
      }),
      this.prisma.dictionaryItem.count({ where }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  async reindex(id: string, actorId: string) {
    await this.requireOne(id);
    await this.prisma.dictionaryItem.update({
      where: { id },
      data: {
        vectorStatus: VectorSyncStatus.pending,
        vectorError: null,
      },
    });
    await this.audit.write({
      actorId,
      action: 'reindex',
      resourceType: 'dictionary',
      resourceId: id,
    });
    await this.vectorSync.enqueue({
      action: 'upsert',
      entity: 'dictionary',
      id,
    });
    return { ok: true };
  }

  async search(dto: DictionarySearchDto) {
    if (!this.embedding.isReady() || !this.milvus.isReady()) {
      throw new BusinessException(
        'VECTOR_UNAVAILABLE',
        '向量检索服务未就绪',
        503,
      );
    }
    const vector = await this.embedding.embed(dto.query);
    const filter = dto.type ? `type == "${dto.type}"` : undefined;
    const hits = await this.milvus.search(
      COL_DICTIONARIES,
      vector,
      dto.topK ?? 10,
      ['id', 'type', 'code', 'name'],
      filter,
    );
    const ids = hits.map((h) => h.id);
    const rows = ids.length
      ? await this.prisma.dictionaryItem.findMany({
          where: { id: { in: ids }, deletedAt: null },
        })
      : [];
    const map = new Map(rows.map((r) => [r.id, r]));
    return hits
      .map((h) => {
        const row = map.get(h.id);
        if (!row) return null;
        return { ...row, score: h.score };
      })
      .filter(Boolean);
  }

  private async requireOne(id: string) {
    const row = await this.prisma.dictionaryItem.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException('DICT_NOT_FOUND', '字典项不存在', 404);
    }
    return row;
  }

  private async requireType(id: string) {
    const row = await this.prisma.dictionaryType.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException('DICT_TYPE_NOT_FOUND', '字典类型不存在', 404);
    }
    return row;
  }

  private async requireTypeByCode(code: string) {
    const row = await this.prisma.dictionaryType.findFirst({
      where: { code, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(
        'DICT_TYPE_NOT_FOUND',
        '字典类型不存在，请先在「维护类型」中创建',
        400,
      );
    }
    if (row.status !== CommonStatus.active) {
      throw new BusinessException(
        'DICT_TYPE_DISABLED',
        '字典类型已停用，无法新增字典项',
        400,
      );
    }
    return row;
  }

  /** 字典项被业务数据引用时禁止删除。 */
  private async assertNotReferenced(
    rows: Array<{ id: string; type: string; name: string; code: string }>,
  ) {
    const ids = rows.map((row) => row.id);
    const datasetLinks = await this.prisma.datasetDictionaryItem.findMany({
      where: { dictionaryItemId: { in: ids } },
      select: { dictionaryItemId: true },
      distinct: ['dictionaryItemId'],
    });
    if (datasetLinks.length > 0) {
      const linked = new Set(datasetLinks.map((l) => l.dictionaryItemId));
      const names = rows
        .filter((row) => linked.has(row.id))
        .map((row) => row.name)
        .slice(0, 5);
      throw new BusinessException(
        'DICT_IN_USE',
        `字典项已被数据集引用，禁止删除：${names.join('、')}${
          names.length < linked.size ? ' 等' : ''
        }。请先解除关联或改为停用。`,
        409,
      );
    }

    const categories = rows.filter(
      (row) => row.type === SYSTEM_DICT_CODES.indicator_category,
    );
    if (categories.length > 0) {
      const categoryNames = categories.map((row) => row.name);
      const used = await this.prisma.indicator.findMany({
        where: {
          deletedAt: null,
          category: { in: categoryNames },
        },
        select: { category: true },
        distinct: ['category'],
      });
      if (used.length > 0) {
        const usedNames = used.map((u) => u.category).slice(0, 5);
        throw new BusinessException(
          'DICT_IN_USE',
          `指标分类已被指标引用，禁止删除：${usedNames.join('、')}${
            usedNames.length < used.length ? ' 等' : ''
          }。请先调整指标分类或改为停用。`,
          409,
        );
      }
    }

    const agentCategories = rows.filter(
      (row) => row.type === SYSTEM_DICT_CODES.agent_category,
    );
    if (agentCategories.length === 0) return;

    const agentCodes = agentCategories.map((row) => row.code);
    const agents = await this.prisma.agent.findMany({
      where: { categoryCode: { in: agentCodes } },
      select: { categoryCode: true },
      distinct: ['categoryCode'],
    });
    if (agents.length > 0) {
      const usedCodes = new Set(agents.map((agent) => agent.categoryCode));
      const usedNames = agentCategories
        .filter((row) => usedCodes.has(row.code))
        .map((row) => row.name)
        .slice(0, 5);
      throw new BusinessException(
        'DICT_IN_USE',
        `智能体分类已被智能体引用，禁止删除：${usedNames.join('、')}${
          usedNames.length < usedCodes.size ? ' 等' : ''
        }。请先调整智能体分类或改为停用。`,
        409,
      );
    }
  }
}
