import { Injectable } from '@nestjs/common';
import {
  Announcement,
  AnnouncementAudienceScope,
  AnnouncementStatus,
  Prisma,
  SubscriptionStatus,
  UserStatus,
} from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  AnnouncementListResultDto,
  AnnouncementViewDto,
  BusinessNotificationViewDto,
} from './dto/operation-response.dto';
import {
  AnnouncementPageQueryDto,
  CreateAnnouncementDto,
  NotificationPageQueryDto,
  UpsertAnnouncementDto,
} from './dto/operation.dto';
import { AuthUserContext } from '../../common/types/auth-user.context';

/**
 * 消息公告与业务通知。
 */
@Injectable()
export class AnnouncementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogWriter,
    private readonly businessNotifications: BusinessNotificationWriter,
  ) {}

  /**
   * 分页公告列表 + 状态汇总。
   */
  async pageAnnouncements(
    query: AnnouncementPageQueryDto,
  ): Promise<AnnouncementListResultDto> {
    const where: Prisma.AnnouncementWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword, mode: 'insensitive' } },
              { content: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [items, total, draftCount, publishedCount, recalledCount] =
      await Promise.all([
        this.prisma.announcement.findMany({
          where,
          orderBy: { updatedAt: 'desc' },
          skip,
          take,
        }),
        this.prisma.announcement.count({ where }),
        this.prisma.announcement.count({
          where: { deletedAt: null, status: AnnouncementStatus.draft },
        }),
        this.prisma.announcement.count({
          where: { deletedAt: null, status: AnnouncementStatus.published },
        }),
        this.prisma.announcement.count({
          where: { deletedAt: null, status: AnnouncementStatus.recalled },
        }),
      ]);

    return {
      items: items.map((row) => this.toAnnouncementView(row)),
      total,
      page: query.page,
      pageSize: query.pageSize,
      draftCount,
      publishedCount,
      recalledCount,
    };
  }

  async pageUserAnnouncements(
    query: AnnouncementPageQueryDto,
    user: AuthUserContext,
  ): Promise<AnnouncementListResultDto> {
    const proSubscription = await this.prisma.userSubscription.findFirst({
      where: {
        userId: user.userId,
        deletedAt: null,
        status: SubscriptionStatus.active,
        startAt: { lte: new Date() },
        endAt: { gte: new Date() },
      },
      include: { level: { select: { code: true } } },
    });
    const audience: Prisma.AnnouncementWhereInput[] = [
      { audienceScope: AnnouncementAudienceScope.all_users },
      ...(user.roleIds ?? []).map((roleId) => ({
        audienceScope: AnnouncementAudienceScope.specified_roles,
        audienceRoleIds: { array_contains: [roleId] },
      })),
      ...(proSubscription?.level.code === 'pro'
        ? [{ audienceScope: AnnouncementAudienceScope.pro_members }]
        : []),
    ];
    const where: Prisma.AnnouncementWhereInput = {
      deletedAt: null,
      status: AnnouncementStatus.published,
      OR: audience,
    };
    const { skip, take } = query.toSkipTake();
    const [rows, total] = await Promise.all([
      this.prisma.announcement.findMany({ where, orderBy: { publishedAt: 'desc' }, skip, take }),
      this.prisma.announcement.count({ where }),
    ]);
    return { items: rows.map((row) => this.toAnnouncementView(row)), total, page: query.page, pageSize: query.pageSize, draftCount: 0, publishedCount: total, recalledCount: 0 };
  }

  async pageUserNotifications(query: NotificationPageQueryDto, userId: string): Promise<PageResultDto<BusinessNotificationViewDto>> {
    // 打开消息中心时，把历史支付/开通/退款补成通知（幂等）
    await this.businessNotifications.backfillMembershipHistory(userId);
    return this.pageNotifications(query, userId);
  }

  /**
   * 创建公告（草稿或立即发布）。
   */
  async create(dto: CreateAnnouncementDto, actorId: string) {
    this.assertAudience(dto);
    this.assertPublishable(dto.title, dto.content);
    const publish = dto.publish === true;
    const now = new Date();
    const row = await this.prisma.announcement.create({
      data: {
        title: dto.title.trim(),
        content: dto.content.trim(),
        audienceScope: dto.audienceScope,
        audienceRoleIds: this.roleIdsValue(dto),
        status: publish
          ? AnnouncementStatus.published
          : AnnouncementStatus.draft,
        publishedAt: publish ? now : null,
        createdBy: actorId,
      },
    });
    await this.audit.write({
      actorId,
      action: publish ? 'publish' : 'create',
      resourceType: 'announcement',
      resourceId: row.id,
    });
    if (publish) {
      await this.fanOutAnnouncement(row);
    }
    return this.toAnnouncementView(row);
  }

  /**
   * 编辑公告正文与接收范围。
   */
  async update(id: string, dto: UpsertAnnouncementDto, actorId: string) {
    await this.requireAnnouncement(id);
    this.assertAudience(dto);
    this.assertPublishable(dto.title, dto.content);
    const row = await this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title.trim(),
        content: dto.content.trim(),
        audienceScope: dto.audienceScope,
        audienceRoleIds: this.roleIdsValue(dto),
      },
    });
    await this.audit.write({
      actorId,
      action: 'update',
      resourceType: 'announcement',
      resourceId: id,
    });
    return this.toAnnouncementView(row);
  }

  /**
   * 发布草稿或撤回后的公告。
   */
  async publish(id: string, actorId: string) {
    const row = await this.requireAnnouncement(id);
    this.assertPublishable(row.title, row.content);
    if (row.status === AnnouncementStatus.published) {
      throw new BusinessException(
        'ANNOUNCEMENT_ALREADY_PUBLISHED',
        '公告已发布',
        400,
      );
    }
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        status: AnnouncementStatus.published,
        publishedAt: new Date(),
        recalledAt: null,
      },
    });
    await this.audit.write({
      actorId,
      action: 'publish',
      resourceType: 'announcement',
      resourceId: id,
    });
    await this.fanOutAnnouncement(updated);
    return this.toAnnouncementView(updated);
  }

  /**
   * 撤回已发布公告（保留记录）。
   */
  async recall(id: string, actorId: string) {
    const row = await this.requireAnnouncement(id);
    if (row.status !== AnnouncementStatus.published) {
      throw new BusinessException(
        'ANNOUNCEMENT_NOT_PUBLISHED',
        '仅已发布公告可撤回',
        400,
      );
    }
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: {
        status: AnnouncementStatus.recalled,
        recalledAt: new Date(),
      },
    });
    await this.audit.write({
      actorId,
      action: 'recall',
      resourceType: 'announcement',
      resourceId: id,
    });
    return this.toAnnouncementView(updated);
  }

  /**
   * 重新发布已撤回公告。
   */
  async republish(id: string, actorId: string) {
    const row = await this.requireAnnouncement(id);
    if (row.status !== AnnouncementStatus.recalled) {
      throw new BusinessException(
        'ANNOUNCEMENT_NOT_RECALLED',
        '仅已撤回公告可重新发布',
        400,
      );
    }
    return this.publish(id, actorId);
  }

  /**
   * 业务通知分页。
   */
  async pageNotifications(
    query: NotificationPageQueryDto,
    receiverId?: string,
  ): Promise<PageResultDto<BusinessNotificationViewDto>> {
    const sentAt = this.resolveSentAtFilter(query.timeRange);
    const receiverKeyword = query.receiver?.trim();
    const where: Prisma.BusinessNotificationWhereInput = {
      ...(receiverId ? { receiverId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.bizType && query.bizType !== 'all'
        ? { bizType: query.bizType }
        : {}),
      ...(sentAt ? { sentAt } : {}),
      ...(receiverKeyword
        ? {
            receiver: {
              OR: [
                {
                  username: {
                    contains: receiverKeyword,
                    mode: 'insensitive',
                  },
                },
                {
                  profile: {
                    displayName: {
                      contains: receiverKeyword,
                      mode: 'insensitive',
                    },
                  },
                },
              ],
            },
          }
        : {}),
      ...(query.keyword
        ? {
            OR: [
              { content: { contains: query.keyword, mode: 'insensitive' } },
              {
                receiver: {
                  OR: [
                    {
                      username: {
                        contains: query.keyword,
                        mode: 'insensitive',
                      },
                    },
                    {
                      profile: {
                        displayName: {
                          contains: query.keyword,
                          mode: 'insensitive',
                        },
                      },
                    },
                  ],
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [rows, total] = await Promise.all([
      this.prisma.businessNotification.findMany({
        where,
        include: { receiver: { include: { profile: true } } },
        orderBy: { sentAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.businessNotification.count({ where }),
    ]);
    return new PageResultDto(
      rows.map((row) => ({
        id: row.id,
        content: row.content,
        receiverId: row.receiverId,
        receiverName:
          row.receiver.profile?.displayName || row.receiver.username,
        status: row.status,
        bizType: row.bizType,
        sentAt: row.sentAt.toISOString(),
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  private resolveSentAtFilter(
    timeRange?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!timeRange || timeRange === 'all') return undefined;
    const now = new Date();
    if (timeRange === 'today') {
      const gte = new Date(now);
      gte.setHours(0, 0, 0, 0);
      return { gte };
    }
    const days =
      timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 0;
    if (!days) return undefined;
    const gte = new Date(now);
    gte.setDate(gte.getDate() - days);
    return { gte };
  }

  /**
   * 标记已读。
   */
  async markRead(id: string, actorId: string, enforceOwner = false) {
    const row = await this.prisma.businessNotification.findUnique({
      where: { id },
    });
    if (!row || (enforceOwner && row.receiverId !== actorId)) {
      throw new BusinessException(
        'NOTIFICATION_NOT_FOUND',
        '通知不存在',
        404,
      );
    }
    const updated = await this.prisma.businessNotification.update({
      where: { id },
      data: { status: 'read' },
      include: { receiver: { include: { profile: true } } },
    });
    await this.audit.write({
      actorId,
      action: 'mark_read',
      resourceType: 'business_notification',
      resourceId: id,
    });
    return {
      id: updated.id,
      content: updated.content,
      receiverId: updated.receiverId,
      receiverName:
        updated.receiver.profile?.displayName || updated.receiver.username,
      status: updated.status,
      bizType: updated.bizType,
      sentAt: updated.sentAt.toISOString(),
    } satisfies BusinessNotificationViewDto;
  }

  /**
   * 将当前用户全部未读通知标为已读。
   */
  async markAllRead(userId: string) {
    const result = await this.prisma.businessNotification.updateMany({
      where: { receiverId: userId, status: 'unread' },
      data: { status: 'read' },
    });
    await this.audit.write({
      actorId: userId,
      action: 'mark_all_read',
      resourceType: 'business_notification',
      resourceId: userId,
      detail: { count: result.count },
    });
    return { ok: true, count: result.count };
  }

  /**
   * 重发：复制一条未读通知。
   */
  async resend(id: string, actorId: string) {
    const row = await this.prisma.businessNotification.findUnique({
      where: { id },
    });
    if (!row) {
      throw new BusinessException(
        'NOTIFICATION_NOT_FOUND',
        '通知不存在',
        404,
      );
    }
    const created = await this.prisma.businessNotification.create({
      data: {
        content: row.content,
        receiverId: row.receiverId,
        status: 'unread',
        bizType: row.bizType,
        sentAt: new Date(),
      },
      include: { receiver: { include: { profile: true } } },
    });
    await this.audit.write({
      actorId,
      action: 'resend',
      resourceType: 'business_notification',
      resourceId: created.id,
      detail: { fromId: id },
    });
    return {
      id: created.id,
      content: created.content,
      receiverId: created.receiverId,
      receiverName:
        created.receiver.profile?.displayName || created.receiver.username,
      status: created.status,
      bizType: created.bizType,
      sentAt: created.sentAt.toISOString(),
    } satisfies BusinessNotificationViewDto;
  }

  /**
   * 发布后按接收范围写入用户站内通知。
   */
  private async fanOutAnnouncement(row: Announcement): Promise<void> {
    const receiverIds = await this.resolveAudienceUserIds(row);
    await this.businessNotifications.announceToUsers(
      receiverIds,
      row.title,
      row.content,
      { sentAt: row.publishedAt ?? new Date() },
    );
  }

  private async resolveAudienceUserIds(row: Announcement): Promise<string[]> {
    const baseWhere: Prisma.UserWhereInput = {
      deletedAt: null,
      status: UserStatus.active,
    };

    if (row.audienceScope === AnnouncementAudienceScope.all_users) {
      const users = await this.prisma.user.findMany({
        where: baseWhere,
        select: { id: true },
      });
      return users.map((u) => u.id);
    }

    if (row.audienceScope === AnnouncementAudienceScope.pro_members) {
      const now = new Date();
      const subs = await this.prisma.userSubscription.findMany({
        where: {
          deletedAt: null,
          status: SubscriptionStatus.active,
          startAt: { lte: now },
          endAt: { gte: now },
          level: { code: 'pro' },
          user: baseWhere,
        },
        select: { userId: true },
      });
      return [...new Set(subs.map((s) => s.userId))];
    }

    const roleIds = Array.isArray(row.audienceRoleIds)
      ? (row.audienceRoleIds as string[])
      : [];
    if (!roleIds.length) return [];

    const bindings = await this.prisma.userRole.findMany({
      where: {
        roleId: { in: roleIds },
        user: baseWhere,
      },
      select: { userId: true },
    });
    return [...new Set(bindings.map((b) => b.userId))];
  }

  private async requireAnnouncement(id: string): Promise<Announcement> {
    const row = await this.prisma.announcement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row) {
      throw new BusinessException(
        'ANNOUNCEMENT_NOT_FOUND',
        '公告不存在',
        404,
      );
    }
    return row;
  }

  private assertAudience(dto: UpsertAnnouncementDto) {
    if (dto.audienceScope === AnnouncementAudienceScope.specified_roles) {
      if (!dto.audienceRoleIds?.length) {
        throw new BusinessException(
          'ANNOUNCEMENT_ROLES_REQUIRED',
          '指定角色时请至少选择一个角色',
          400,
        );
      }
    }
  }

  private assertPublishable(title: string, content: string) {
    const t = title?.trim() ?? '';
    const c = content?.trim() ?? '';
    if (!t) {
      throw new BusinessException(
        'ANNOUNCEMENT_TITLE_EMPTY',
        '公告标题不能为空',
        400,
      );
    }
    if (t.length > 60) {
      throw new BusinessException(
        'ANNOUNCEMENT_TITLE_TOO_LONG',
        '公告标题最多 60 字',
        400,
      );
    }
    if (!c) {
      throw new BusinessException(
        'ANNOUNCEMENT_CONTENT_EMPTY',
        '公告内容不能为空',
        400,
      );
    }
    if (c.length > 500) {
      throw new BusinessException(
        'ANNOUNCEMENT_CONTENT_TOO_LONG',
        '公告内容最多 500 字',
        400,
      );
    }
  }

  private roleIdsValue(
    dto: UpsertAnnouncementDto,
  ): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (dto.audienceScope !== AnnouncementAudienceScope.specified_roles) {
      return Prisma.JsonNull;
    }
    return (dto.audienceRoleIds ?? []) as Prisma.InputJsonValue;
  }

  private toAnnouncementView(row: Announcement): AnnouncementViewDto {
    const roleIds = Array.isArray(row.audienceRoleIds)
      ? (row.audienceRoleIds as string[])
      : null;
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      audienceScope: row.audienceScope,
      audienceRoleIds: roleIds,
      status: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      recalledAt: row.recalledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
