import { Injectable } from '@nestjs/common';
import { CommonStatus, FieldMappingSource, Prisma } from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { knowledgeStructuredDatasetWhere as kbStructuredDatasetBaseWhere } from '../dataset/dataset-scope';
import {
  CreateIndicatorFieldMappingDto,
  DatasetFieldOptionsQueryDto,
  FieldMappingPageQueryDto,
  UpdateIndicatorFieldMappingDto,
} from './dto/indicator-field-mapping.dto';
import { FieldMappingAutoService } from './field-mapping-auto.service';

const mappingInclude = {
  indicator: {
    select: { id: true, code: true, name: true, unit: true, deletedAt: true },
  },
  datasetField: {
    include: {
      datasetSchema: {
        include: {
          datasetVersion: {
            include: {
              dataset: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  deletedAt: true,
                },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.IndicatorFieldMappingInclude;

type MappingRow = Prisma.IndicatorFieldMappingGetPayload<{
  include: typeof mappingInclude;
}>;

/**
 * 指标 ↔ 数据集字段映射（Semantic Layer）。
 */
@Injectable()
export class IndicatorFieldMappingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly fieldMappingAuto: FieldMappingAutoService,
  ) {}

  async page(query: FieldMappingPageQueryDto) {
    const where: Prisma.IndicatorFieldMappingWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.indicatorId ? { indicatorId: query.indicatorId } : {}),
      ...(query.datasetId
        ? {
            datasetField: {
              datasetSchema: {
                datasetVersion: { datasetId: query.datasetId },
              },
            },
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              {
                indicator: {
                  name: { contains: query.keyword, mode: 'insensitive' },
                },
              },
              {
                indicator: {
                  code: { contains: query.keyword, mode: 'insensitive' },
                },
              },
              {
                datasetField: {
                  fieldName: {
                    contains: query.keyword,
                    mode: 'insensitive',
                  },
                },
              },
              {
                datasetField: {
                  displayName: {
                    contains: query.keyword,
                    mode: 'insensitive',
                  },
                },
              },
            ],
          }
        : {}),
      indicator: { deletedAt: null },
    };
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.indicatorFieldMapping.findMany({
        where,
        skip,
        take,
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
        include: mappingInclude,
      }),
      this.prisma.indicatorFieldMapping.count({ where }),
    ]);
    return new PageResultDto(
      items.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  async detail(id: string) {
    const row = await this.requireOne(id);
    return this.toView(row);
  }

  async create(dto: CreateIndicatorFieldMappingDto, actorId: string) {
    await this.requireIndicator(dto.indicatorId);
    await this.requireDatasetField(dto.datasetFieldId);
    const exists = await this.prisma.indicatorFieldMapping.findFirst({
      where: {
        indicatorId: dto.indicatorId,
        datasetFieldId: dto.datasetFieldId,
      },
    });
    if (exists) {
      throw new BusinessException(
        'FIELD_MAPPING_EXISTS',
        '该指标与字段的映射已存在',
        409,
      );
    }
    const row = await this.prisma.indicatorFieldMapping.create({
      data: {
        indicatorId: dto.indicatorId,
        datasetFieldId: dto.datasetFieldId,
        aggregation: dto.aggregation?.trim() || 'SUM',
        formula: dto.formula?.trim() || null,
        condition: dto.condition?.trim() || null,
        priority: dto.priority ?? 0,
        status: dto.status ?? CommonStatus.active,
        source: FieldMappingSource.manual,
      },
      include: mappingInclude,
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'indicator_field_mapping',
      resourceId: row.id,
    });
    return this.toView(row);
  }

  async update(
    id: string,
    dto: UpdateIndicatorFieldMappingDto,
    actorId: string,
  ) {
    await this.requireOne(id);
    if (dto.indicatorId) await this.requireIndicator(dto.indicatorId);
    if (dto.datasetFieldId) await this.requireDatasetField(dto.datasetFieldId);

    if (dto.indicatorId || dto.datasetFieldId) {
      const current = await this.prisma.indicatorFieldMapping.findUniqueOrThrow(
        { where: { id } },
      );
      const indicatorId = dto.indicatorId ?? current.indicatorId;
      const datasetFieldId = dto.datasetFieldId ?? current.datasetFieldId;
      const dup = await this.prisma.indicatorFieldMapping.findFirst({
        where: {
          indicatorId,
          datasetFieldId,
          NOT: { id },
        },
      });
      if (dup) {
        throw new BusinessException(
          'FIELD_MAPPING_EXISTS',
          '该指标与字段的映射已存在',
          409,
        );
      }
    }

    const row = await this.prisma.indicatorFieldMapping.update({
      where: { id },
      data: {
        ...(dto.indicatorId ? { indicatorId: dto.indicatorId } : {}),
        ...(dto.datasetFieldId ? { datasetFieldId: dto.datasetFieldId } : {}),
        ...(dto.aggregation !== undefined
          ? { aggregation: dto.aggregation.trim() || 'SUM' }
          : {}),
        ...(dto.formula !== undefined
          ? { formula: dto.formula?.trim() || null }
          : {}),
        ...(dto.condition !== undefined
          ? { condition: dto.condition?.trim() || null }
          : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.status ? { status: dto.status } : {}),
        source: FieldMappingSource.manual,
      },
      include: mappingInclude,
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'indicator_field_mapping',
      resourceId: id,
    });
    return this.toView(row);
  }

  async batchRemove(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BusinessException(
        'FIELD_MAPPING_IDS_REQUIRED',
        '请选择要删除的映射',
        400,
      );
    }
    const result = await this.prisma.indicatorFieldMapping.deleteMany({
      where: { id: { in: uniqueIds } },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'indicator_field_mapping',
      resourceId: uniqueIds.join(','),
      detail: { deleted: result.count, ids: uniqueIds },
    });
    return { ok: true, deleted: result.count };
  }

  /**
   * 采纳自动待确认映射：启用并反哺指标别名。
   */
  async acceptPending(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BusinessException(
        'FIELD_MAPPING_IDS_REQUIRED',
        '请选择要采纳的映射',
        400,
      );
    }
    const rows = await this.prisma.indicatorFieldMapping.findMany({
      where: { id: { in: uniqueIds } },
      include: {
        datasetField: {
          select: { fieldName: true, displayName: true },
        },
      },
    });
    if (!rows.length) {
      throw new BusinessException(
        'FIELD_MAPPING_NOT_FOUND',
        '字段映射不存在',
        404,
      );
    }

    let accepted = 0;
    let aliasesAdded = 0;
    for (const row of rows) {
      await this.prisma.indicatorFieldMapping.update({
        where: { id: row.id },
        data: {
          status: CommonStatus.active,
          source: FieldMappingSource.auto,
        },
      });
      accepted += 1;

      const aliasCandidates = [
        row.datasetField.displayName?.trim(),
        row.datasetField.fieldName.trim(),
        row.matchTerm?.trim(),
      ].filter((v): v is string => Boolean(v && v.length >= 2));

      for (const alias of [...new Set(aliasCandidates)]) {
        const exists = await this.prisma.indicatorAlias.findFirst({
          where: { indicatorId: row.indicatorId, alias },
          select: { id: true },
        });
        if (exists) continue;
        await this.prisma.indicatorAlias.create({
          data: {
            indicatorId: row.indicatorId,
            alias: alias.slice(0, 256),
            aliasType: 'field_mapping',
            confidence: row.confidence ?? 0.8,
          },
        });
        aliasesAdded += 1;
      }
    }

    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'indicator_field_mapping',
      resourceId: uniqueIds.join(','),
      detail: { action: 'accept', accepted, aliasesAdded, ids: uniqueIds },
    });
    return { ok: true, accepted, aliasesAdded };
  }

  /**
   * 忽略自动待确认映射：删除建议，避免反复打扰。
   */
  async dismissPending(ids: string[], actorId: string) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (!uniqueIds.length) {
      throw new BusinessException(
        'FIELD_MAPPING_IDS_REQUIRED',
        '请选择要忽略的映射',
        400,
      );
    }
    const result = await this.prisma.indicatorFieldMapping.deleteMany({
      where: {
        id: { in: uniqueIds },
        source: {
          in: [FieldMappingSource.auto_pending, FieldMappingSource.auto],
        },
      },
    });
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'indicator_field_mapping',
      resourceId: uniqueIds.join(','),
      detail: { action: 'dismiss', deleted: result.count, ids: uniqueIds },
    });
    return { ok: true, deleted: result.count };
  }

  /** 对知识库结构化 READY 文件重跑自动字段映射 */
  async reapplyAuto(datasetId: string | undefined, actorId: string) {
    const result = await this.fieldMappingAuto.reapply(datasetId);
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'indicator_field_mapping',
      resourceId: datasetId ?? 'all_kb_structured',
      detail: {
        action: 'reapply_auto',
        datasets: result.datasets,
        summary: result.results.reduce(
          (acc, row) => ({
            created: acc.created + row.created,
            updated: acc.updated + row.updated,
            active: acc.active + row.active,
            pending: acc.pending + row.pending,
          }),
          { created: 0, updated: 0, active: 0, pending: 0 },
        ),
      },
    });
    return result;
  }

  /**
   * 列出知识库结构化接入后的 READY 文件（供筛选下拉）。
   * 排除「来源管理」中的外部数据源目录。
   */
  async listDatasetOptions(keyword?: string) {
    const rows = await this.prisma.dataset.findMany({
      where: {
        deletedAt: null,
        ...this.knowledgeStructuredDatasetWhere(keyword),
        versions: {
          some: {
            isCurrent: true,
            status: 'ready',
            schema: { isNot: null },
          },
        },
      },
      take: 200,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        code: true,
        name: true,
        fileName: true,
        versions: {
          where: { isCurrent: true },
          take: 1,
          select: { version: true, status: true },
        },
      },
    });
    return rows.map((row) => {
      const version = row.versions[0]?.version ?? 1;
      const fileHint = row.fileName ? ` · ${row.fileName}` : '';
      return {
        id: row.id,
        code: row.code,
        name: row.name,
        fileName: row.fileName,
        version,
        label: `${row.name}${fileHint} (v${version})`,
      };
    });
  }

  /**
   * 列出知识库结构化 READY 版本下的字段，供下拉选择。
   */
  async listFieldOptions(query: DatasetFieldOptionsQueryDto) {
    const where: Prisma.DatasetFieldWhereInput = {
      datasetSchema: {
        datasetVersion: {
          isCurrent: true,
          status: 'ready',
          ...(query.datasetId ? { datasetId: query.datasetId } : {}),
          dataset: {
            deletedAt: null,
            ...this.knowledgeStructuredDatasetWhere(),
          },
        },
      },
      ...(query.keyword
        ? {
            OR: [
              {
                fieldName: {
                  contains: query.keyword,
                  mode: 'insensitive' as const,
                },
              },
              {
                displayName: {
                  contains: query.keyword,
                  mode: 'insensitive' as const,
                },
              },
            ],
          }
        : {}),
    };
    const rows = await this.prisma.datasetField.findMany({
      where,
      take: 200,
      orderBy: [{ ordinal: 'asc' }, { fieldName: 'asc' }],
      include: {
        datasetSchema: {
          include: {
            datasetVersion: {
              include: {
                dataset: {
                  select: { id: true, code: true, name: true, fileName: true },
                },
              },
            },
          },
        },
      },
    });
    return rows.map((row) => {
      const version = row.datasetSchema.datasetVersion;
      const dataset = version.dataset;
      const fieldLabel = row.displayName || row.fieldName;
      return {
        id: row.id,
        fieldName: row.fieldName,
        displayName: row.displayName,
        dataType: row.dataType,
        semanticType: row.semanticType,
        datasetId: dataset.id,
        datasetCode: dataset.code,
        datasetName: dataset.name,
        datasetVersionId: version.id,
        version: version.version,
        label: `${dataset.name} / v${version.version} / ${fieldLabel} (${row.dataType})`,
      };
    });
  }

  /**
   * 知识库结构化接入生成的内部 Dataset（code 以 kb_ 开头）。
   */
  private knowledgeStructuredDatasetWhere(
    keyword?: string,
  ): Prisma.DatasetWhereInput {
    const base = kbStructuredDatasetBaseWhere();
    const trimmed = keyword?.trim();
    if (!trimmed) return base;
    return {
      AND: [
        base,
        {
          OR: [
            { name: { contains: trimmed, mode: 'insensitive' } },
            { code: { contains: trimmed, mode: 'insensitive' } },
            { fileName: { contains: trimmed, mode: 'insensitive' } },
          ],
        },
      ],
    };
  }

  private async requireOne(id: string) {
    const row = await this.prisma.indicatorFieldMapping.findFirst({
      where: { id, indicator: { deletedAt: null } },
      include: mappingInclude,
    });
    if (!row) {
      throw new BusinessException(
        'FIELD_MAPPING_NOT_FOUND',
        '字段映射不存在',
        404,
      );
    }
    return row;
  }

  private async requireIndicator(id: string) {
    const row = await this.prisma.indicator.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!row) {
      throw new BusinessException('INDICATOR_NOT_FOUND', '指标不存在', 404);
    }
  }

  private async requireDatasetField(id: string) {
    const row = await this.prisma.datasetField.findFirst({
      where: { id },
      select: { id: true },
    });
    if (!row) {
      throw new BusinessException(
        'DATASET_FIELD_NOT_FOUND',
        '数据集字段不存在',
        404,
      );
    }
  }

  private toView(row: MappingRow) {
    const dataset = row.datasetField.datasetSchema.datasetVersion.dataset;
    return {
      id: row.id,
      indicatorId: row.indicatorId,
      datasetFieldId: row.datasetFieldId,
      aggregation: row.aggregation,
      formula: row.formula,
      condition: row.condition,
      priority: row.priority,
      status: row.status,
      source: row.source,
      confidence: row.confidence,
      matchTerm: row.matchTerm,
      indicator: {
        id: row.indicator.id,
        code: row.indicator.code,
        name: row.indicator.name,
        unit: row.indicator.unit,
      },
      datasetField: {
        id: row.datasetField.id,
        fieldName: row.datasetField.fieldName,
        displayName: row.datasetField.displayName,
        dataType: row.datasetField.dataType,
        semanticType: row.datasetField.semanticType,
        dataset: {
          id: dataset.id,
          code: dataset.code,
          name: dataset.name,
        },
      },
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
