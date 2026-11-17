import { Injectable } from '@nestjs/common';
import {
  CommonStatus,
  IndicatorSourceMapping,
  IndicatorSourceTransform,
  Prisma,
} from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SYSTEM_DICT_CODES } from '../dictionary/dictionary-type.constants';
import {
  CreateIndicatorSourceMappingDto,
  UpdateIndicatorSourceMappingDto,
} from './dto/indicator-source-mapping.dto';
import {
  CreateIndicatorDto,
  IndicatorPageQueryDto,
  UpdateIndicatorDto,
} from './dto/indicator.dto';

const indicatorDetailInclude = {
  _count: {
    select: {
      sourceMappings: { where: { deletedAt: null } },
    },
  },
  sourceMappings: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.IndicatorInclude;

/**
 * 标准指标库应用服务。
 */
@Injectable()
export class IndicatorService {
  /**
   * @param prisma Prisma
   * @param audit 审计
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
  ) {}

  /**
   * 创建指标。
   */
  async create(dto: CreateIndicatorDto, actorId: string) {
    const exists = await this.prisma.indicator.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException('INDICATOR_CODE_EXISTS', '指标编码已存在', 409);
    }
    await this.requireCategory(dto.category);
    const row = await this.prisma.indicator.create({
      data: {
        ...dto,
        status: dto.status ?? CommonStatus.active,
      },
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'indicator',
      resourceId: row.id,
    });
    return this.toView(row);
  }

  /**
   * 更新指标。
   */
  async update(id: string, dto: UpdateIndicatorDto, actorId: string) {
    await this.requireOne(id);
    if (dto.category) {
      await this.requireCategory(dto.category);
    }
    const row = await this.prisma.indicator.update({
      where: { id },
      data: dto,
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'indicator',
      resourceId: id,
    });
    return this.toView(row);
  }

  /**
   * 软删除。
   */
  async remove(id: string, actorId: string) {
    return this.batchRemove([id], actorId);
  }

  /**
   * 批量软删除指标。
   */
  async batchRemove(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BusinessException(
        'INDICATOR_IDS_REQUIRED',
        '请选择要删除的指标',
      );
    }
    const rows = await this.prisma.indicator.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true },
    });
    if (rows.length === 0) {
      throw new BusinessException('INDICATOR_NOT_FOUND', '指标不存在', 404);
    }
    const deletableIds = rows.map((row) => row.id);
    await this.prisma.indicator.updateMany({
      where: { id: { in: deletableIds } },
      data: { deletedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'indicator',
      resourceId: deletableIds.join(','),
      detail: { deleted: deletableIds.length, ids: deletableIds },
    });
    return { ok: true, deleted: deletableIds.length };
  }

  /**
   * 详情（含来源映射列表）。
   */
  async detail(id: string) {
    const row = await this.prisma.indicator.findFirst({
      where: { id, deletedAt: null },
      include: indicatorDetailInclude,
    });
    if (!row) {
      throw new BusinessException('INDICATOR_NOT_FOUND', '指标不存在', 404);
    }
    return this.toView(row);
  }

  /**
   * 分页。
   */
  async page(query: IndicatorPageQueryDto) {
    const where: Prisma.IndicatorWhereInput = {
      deletedAt: null,
      ...(query.category ? { category: query.category } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { definition: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.indicator.findMany({
        where,
        skip,
        take,
        orderBy: { updatedAt: 'desc' },
        include: {
          _count: {
            select: {
              sourceMappings: { where: { deletedAt: null } },
            },
          },
        },
      }),
      this.prisma.indicator.count({ where }),
    ]);
    return new PageResultDto(
      items.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * 列出指标的来源映射。
   */
  async listSourceMappings(indicatorId: string) {
    await this.requireOne(indicatorId);
    const rows = await this.prisma.indicatorSourceMapping.findMany({
      where: { indicatorId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toMappingView(row));
  }

  /**
   * 新增来源映射。
   */
  async createSourceMapping(
    indicatorId: string,
    dto: CreateIndicatorSourceMappingDto,
    actorId: string,
  ) {
    await this.requireOne(indicatorId);
    const dataSource = dto.dataSource.trim();
    const sourceField = dto.sourceField.trim();
    const duplicate = await this.prisma.indicatorSourceMapping.findFirst({
      where: {
        indicatorId,
        dataSource,
        sourceField,
        deletedAt: null,
      },
    });
    if (duplicate) {
      throw new BusinessException(
        'INDICATOR_MAPPING_EXISTS',
        '该数据源与来源字段映射已存在',
        409,
      );
    }
    const restored = await this.prisma.indicatorSourceMapping.findFirst({
      where: {
        indicatorId,
        dataSource,
        sourceField,
        deletedAt: { not: null },
      },
    });
    const row = restored
      ? await this.prisma.indicatorSourceMapping.update({
          where: { id: restored.id },
          data: {
            deletedAt: null,
            transform: dto.transform ?? IndicatorSourceTransform.direct,
            status: dto.status ?? CommonStatus.active,
          },
        })
      : await this.prisma.indicatorSourceMapping.create({
          data: {
            indicatorId,
            dataSource,
            sourceField,
            transform: dto.transform ?? IndicatorSourceTransform.direct,
            status: dto.status ?? CommonStatus.active,
          },
        });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'indicator_source_mapping',
      resourceId: row.id,
      detail: { indicatorId },
    });
    return this.toMappingView(row);
  }

  /**
   * 更新来源映射。
   */
  async updateSourceMapping(
    indicatorId: string,
    mappingId: string,
    dto: UpdateIndicatorSourceMappingDto,
    actorId: string,
  ) {
    const existing = await this.requireMapping(indicatorId, mappingId);
    const dataSource = dto.dataSource?.trim() ?? existing.dataSource;
    const sourceField = dto.sourceField?.trim() ?? existing.sourceField;
    if (dto.dataSource !== undefined || dto.sourceField !== undefined) {
      const duplicate = await this.prisma.indicatorSourceMapping.findFirst({
        where: {
          indicatorId,
          dataSource,
          sourceField,
          deletedAt: null,
          id: { not: mappingId },
        },
      });
      if (duplicate) {
        throw new BusinessException(
          'INDICATOR_MAPPING_EXISTS',
          '该数据源与来源字段映射已存在',
          409,
        );
      }
    }
    const row = await this.prisma.indicatorSourceMapping.update({
      where: { id: mappingId },
      data: {
        ...(dto.dataSource !== undefined ? { dataSource } : {}),
        ...(dto.sourceField !== undefined ? { sourceField } : {}),
        ...(dto.transform !== undefined ? { transform: dto.transform } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'indicator_source_mapping',
      resourceId: mappingId,
      detail: { indicatorId },
    });
    return this.toMappingView(row);
  }

  /**
   * 移除来源映射。
   */
  async removeSourceMapping(
    indicatorId: string,
    mappingId: string,
    actorId: string,
  ) {
    await this.requireMapping(indicatorId, mappingId);
    await this.prisma.indicatorSourceMapping.update({
      where: { id: mappingId },
      data: { deletedAt: new Date() },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'indicator_source_mapping',
      resourceId: mappingId,
      detail: { indicatorId },
    });
  }

  private async requireOne(id: string) {
    const row = await this.prisma.indicator.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException('INDICATOR_NOT_FOUND', '指标不存在', 404);
    }
    return row;
  }

  /**
   * 校验分类必须来自字典「指标分类」。
   */
  private async requireCategory(categoryName: string) {
    const row = await this.prisma.dictionaryItem.findFirst({
      where: {
        type: SYSTEM_DICT_CODES.indicator_category,
        name: categoryName,
        status: CommonStatus.active,
        deletedAt: null,
      },
    });
    if (!row) {
      throw new BusinessException(
        'INDICATOR_CATEGORY_INVALID',
        '指标分类不存在，请先在字典管理中维护「指标分类」',
        400,
      );
    }
    return row;
  }

  private async requireMapping(indicatorId: string, mappingId: string) {
    const row = await this.prisma.indicatorSourceMapping.findFirst({
      where: { id: mappingId, indicatorId, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(
        'INDICATOR_MAPPING_NOT_FOUND',
        '来源映射不存在',
        404,
      );
    }
    return row;
  }

  private toMappingView(row: IndicatorSourceMapping) {
    return {
      id: row.id,
      indicatorId: row.indicatorId,
      dataSource: row.dataSource,
      sourceField: row.sourceField,
      transform: row.transform,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toView(row: {
    id: string;
    name: string;
    code: string;
    definition: string;
    unit: string;
    category: string;
    source: string;
    status: CommonStatus;
    createdAt: Date;
    updatedAt: Date;
    _count?: { sourceMappings: number };
    sourceMappings?: IndicatorSourceMapping[];
  }) {
    const sourceMappings = row.sourceMappings?.map((item) =>
      this.toMappingView(item),
    );

    return {
      id: row.id,
      name: row.name,
      code: row.code,
      definition: row.definition,
      unit: row.unit,
      category: row.category,
      source: row.source,
      status: row.status,
      mappingCount: row._count?.sourceMappings ?? sourceMappings?.length ?? 0,
      sourceMappings,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
