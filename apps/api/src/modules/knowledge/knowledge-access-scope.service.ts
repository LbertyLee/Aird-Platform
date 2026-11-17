import { Injectable } from '@nestjs/common';
import {
  CommonStatus,
  DatasetPublishStatus,
  DatasetVisibility,
  KnowledgeAuditStatus,
  KnowledgePublishStatus,
  KnowledgeVisibility,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  externalSourceDatasetWhere,
  knowledgeStructuredDatasetWhere,
} from '../dataset/dataset-scope';

/**
 * 用户端知识检索范围：公共知识库 + 本人知识库/条目，排除其他用户私有数据。
 */
@Injectable()
export class KnowledgeAccessScopeService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前用户可检索的知识条目 Prisma 条件 */
  buildAccessibleKnowledgeItemWhere(
    userId: string,
  ): Prisma.KnowledgeItemWhereInput {
    return {
      deletedAt: null,
      OR: [
        {
          library: {
            visibility: KnowledgeVisibility.public,
            status: CommonStatus.active,
            deletedAt: null,
          },
          auditStatus: KnowledgeAuditStatus.approved,
          publishStatus: KnowledgePublishStatus.published,
        },
        {
          library: {
            createdBy: userId,
            deletedAt: null,
          },
        },
        {
          submittedBy: userId,
        },
      ],
    };
  }

  /** 解析用户可访问的知识条目 ID 集合（向量检索后过滤用） */
  async resolveAccessibleKnowledgeIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.knowledgeItem.findMany({
      where: this.buildAccessibleKnowledgeItemWhere(userId),
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /**
   * RAG only accepts approved, published documents.  This is deliberately
   * stricter than library management visibility, so a draft can never be
   * recalled from a stale vector during an asynchronous state transition.
   */
  async resolveRagKnowledgeIds(userId?: string, libraryIds?: string[]): Promise<Set<string>> {
    const base: Prisma.KnowledgeItemWhereInput = {
      deletedAt: null,
      auditStatus: KnowledgeAuditStatus.approved,
      publishStatus: KnowledgePublishStatus.published,
    };
    const where: Prisma.KnowledgeItemWhereInput = userId
      ? { ...base, ...this.buildAccessibleKnowledgeItemWhere(userId) }
      : {
          ...base,
          library: {
            visibility: KnowledgeVisibility.public,
            status: CommonStatus.active,
            deletedAt: null,
          },
        };
    const rows = await this.prisma.knowledgeItem.findMany({
      where: { ...where, ...(libraryIds?.length ? { libraryId: { in: libraryIds } } : {}) },
      select: { id: true },
    });
    return new Set(rows.map((row) => row.id));
  }

  /** 从知识库结构化 Dataset remark 提取 knowledgeItemId */
  extractKnowledgeItemId(remark: string | null | undefined): string | null {
    if (!remark?.startsWith('knowledgeItemId=')) return null;
    const id = remark.slice('knowledgeItemId='.length).trim();
    return id || null;
  }

  /** 判断结构化 Dataset 是否对用户可查询 */
  isDatasetAccessible(
    dataset: {
      code: string;
      remark: string | null;
      visibility: DatasetVisibility;
    },
    accessibleKnowledgeIds: Set<string>,
  ): boolean {
    const isKnowledgeStructured =
      dataset.code.startsWith('kb_') ||
      dataset.remark?.startsWith('knowledgeItemId=');

    if (!isKnowledgeStructured) {
      return dataset.visibility === DatasetVisibility.public;
    }

    const knowledgeItemId = this.extractKnowledgeItemId(dataset.remark);
    return Boolean(
      knowledgeItemId && accessibleKnowledgeIds.has(knowledgeItemId),
    );
  }

  /** 用户可查询的结构化 Dataset 条件（公共来源 + 本人知识库产物） */
  buildAccessibleStructuredDatasetWhere(
    userId: string,
    accessibleKnowledgeIds: Set<string>,
  ): Prisma.DatasetWhereInput {
    const knowledgeItemIds = [...accessibleKnowledgeIds];
    const kbClauses: Prisma.DatasetWhereInput[] = knowledgeItemIds.map(
      (id) => ({
        remark: `knowledgeItemId=${id}`,
      }),
    );

    return {
      deletedAt: null,
      status: CommonStatus.active,
      publishStatus: DatasetPublishStatus.published,
      OR: [
        {
          AND: [
            externalSourceDatasetWhere(),
            { visibility: DatasetVisibility.public },
          ],
        },
        ...(kbClauses.length
          ? [
              {
                AND: [knowledgeStructuredDatasetWhere(), { OR: kbClauses }],
              },
            ]
          : []),
      ],
    };
  }
}
