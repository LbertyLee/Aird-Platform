import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MembershipService } from '../../membership/membership.service';
import { WechatService } from './wechat.service';

@Injectable()
export class WechatReconciliationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WechatReconciliationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly wechat: WechatService,
  ) {}
  onModuleInit() {
    this.timer = setInterval(() => void this.reconcile(), 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async reconcile() {
    if (this.running || !this.wechat.isEnabled()) return;
    this.running = true;
    try {
      const orders = await this.prisma.membershipOrder.findMany({
        where: {
          paymentChannel: 'wechat',
          deletedAt: null,
          OR: [
            { status: { in: ['pending', 'failed'] } },
            { status: 'paid', refundRequestedAt: { not: null } },
          ],
        },
        orderBy: { updatedAt: 'asc' },
        take: 20,
      });
      for (const order of orders) {
        try {
          if (order.status === 'paid' && order.refundRequestedAt) {
            await this.membership.refundOrder(
              order.id,
              { reason: order.refundReason ?? '退款补偿' },
              order.createdBy ?? order.buyerId,
            );
            continue;
          }
          const result = await this.membership.syncPaymentOrder(order.id);
          if (
            result.status === 'pending' &&
            Date.now() > order.createdAt.getTime() + 31 * 60000
          ) {
            await this.membership.cancelOrder(order.id, order.buyerId);
          }
        } catch {
          this.logger.warn(`微信支付对账暂未完成 orderNo=${order.orderNo}`);
        } finally {
          await this.prisma.membershipOrder.update({
            where: { id: order.id },
            data: { updatedAt: new Date() },
          });
        }
      }
    } catch {
      this.logger.warn('微信支付对账任务失败，将在下一轮重试');
    } finally {
      this.running = false;
    }
  }
}
