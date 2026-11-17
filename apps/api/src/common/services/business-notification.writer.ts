import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { formatAdminDate } from '../../modules/membership/active-subscription.util';

/** 业务通知类型（前端按此映射标题与图标） */
export const NotificationBizType = {
  PAYMENT_SUCCESS: 'payment_success',
  MEMBERSHIP_ACTIVATED: 'membership_activated',
  REFUND: 'refund',
  REPORT_READY: 'report_ready',
  RENEWAL: 'renewal',
  KNOWLEDGE_INDEX: 'knowledge_index',
  FILE_LEARNED: 'file_learned',
  ANNOUNCEMENT: 'announcement',
} as const;

export type NotificationBizTypeValue =
  (typeof NotificationBizType)[keyof typeof NotificationBizType];

type NotifyOptions = {
  sentAt?: Date;
  status?: 'unread' | 'read';
};

/**
 * 写入用户站内业务通知。
 */
@Injectable()
export class BusinessNotificationWriter {
  private readonly logger = new Logger(BusinessNotificationWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 通用写入；失败不影响主流程。
   */
  async notify(
    receiverId: string,
    bizType: NotificationBizTypeValue | string,
    content: string,
    options?: NotifyOptions,
  ): Promise<void> {
    if (!receiverId || !content.trim()) return;
    try {
      await this.prisma.businessNotification.create({
        data: {
          receiverId,
          bizType,
          content: content.trim().slice(0, 512),
          status: options?.status ?? 'unread',
          sentAt: options?.sentAt ?? new Date(),
        },
      });
    } catch (err) {
      this.logger.warn(
        `notify failed receiver=${receiverId} type=${bizType}: ${String(err)}`,
      );
    }
  }

  async paymentSuccess(
    receiverId: string,
    orderNo: string,
    amount: number | string,
    channelLabel: string,
    options?: NotifyOptions,
  ) {
    await this.notify(
      receiverId,
      NotificationBizType.PAYMENT_SUCCESS,
      `订单 ${orderNo} 已支付成功，金额 ¥${Number(amount).toFixed(2)}（${channelLabel}）。`,
      options,
    );
  }

  async membershipActivated(
    receiverId: string,
    levelName: string,
    endAtLabel: string,
    options?: NotifyOptions & { orderNo?: string },
  ) {
    const orderHint = options?.orderNo ? `（订单 ${options.orderNo}）` : '';
    await this.notify(
      receiverId,
      NotificationBizType.MEMBERSHIP_ACTIVATED,
      `${levelName}会员已开通${orderHint}，有效期至 ${endAtLabel}。`,
      options,
    );
  }

  async refund(
    receiverId: string,
    orderNo: string,
    amount: number | string,
    reason?: string | null,
    options?: NotifyOptions,
  ) {
    const suffix = reason?.trim() ? `，原因：${reason.trim()}` : '';
    await this.notify(
      receiverId,
      NotificationBizType.REFUND,
      `订单 ${orderNo} 已退款 ¥${Number(amount).toFixed(2)}${suffix}。`,
      options,
    );
  }

  async reportReady(receiverId: string, query: string) {
    const title = query.trim().slice(0, 40) || '研究报告';
    await this.notify(
      receiverId,
      NotificationBizType.REPORT_READY,
      `《${title}》已生成，可在历史记录与成果中查看。`,
    );
  }

  async renewalReminder(
    receiverId: string,
    levelName: string,
    endAtLabel: string,
    options?: NotifyOptions,
  ) {
    await this.notify(
      receiverId,
      NotificationBizType.RENEWAL,
      `${levelName}会员将于 ${endAtLabel} 到期，请及时续费。`,
      options,
    );
  }

  async knowledgeIndexUpdated(receiverId: string, count: number) {
    await this.notify(
      receiverId,
      NotificationBizType.KNOWLEDGE_INDEX,
      `知识库已完成索引更新（+${count} 条），检索更准确。`,
    );
  }

  async fileLearned(receiverId: string, fileTitle: string) {
    await this.notify(
      receiverId,
      NotificationBizType.FILE_LEARNED,
      `文件「${fileTitle.slice(0, 60)}」学习完成，已可检索。`,
    );
  }

  /**
   * 批量下发平台公告到目标用户站内信（失败不影响发布主流程）。
   */
  async announceToUsers(
    receiverIds: string[],
    title: string,
    content: string,
    options?: NotifyOptions,
  ): Promise<number> {
    const unique = [...new Set(receiverIds.filter(Boolean))];
    if (!unique.length) return 0;
    const body = `【${title.trim()}】${content.trim()}`.slice(0, 512);
    if (!body) return 0;
    const sentAt = options?.sentAt ?? new Date();
    const status = options?.status ?? 'unread';
    try {
      const result = await this.prisma.businessNotification.createMany({
        data: unique.map((receiverId) => ({
          receiverId,
          bizType: NotificationBizType.ANNOUNCEMENT,
          content: body,
          status,
          sentAt,
        })),
      });
      return result.count;
    } catch (err) {
      this.logger.warn(
        `announceToUsers failed count=${unique.length}: ${String(err)}`,
      );
      return 0;
    }
  }

  private channelLabel(channel: string | null | undefined): string {
    if (channel === 'wechat') return '微信支付';
    if (channel === 'alipay') return '支付宝';
    if (channel === 'mock') return '模拟支付';
    return channel || '模拟支付';
  }

  /**
   * 将历史支付 / 开通 / 退款订单回填为站内通知（按订单号幂等去重）。
   * 历史记录标记为已读，避免刷爆未读角标。
   */
  async backfillMembershipHistory(userId: string): Promise<void> {
    try {
      const orders = await this.prisma.membershipOrder.findMany({
        where: {
          buyerId: userId,
          deletedAt: null,
          status: { in: [OrderStatus.paid, OrderStatus.refunded] },
        },
        include: {
          level: { select: { name: true } },
          package: { select: { durationDays: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
      });
      if (!orders.length) return;

      const existing = await this.prisma.businessNotification.findMany({
        where: {
          receiverId: userId,
          bizType: {
            in: [
              NotificationBizType.PAYMENT_SUCCESS,
              NotificationBizType.MEMBERSHIP_ACTIVATED,
              NotificationBizType.REFUND,
            ],
          },
        },
        select: { content: true, bizType: true },
      });
      const covered = (bizType: string, orderNo: string) =>
        existing.some(
          (row) => row.bizType === bizType && row.content.includes(orderNo),
        );

      for (const order of orders) {
        const paidAt = order.paidAt ?? order.createdAt;
        const channel =
          order.payments[0]?.channel ?? order.paymentChannel ?? 'mock';

        if (
          (order.status === OrderStatus.paid ||
            order.status === OrderStatus.refunded) &&
          !covered(NotificationBizType.PAYMENT_SUCCESS, order.orderNo)
        ) {
          await this.paymentSuccess(
            userId,
            order.orderNo,
            Number(order.amount),
            this.channelLabel(channel),
            { sentAt: paidAt, status: 'read' },
          );
          existing.push({
            bizType: NotificationBizType.PAYMENT_SUCCESS,
            content: order.orderNo,
          });
        }

        if (
          order.status === OrderStatus.paid &&
          !covered(NotificationBizType.MEMBERSHIP_ACTIVATED, order.orderNo)
        ) {
          const days = order.package?.durationDays ?? 30;
          const endAt = new Date(paidAt);
          endAt.setUTCDate(endAt.getUTCDate() + days);
          await this.membershipActivated(
            userId,
            order.level.name,
            formatAdminDate(endAt),
            { sentAt: paidAt, status: 'read', orderNo: order.orderNo },
          );
          existing.push({
            bizType: NotificationBizType.MEMBERSHIP_ACTIVATED,
            content: order.orderNo,
          });
        }

        if (
          order.status === OrderStatus.refunded &&
          !covered(NotificationBizType.REFUND, order.orderNo)
        ) {
          await this.refund(
            userId,
            order.orderNo,
            Number(order.amount),
            order.refundReason,
            {
              sentAt: order.refundedAt ?? order.updatedAt ?? paidAt,
              status: 'read',
            },
          );
          existing.push({
            bizType: NotificationBizType.REFUND,
            content: order.orderNo,
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `backfillMembershipHistory failed user=${userId}: ${String(err)}`,
      );
    }
  }
}
