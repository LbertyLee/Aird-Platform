import { Injectable } from '@nestjs/common';
import { BuyerType, OrderStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateOrderDto } from './dto/membership.dto';

/**
 * 按套餐创建会员订单（Factory 模式）。
 */
@Injectable()
export class MembershipOrderFactory {
  /**
   * @param prisma Prisma
   */
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 校验买方用户与套餐，生成 orderNo、金额与展示标题。
   */
  async create(dto: CreateOrderDto, createdBy?: string) {
    const pkg = await this.prisma.membershipPackage.findFirst({
      where: {
        id: dto.packageId,
        deletedAt: null,
        status: 'active',
        tag: { not: 'off_shelf' },
      },
      include: { level: true },
    });
    if (!pkg || pkg.level.deletedAt || pkg.level.status !== 'active') {
      throw new BusinessException(
        'PACKAGE_NOT_FOUND',
        '会员套餐不存在或已下架',
        404,
      );
    }

    if (dto.buyerType !== BuyerType.user) {
      throw new BusinessException('BUYER_TYPE_INVALID', '仅支持用户购买');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: dto.buyerId, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '买方用户不存在', 404);
    }

    const orderNo = `ORD${Date.now()}${randomBytes(2).toString('hex').toUpperCase()}`;
    const title = `${pkg.level.name} · ${pkg.name}`;
    return {
      orderNo,
      buyerType: dto.buyerType,
      buyerId: dto.buyerId,
      levelId: pkg.levelId,
      packageId: pkg.id,
      title,
      amount: pkg.price,
      status: OrderStatus.pending,
      createdBy,
      remark: dto.remark,
      durationDays: pkg.durationDays,
      autoRenew: pkg.packageType === 'auto_renew_monthly',
    };
  }
}
