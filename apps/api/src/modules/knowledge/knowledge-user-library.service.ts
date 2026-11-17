import { Injectable } from '@nestjs/common';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { activeUserSubscriptionWhere } from '../membership/active-subscription.util';
import { KnowledgeItemService } from './knowledge-item.service';
import { KnowledgeLibraryService } from './knowledge-library.service';
import type { KnowledgeLibraryViewDto } from './dto/knowledge-response.dto';
import type { KnowledgeItemViewDto } from './dto/knowledge-response.dto';

type UserLibBucket = {
  library: KnowledgeLibraryViewDto;
  items: KnowledgeItemViewDto[];
};

/**
 * 管理端「用户知识库」：按用户汇总其创建的知识库与提交的文档。
 */
@Injectable()
export class KnowledgeUserLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly libraries: KnowledgeLibraryService,
    private readonly items: KnowledgeItemService,
  ) {}

  async overview(userId: string) {
    const now = new Date();
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        profile: true,
        subscriptions: {
          where: activeUserSubscriptionWhere(now),
          orderBy: { endAt: 'desc' },
          take: 1,
          include: { level: { select: { id: true, code: true, name: true } } },
        },
      },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }

    const itemInclude = {
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
    } as const;

    const [createdLibs, submittedItems] = await Promise.all([
      this.prisma.knowledgeLibrary.findMany({
        where: { createdBy: userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        include: {
          creator: { include: { profile: true } },
          updater: { include: { profile: true } },
        },
      }),
      this.prisma.knowledgeItem.findMany({
        where: { submittedBy: userId, deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        include: {
          ...itemInclude,
          library: true,
        },
      }),
    ]);

    const createdLibIds = new Set(createdLibs.map((l) => l.id));
    const itemsInCreated =
      createdLibIds.size > 0
        ? await this.prisma.knowledgeItem.findMany({
            where: {
              libraryId: { in: [...createdLibIds] },
              deletedAt: null,
            },
            orderBy: { updatedAt: 'desc' },
            include: itemInclude,
          })
        : [];

    const libMap = new Map<string, UserLibBucket>();
    for (const lib of createdLibs) {
      libMap.set(lib.id, {
        library: this.libraries.toView(lib),
        items: itemsInCreated
          .filter((i) => i.libraryId === lib.id)
          .map((i) => this.items.toView(i)),
      });
    }

    const missingLibIds = [
      ...new Set(
        submittedItems
          .map((i) => i.libraryId)
          .filter((id): id is string => !!id && !createdLibIds.has(id)),
      ),
    ];
    if (missingLibIds.length) {
      const extraLibs = await this.prisma.knowledgeLibrary.findMany({
        where: { id: { in: missingLibIds }, deletedAt: null },
        include: {
          creator: { include: { profile: true } },
          updater: { include: { profile: true } },
        },
      });
      for (const lib of extraLibs) {
        libMap.set(lib.id, {
          library: this.libraries.toView(lib),
          items: [],
        });
      }
    }

    for (const item of submittedItems) {
      if (!item.libraryId || createdLibIds.has(item.libraryId)) continue;
      const bucket = libMap.get(item.libraryId);
      if (!bucket) continue;
      if (!bucket.items.some((x) => x.id === item.id)) {
        bucket.items.push(this.items.toView(item));
      }
    }

    const orphanItems = submittedItems
      .filter((i) => !i.libraryId)
      .map((i) => this.items.toView(i));

    const libraries = [...libMap.values()].map((bucket) => {
      const fileSize = bucket.items.reduce(
        (sum, i) => sum + (i.fileSize || 0),
        0,
      );
      return {
        ...bucket.library,
        fileTotal: bucket.items.length,
        fileSize,
        items: bucket.items,
        virtual: false as boolean,
      };
    });

    if (orphanItems.length) {
      const fileSize = orphanItems.reduce(
        (sum, i) => sum + (i.fileSize || 0),
        0,
      );
      libraries.push({
        id: `__orphan__${userId}`,
        name: '未归库文档',
        code: `orphan-${userId}`,
        type: 'normal',
        visibility: 'private',
        intro: '尚未归属具体知识库的文档',
        groupCode: null,
        icon: '📄',
        color: '#f2f4f7',
        fileTotal: orphanItems.length,
        fileSize,
        chunkMethod: 'smart',
        chunkSize: 800,
        chunkOverlap: 120,
        structuredIndexMode: 'hybrid',
        embeddingModel: 'text-embedding-v3',
        recallTopK: 8,
        similarityThreshold: 0.6,
        hybridSemanticWeight: 0.7,
        hybridKeywordWeight: 0.3,
        status: 'active',
        createdBy: userId,
        updatedBy: null,
        creatorName: user.profile?.displayName || user.username || null,
        updaterName: null,
        createdAt: orphanItems[0]?.createdAt || new Date(),
        updatedAt: orphanItems[0]?.updatedAt || new Date(),
        items: orphanItems,
        virtual: true,
      });
    }

    libraries.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const totalDocs = libraries.reduce((n, l) => n + l.fileTotal, 0);
    const totalSize = libraries.reduce((n, l) => n + (l.fileSize || 0), 0);
    const membership = user.subscriptions[0]?.level;

    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.profile?.displayName || null,
        membershipLevelName: membership?.name || null,
      },
      libraryCount: libraries.length,
      documentCount: totalDocs,
      totalSize,
      libraries,
    };
  }
}
