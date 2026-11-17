import { Injectable, Logger } from '@nestjs/common';
import {
  CommonStatus,
  DatasetPublishStatus,
  DatasetLinkSource,
  DatasetLinkTargetType,
  DatasetVisibility,
  Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { MinioService } from '../../infrastructure/minio/minio.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SYSTEM_DICT_CODES } from '../dictionary/dictionary-type.constants';
import { DatasetAutoLinkService } from './dataset-auto-link.service';
import {
  CreateDatasetDto,
  DatasetPageQueryDto,
  UpdateDatasetDto,
} from './dto/dataset.dto';
import {
  buildDatasetFilePreview,
  getDatasetContentType,
  normalizeUploadedFileName,
  validateDatasetFile,
} from './dataset-file-preview';
import { externalSourceDatasetWhere } from './dataset-scope';
import { externalSearchDomain } from '../../common/utils/external-search-domain';

const datasetInclude = {
  creator: {
    select: {
      id: true,
      username: true,
      profile: { select: { displayName: true } },
    },
  },
  indicators: {
    include: {
      indicator: {
        select: { id: true, name: true, code: true, category: true },
      },
    },
  },
  dictionaries: {
    include: {
      dictionaryItem: {
        select: { id: true, type: true, code: true, name: true },
      },
    },
  },
} satisfies Prisma.DatasetInclude;

type DatasetWithRelations = Prisma.DatasetGetPayload<{
  include: typeof datasetInclude;
}>;

/**
 * 数据资产管理服务。
 */
@Injectable()
export class DatasetService {
  private readonly logger = new Logger(DatasetService.name);

  /**
   * @param prisma Prisma
   * @param audit 审计
   * @param minio MinIO
   * @param autoLink 自动关联
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly minio: MinioService,
    private readonly autoLink: DatasetAutoLinkService,
  ) {}

  /**
   * 研究工作台的公共上传入口：文件直接进入数据集对象存储。
   * 不绑定登录用户，避免公共研究上传因缺少管理端身份而无法入库。
   */
  async ingestPublicFile(file: Express.Multer.File) {
    file.originalname = normalizeUploadedFileName(file.originalname);
    validateDatasetFile(file);
    const dataset = await this.create(
      {
        name: file.originalname,
        code: `research-${randomUUID()}`,
        description: '用户通过研究工作台上传的知识资料',
        visibility: DatasetVisibility.public,
      },
      null,
    );

    try {
      await this.upload(dataset.id, file, null);
      return this.publish(dataset.id, null);
    } catch (error) {
      try {
        await this.remove(dataset.id, null);
      } catch {
        this.logger.warn(`public dataset cleanup failed datasetId=${dataset.id}`);
      }
      throw error;
    }
  }

  async create(dto: CreateDatasetDto, actorId: string | null) {
    if (dto.categoryCode) {
      await this.requireSourceCategory(dto.categoryCode);
    }
    const code = (dto.code?.trim() || (await this.nextSourceCode())).trim();
    const exists = await this.prisma.dataset.findFirst({
      where: { code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException(
        'DATASET_CODE_EXISTS',
        '来源编码已存在',
        409,
      );
    }
    const status = dto.status ?? CommonStatus.active;
    const visibility =
      dto.visibility ??
      (status === CommonStatus.active
        ? DatasetVisibility.public
        : DatasetVisibility.private);
    const publishStatus =
      status === CommonStatus.active
        ? DatasetPublishStatus.published
        : DatasetPublishStatus.unpublished;

    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.dataset.create({
        data: {
          name: dto.name,
          nameEn: dto.nameEn,
          code,
          categoryCode: dto.categoryCode,
          regionLevel: dto.regionLevel,
          websiteUrl: dto.websiteUrl,
          remark: dto.remark,
          status,
          description: dto.description ?? dto.remark,
          visibility,
          createdBy: actorId,
          publishStatus,
        },
      });
      await this.replaceLinks(
        tx,
        created.id,
        dto.indicatorIds,
        dto.dictionaryItemIds,
      );
      return tx.dataset.findFirstOrThrow({
        where: { id: created.id },
        include: datasetInclude,
      });
    });
    await this.audit.write({
      actorId,
      action: 'create',
      resourceType: 'dataset',
      resourceId: row.id,
    });
    return this.toView(row);
  }

  async update(id: string, dto: UpdateDatasetDto, actorId: string) {
    await this.requireOne(id);
    if (dto.categoryCode) {
      await this.requireSourceCategory(dto.categoryCode);
    }
    const statusPatch =
      dto.status === undefined
        ? {}
        : {
            status: dto.status,
            publishStatus:
              dto.status === CommonStatus.active
                ? DatasetPublishStatus.published
                : DatasetPublishStatus.unpublished,
            visibility:
              dto.visibility ??
              (dto.status === CommonStatus.active
                ? DatasetVisibility.public
                : DatasetVisibility.private),
          };
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.dataset.update({
        where: { id },
        data: {
          name: dto.name,
          nameEn: dto.nameEn,
          categoryCode: dto.categoryCode,
          regionLevel: dto.regionLevel,
          websiteUrl: dto.websiteUrl,
          remark: dto.remark,
          description: dto.description,
          visibility: dto.visibility,
          ...statusPatch,
        },
      });
      if (dto.indicatorIds !== undefined || dto.dictionaryItemIds !== undefined) {
        await this.replaceLinks(
          tx,
          id,
          dto.indicatorIds,
          dto.dictionaryItemIds,
        );
      }
      return tx.dataset.findFirstOrThrow({
        where: { id },
        include: datasetInclude,
      });
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'dataset',
      resourceId: id,
    });
    return this.toView(row);
  }

  async remove(id: string, actorId: string | null) {
    return this.batchRemove([id], actorId);
  }

  /**
   * 批量软删除来源；清理关联，并尝试删除对象存储文件。
   */
  async batchRemove(ids: string[], actorId: string | null) {
    const uniqueIds = [...new Set(ids.filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new BusinessException('DATASET_IDS_REQUIRED', '请选择要删除的来源');
    }
    const rows = await this.prisma.dataset.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, fileKey: true },
    });
    if (rows.length === 0) {
      throw new BusinessException('DATASET_NOT_FOUND', '来源不存在', 404);
    }
    const deletableIds = rows.map((row) => row.id);
    await this.prisma.$transaction([
      this.prisma.datasetIndicator.deleteMany({
        where: { datasetId: { in: deletableIds } },
      }),
      this.prisma.datasetDictionaryItem.deleteMany({
        where: { datasetId: { in: deletableIds } },
      }),
      this.prisma.datasetLinkDismissal.deleteMany({
        where: { datasetId: { in: deletableIds } },
      }),
      this.prisma.dataset.updateMany({
        where: { id: { in: deletableIds } },
        data: { deletedAt: new Date() },
      }),
    ]);
    await Promise.all(
      rows.map(async (row) => {
        if (row.fileKey) {
          try {
            await this.minio.deleteObject(row.fileKey);
          } catch {
            // ignore storage cleanup failure
          }
        }
      }),
    );
    await this.audit.write({
      actorId,
      action: 'delete',
      resourceType: 'dataset',
      resourceId: deletableIds.join(','),
      detail: { deleted: deletableIds.length, ids: deletableIds },
    });
    return { ok: true, deleted: deletableIds.length };
  }

  async detail(id: string) {
    return this.toView(await this.requireOne(id));
  }

  async preview(id: string) {
    const row = await this.requireFile(id);
    const fileName = normalizeUploadedFileName(row.fileName);
    if (extname(fileName).toLowerCase() === '.pdf') {
      return {
        kind: 'pdf' as const,
        fileName,
        mimeType: 'application/pdf' as const,
      };
    }
    const buffer = await this.minio.getObject(row.fileKey);
    try {
      return await buildDatasetFilePreview(buffer, fileName);
    } catch (error) {
      if (error instanceof BusinessException) throw error;
      this.logger.warn(`dataset preview failed datasetId=${id}`);
      throw new BusinessException(
        'DATASET_PREVIEW_FAILED',
        '文件解析失败，请检查文件内容是否完整',
        422,
      );
    }
  }

  async file(id: string) {
    const row = await this.requireFile(id);
    const fileName = normalizeUploadedFileName(row.fileName);
    return {
      buffer: await this.minio.getObject(row.fileKey),
      fileName,
      mimeType: getDatasetContentType(fileName),
    };
  }

  /**
   * 管理端分页：具备 menu:data:dataset 即可查看全部外部来源。
   * 排除知识库结构化接入生成的内部 Dataset（kb_*）。
   */
  async page(query: DatasetPageQueryDto) {
    const where: Prisma.DatasetWhereInput = {
      deletedAt: null,
      ...externalSourceDatasetWhere(),
      ...(query.visibility ? { visibility: query.visibility } : {}),
      ...(query.publishStatus ? { publishStatus: query.publishStatus } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.categoryCode ? { categoryCode: query.categoryCode } : {}),
      ...(query.regionLevel ? { regionLevel: query.regionLevel } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              { nameEn: { contains: query.keyword, mode: 'insensitive' } },
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { regionLevel: { contains: query.keyword, mode: 'insensitive' } },
              { websiteUrl: { contains: query.keyword, mode: 'insensitive' } },
              { description: { contains: query.keyword, mode: 'insensitive' } },
              { remark: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [items, total] = await Promise.all([
      this.prisma.dataset.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { name: 'desc' }],
        include: datasetInclude,
      }),
      this.prisma.dataset.count({ where }),
    ]);
    return new PageResultDto(
      items.map((row) => this.toView(row)),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** 来源管理统计：总数、启用数、分类计数（不含知识库结构化产物） */
  async stats() {
    const base: Prisma.DatasetWhereInput = {
      deletedAt: null,
      ...externalSourceDatasetWhere(),
    };
    const [total, activeCount, grouped] = await Promise.all([
      this.prisma.dataset.count({ where: base }),
      this.prisma.dataset.count({
        where: { ...base, status: CommonStatus.active },
      }),
      this.prisma.dataset.groupBy({
        by: ['categoryCode'],
        where: base,
        _count: { _all: true },
      }),
    ]);
    return {
      total,
      activeCount,
      byCategory: grouped.map((row) => ({
        categoryCode: row.categoryCode ?? '',
        count: row._count._all,
      })),
    };
  }

  async publish(id: string, actorId: string | null) {
    await this.requireOne(id);
    const row = await this.prisma.dataset.update({
      where: { id },
      data: { publishStatus: DatasetPublishStatus.published },
      include: datasetInclude,
    });
    await this.audit.write({
      actorId,
      action: 'publish',
      resourceType: 'dataset',
      resourceId: id,
    });
    return this.toView(row);
  }

  async unpublish(id: string, actorId: string) {
    await this.requireOne(id);
    const row = await this.prisma.dataset.update({
      where: { id },
      data: { publishStatus: DatasetPublishStatus.unpublished },
      include: datasetInclude,
    });
    await this.audit.write({
      actorId,
      action: 'unpublish',
      resourceType: 'dataset',
      resourceId: id,
    });
    return this.toView(row);
  }

  async upload(id: string, file: Express.Multer.File, actorId: string | null) {
    const row = await this.requireOne(id);
    file.originalname = normalizeUploadedFileName(file.originalname);
    validateDatasetFile(file);
    const fileName = file.originalname;
    const ext = extname(fileName).toLowerCase();
    const key = `datasets/${id}/${randomUUID()}${ext}`;
    const contentType = getDatasetContentType(fileName);
    await this.minio.putObject(key, file.buffer, contentType);
    let updated: DatasetWithRelations;
    try {
      updated = await this.prisma.dataset.update({
        where: { id },
        data: {
          fileKey: key,
          fileName,
          mimeType: contentType,
          fileSize: file.size,
          createdBy: row.createdBy ?? actorId,
        },
        include: datasetInclude,
      });
    } catch (error) {
      try {
        await this.minio.deleteObject(key);
      } catch {
        this.logger.warn(`new dataset file cleanup failed datasetId=${id}`);
      }
      throw error;
    }
    if (row.fileKey && row.fileKey !== key) {
      try {
        await this.minio.deleteObject(row.fileKey);
      } catch {
        this.logger.warn(`old dataset file cleanup failed datasetId=${id}`);
      }
    }
    await this.audit.write({
      actorId,
      action: 'upload',
      resourceType: 'dataset',
      resourceId: id,
      detail: { fileName, size: file.size },
    });
    // 来源管理仅作目录配置；结构化接入请走知识库上传。
    return this.toView(updated);
  }

  /**
   * 根据标题/描述/附件正文自动识别并挂载指标、字典关联。
   */
  async autoLinkFromContent(id: string, actorId: string) {
    await this.requireOne(id);
    const result = await this.autoLink.applyAutoLinks(id);
    await this.audit.write({
      actorId,
      action: 'auto_link',
      resourceType: 'dataset',
      resourceId: id,
      detail: result,
    });
    return {
      ...this.toView(await this.requireOne(id)),
      autoLink: result,
    };
  }

  private async replaceLinks(
    tx: Prisma.TransactionClient,
    datasetId: string,
    indicatorIds?: string[],
    dictionaryItemIds?: string[],
  ) {
    if (indicatorIds !== undefined) {
      const unique = [
        ...new Set(indicatorIds.map((id) => id.trim()).filter(Boolean)),
      ];
      if (unique.length) {
        const found = await tx.indicator.findMany({
          where: { id: { in: unique }, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== unique.length) {
          throw new BusinessException(
            'INDICATOR_NOT_FOUND',
            '部分关联指标不存在或已删除',
            404,
          );
        }
      }
      const existing = await tx.datasetIndicator.findMany({
        where: { datasetId },
        select: { indicatorId: true, source: true },
      });
      const existingMap = new Map(
        existing.map((row) => [row.indicatorId, row.source]),
      );
      const selected = new Set(unique);

      for (const row of existing) {
        if (selected.has(row.indicatorId)) continue;
        await tx.datasetIndicator.delete({
          where: {
            datasetId_indicatorId: {
              datasetId,
              indicatorId: row.indicatorId,
            },
          },
        });
        await tx.datasetLinkDismissal.upsert({
          where: {
            datasetId_targetType_targetId: {
              datasetId,
              targetType: DatasetLinkTargetType.indicator,
              targetId: row.indicatorId,
            },
          },
          create: {
            datasetId,
            targetType: DatasetLinkTargetType.indicator,
            targetId: row.indicatorId,
          },
          update: {},
        });
      }

      for (const indicatorId of unique) {
        await tx.datasetLinkDismissal.deleteMany({
          where: {
            datasetId,
            targetType: DatasetLinkTargetType.indicator,
            targetId: indicatorId,
          },
        });
        const prev = existingMap.get(indicatorId);
        if (prev) continue;
        await tx.datasetIndicator.create({
          data: {
            datasetId,
            indicatorId,
            source: DatasetLinkSource.manual,
          },
        });
      }
    }

    if (dictionaryItemIds !== undefined) {
      const unique = [
        ...new Set(dictionaryItemIds.map((id) => id.trim()).filter(Boolean)),
      ];
      if (unique.length) {
        const found = await tx.dictionaryItem.findMany({
          where: { id: { in: unique }, deletedAt: null },
          select: { id: true },
        });
        if (found.length !== unique.length) {
          throw new BusinessException(
            'DICTIONARY_NOT_FOUND',
            '部分关联字典项不存在或已删除',
            404,
          );
        }
      }
      const existing = await tx.datasetDictionaryItem.findMany({
        where: { datasetId },
        select: { dictionaryItemId: true, source: true },
      });
      const existingMap = new Map(
        existing.map((row) => [row.dictionaryItemId, row.source]),
      );
      const selected = new Set(unique);

      for (const row of existing) {
        if (selected.has(row.dictionaryItemId)) continue;
        await tx.datasetDictionaryItem.delete({
          where: {
            datasetId_dictionaryItemId: {
              datasetId,
              dictionaryItemId: row.dictionaryItemId,
            },
          },
        });
        await tx.datasetLinkDismissal.upsert({
          where: {
            datasetId_targetType_targetId: {
              datasetId,
              targetType: DatasetLinkTargetType.dictionary,
              targetId: row.dictionaryItemId,
            },
          },
          create: {
            datasetId,
            targetType: DatasetLinkTargetType.dictionary,
            targetId: row.dictionaryItemId,
          },
          update: {},
        });
      }

      for (const dictionaryItemId of unique) {
        await tx.datasetLinkDismissal.deleteMany({
          where: {
            datasetId,
            targetType: DatasetLinkTargetType.dictionary,
            targetId: dictionaryItemId,
          },
        });
        const prev = existingMap.get(dictionaryItemId);
        if (prev) continue;
        await tx.datasetDictionaryItem.create({
          data: {
            datasetId,
            dictionaryItemId,
            source: DatasetLinkSource.manual,
          },
        });
      }
    }
  }

  private async requireOne(id: string) {
    const row = await this.prisma.dataset.findFirst({
      where: { id, deletedAt: null },
      include: datasetInclude,
    });
    if (!row) {
      throw new BusinessException('DATASET_NOT_FOUND', '来源不存在', 404);
    }
    return row;
  }

  private async requireFile(id: string) {
    const row = await this.requireOne(id);
    if (!row.fileKey || !row.fileName) {
      throw new BusinessException(
        'DATASET_FILE_NOT_FOUND',
        '来源尚未上传文件',
        404,
      );
    }
    return { fileKey: row.fileKey, fileName: row.fileName };
  }

  private async requireSourceCategory(code: string) {
    const row = await this.prisma.dictionaryItem.findFirst({
      where: {
        type: SYSTEM_DICT_CODES.source_category,
        code,
        status: CommonStatus.active,
        deletedAt: null,
      },
    });
    if (!row) {
      throw new BusinessException(
        'SOURCE_CATEGORY_INVALID',
        '来源分类不存在，请先在字典管理中维护「来源分类」',
        400,
      );
    }
    return row;
  }

  private async nextSourceCode() {
    for (let i = 0; i < 8; i += 1) {
      const code = `DS${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
      const exists = await this.prisma.dataset.findFirst({
        where: { code, deletedAt: null },
        select: { id: true },
      });
      if (!exists) return code;
    }
    return `DS${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
  }

  /**
   * 列表/详情统一视图。
   */
  private toView(row: DatasetWithRelations) {
    const { creator, indicators, dictionaries, ...rest } = row;
    const externalSearch = externalSearchDomain(row.websiteUrl);
    return {
      ...rest,
      externalSearchEligible: externalSearch.eligible,
      externalSearchIneligibleReason: externalSearch.reason ?? null,
      fileName: row.fileName
        ? normalizeUploadedFileName(row.fileName)
        : row.fileName,
      uploader: creator
        ? {
            id: creator.id,
            username: creator.username,
            displayName: creator.profile?.displayName ?? null,
          }
        : null,
      indicators: indicators
        .map((link) =>
          link.indicator
            ? {
                id: link.indicator.id,
                name: link.indicator.name,
                code: link.indicator.code,
                category: link.indicator.category,
                source: link.source,
              }
            : null,
        )
        .filter(Boolean),
      dictionaries: dictionaries
        .map((link) =>
          link.dictionaryItem
            ? {
                id: link.dictionaryItem.id,
                type: link.dictionaryItem.type,
                code: link.dictionaryItem.code,
                name: link.dictionaryItem.name,
                source: link.source,
              }
            : null,
        )
        .filter(Boolean),
    };
  }
}
