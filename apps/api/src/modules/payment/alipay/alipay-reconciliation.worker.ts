import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MembershipService } from '../../membership/membership.service';
import { AlipayService } from './alipay.service';

/** 无需额外队列：补偿丢失通知及已请求但本地未落账的退款。多实例依靠入账事务幂等。 */
@Injectable()
export class AlipayReconciliationWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AlipayReconciliationWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly membership: MembershipService,
    private readonly alipay: AlipayService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.reconcile();
    }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async reconcile() {
    if (this.running || !this.alipay.isEnabled()) return;
    this.running = true;
    try {
      const orders = await this.prisma.membershipOrder.findMany({
        where: {
          paymentChannel: 'alipay',
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
          if (order.refundRequestedAt && order.status === 'paid') {
            await this.membership.refundOrder(
              order.id,
              { reason: order.refundReason ?? '退款补偿' },
              order.createdBy ?? order.buyerId,
            );
          } else {
            const synced = await this.membership.syncPaymentOrder(order.id);
            // 未创建支付宝交易的已过期表单也不能再支付，可以安全关闭本地单。
            if (
              synced.status === 'pending' &&
              Date.now() > order.createdAt.getTime() + 31 * 60000
            )
              await this.membership.cancelOrder(order.id, order.buyerId);
          }
        } catch {
          this.logger.warn(
            `支付宝对账未完成 orderNo=${order.orderNo}，下一轮重试`,
          );
        } finally {
          // 轮转，避免一批网络异常订单饿死后续订单。
          await this.prisma.membershipOrder.update({
            where: { id: order.id },
            data: { updatedAt: new Date() },
          });
        }
      }
    } catch {
      this.logger.error('支付宝对账任务失败，下一轮重试');
    } finally {
      this.running = false;
    }
  }
}
