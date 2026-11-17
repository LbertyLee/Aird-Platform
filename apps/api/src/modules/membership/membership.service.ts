import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  BuyerType,
  CommonStatus,
  InvoiceStatus,
  OrderStatus,
  PackageTag,
  PackageType,
  PaymentStatus,
  Prisma,
  ResearchRunStatus,
  SubscriptionOwnerType,
  SubscriptionStatus,
} from '@prisma/client';
import { PageResultDto } from '../../common/dto/page.dto';
import { BusinessException } from '../../common/exceptions/business.exception';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ApplyInvoiceDto,
  BindBenefitsDto,
  CreateLevelDto,
  CheckoutPackageDto,
  CreateOrderDto,
  CreatePackageDto,
  CreateUserOrderDto,
  GrantUserSubscriptionDto,
  MembershipPageQueryDto,
  MockPayCallbackDto,
  PayUserOrderDto,
  RefundOrderDto,
  UpdateLevelDto,
  UpdatePackageDto,
  UpdatePointRulesDto,
  UserBillingQueryDto,
} from './dto/membership.dto';
import {
  activeUserSubscriptionWhere,
  daysUntilEnd,
  formatAdminDate,
  formatAdminDateTime,
  pickLatestActiveSubscriptionPerUser,
} from './active-subscription.util';
import { EntitlementResolver } from './entitlement.resolver';
import { MembershipOrderFactory } from './membership-order.factory';
import type { LlmUsageRecord } from '../../infrastructure/ai/llm-usage-meter.service';
import { AlipayService } from '../payment/alipay/alipay.service';
import { WechatService } from '../payment/wechat/wechat.service';

/** 非会员免费智搜体验次数 */
export const FREE_SEARCH_TRIAL_QUOTA = 1;

/** 积分规则默认值（库中无配置时回退） */
const DEFAULT_POINT_RULES = {
  registrationPoints: 500,
  monthlyFreePoints: 500,
  dailyPoints: 50,
  freeMonthlyLimit: 2_000,
  searchCostPoints: 1,
  minSearchPoints: 20,
  yuanPerPoint: 0.003,
  modelPricing: {},
} as const;

type PointRulesSnapshot = {
  registrationPoints: number;
  monthlyFreePoints: number;
  dailyPoints: number;
  freeMonthlyLimit: number;
  searchCostPoints: number;
  minSearchPoints: number;
  yuanPerPoint: number;
  modelPricing: Record<
    string,
    { inputYuanPerMillionTokens: number; outputYuanPerMillionTokens: number }
  >;
};

/**
 * 会员等级 / 订单 / 支付 / 发票应用服务。
 */
@Injectable()
export class MembershipService {
  private requireWechat(): WechatService {
    if (!this.wechat?.isEnabled())
      throw new BusinessException(
        'WECHAT_PAY_UNAVAILABLE',
        '微信支付尚未配置完整或未启用',
        503,
      );
    return this.wechat;
  }
  private pointRulesCache: PointRulesSnapshot | null = null;

  /**
   * @param prisma Prisma
   * @param orderFactory 订单工厂
   * @param entitlementResolver 权益解析
   * @param auditLogWriter 审计
   * @param notifications 站内通知
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly orderFactory: MembershipOrderFactory,
    private readonly entitlementResolver: EntitlementResolver,
    private readonly auditLogWriter: AuditLogWriter,
    private readonly notifications: BusinessNotificationWriter,
    private readonly config: ConfigService,
    private readonly alipay: AlipayService,
    @Optional() private readonly wechat?: WechatService,
  ) {}

  /** 读取全局积分规则（带进程内缓存）。 */
  async getPointRulesConfig(): Promise<PointRulesSnapshot> {
    if (this.pointRulesCache) return this.pointRulesCache;
    const row = await this.prisma.pointRuleConfig.upsert({
      where: { id: 'default' },
      update: {},
      create: { id: 'default', ...DEFAULT_POINT_RULES },
    });
    this.pointRulesCache = {
      registrationPoints: row.registrationPoints,
      monthlyFreePoints: row.monthlyFreePoints,
      dailyPoints: row.dailyPoints,
      freeMonthlyLimit: row.freeMonthlyLimit,
      searchCostPoints:
        row.searchCostPoints ?? DEFAULT_POINT_RULES.searchCostPoints,
      minSearchPoints:
        row.minSearchPoints ?? DEFAULT_POINT_RULES.minSearchPoints,
      yuanPerPoint: Number(row.yuanPerPoint),
      modelPricing: this.normalizeModelPricing(row.modelPricing),
    };
    return this.pointRulesCache;
  }

  /** 管理端：积分发放与计费规则（含各等级月赠积分）。 */
  async getPointRules() {
    const [rules, levels] = await Promise.all([
      this.getPointRulesConfig(),
      this.prisma.membershipLevel.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          code: true,
          name: true,
          monthlyPoints: true,
          status: true,
        },
        orderBy: { sort: 'asc' },
      }),
    ]);
    return {
      ...rules,
      modelPricing: Object.entries(rules.modelPricing).map(
        ([model, price]) => ({ model, ...price }),
      ),
      levels,
    };
  }

  /** 管理端：保存积分发放与计费规则。 */
  async updatePointRules(dto: UpdatePointRulesDto, actorId: string) {
    if (dto.freeMonthlyLimit < dto.registrationPoints + dto.monthlyFreePoints) {
      throw new BusinessException(
        'POINT_RULES_INVALID',
        '免费赠分上限不能小于注册赠送与每月自动赠送之和',
        400,
      );
    }
    const row = await this.prisma.pointRuleConfig.upsert({
      where: { id: 'default' },
      create: {
        id: 'default',
        registrationPoints: dto.registrationPoints,
        monthlyFreePoints: dto.monthlyFreePoints,
        dailyPoints: dto.dailyPoints,
        freeMonthlyLimit: dto.freeMonthlyLimit,
        searchCostPoints: dto.searchCostPoints ?? undefined,
        minSearchPoints: dto.minSearchPoints,
        yuanPerPoint: dto.yuanPerPoint,
        modelPricing: this.toModelPricing(dto.modelPricing),
      },
      update: {
        registrationPoints: dto.registrationPoints,
        monthlyFreePoints: dto.monthlyFreePoints,
        dailyPoints: dto.dailyPoints,
        freeMonthlyLimit: dto.freeMonthlyLimit,
        searchCostPoints: dto.searchCostPoints ?? undefined,
        minSearchPoints: dto.minSearchPoints,
        yuanPerPoint: dto.yuanPerPoint,
        modelPricing: this.toModelPricing(dto.modelPricing),
      },
    });
    if (dto.levelMonthlyPoints?.length) {
      await this.prisma.$transaction(
        dto.levelMonthlyPoints.map((item) =>
          this.prisma.membershipLevel.updateMany({
            where: { id: item.levelId, deletedAt: null },
            data: { monthlyPoints: item.monthlyPoints },
          }),
        ),
      );
    }
    this.pointRulesCache = {
      registrationPoints: row.registrationPoints,
      monthlyFreePoints: row.monthlyFreePoints,
      dailyPoints: row.dailyPoints,
      freeMonthlyLimit: row.freeMonthlyLimit,
      searchCostPoints:
        row.searchCostPoints ?? DEFAULT_POINT_RULES.searchCostPoints,
      minSearchPoints:
        row.minSearchPoints ?? DEFAULT_POINT_RULES.minSearchPoints,
      yuanPerPoint: Number(row.yuanPerPoint),
      modelPricing: this.normalizeModelPricing(row.modelPricing),
    };
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'point_rule_config',
      resourceId: 'default',
    });
    return this.getPointRules();
  }

  /**
   * 创建可售等级。
   */
  async createLevel(dto: CreateLevelDto, actorId: string) {
    const exists = await this.prisma.membershipLevel.findFirst({
      where: { code: dto.code, deletedAt: null },
    });
    if (exists) {
      throw new BusinessException(
        'LEVEL_CODE_EXISTS',
        '会员版本编码已存在',
        409,
      );
    }
    const level = await this.prisma.membershipLevel.create({
      data: {
        ...dto,
        durationDays: dto.durationDays ?? 30,
        isPurchasable: true,
        status: CommonStatus.active,
      },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'membership_level',
      resourceId: level.id,
    });
    return level;
  }

  /**
   * 更新会员等级。
   */
  async updateLevel(id: string, dto: UpdateLevelDto, actorId: string) {
    const exists = await this.prisma.membershipLevel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!exists) {
      throw new BusinessException('LEVEL_NOT_FOUND', '等级不存在', 404);
    }
    const level = await this.prisma.membershipLevel.update({
      where: { id },
      data: dto,
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'membership_level',
      resourceId: id,
    });
    return level;
  }

  /**
   * 下架会员等级。
   */
  async disableLevel(id: string, actorId: string) {
    const exists = await this.prisma.membershipLevel.findFirst({
      where: { id, deletedAt: null },
    });
    if (!exists) {
      throw new BusinessException('LEVEL_NOT_FOUND', '等级不存在', 404);
    }
    await this.prisma.membershipLevel.update({
      where: { id },
      data: { status: CommonStatus.disabled },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'disable',
      resourceType: 'membership_level',
      resourceId: id,
    });
  }

  /**
   * 等级分页。
   */
  async pageLevels(query: MembershipPageQueryDto) {
    const where: Prisma.MembershipLevelWhereInput = {
      deletedAt: null,
      ...(query.keyword
        ? {
            OR: [
              { code: { contains: query.keyword, mode: 'insensitive' } },
              { name: { contains: query.keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, items] = await this.prisma.$transaction([
      this.prisma.membershipLevel.count({ where }),
      this.prisma.membershipLevel.findMany({
        where,
        skip,
        take,
        include: { benefits: true },
        orderBy: { sort: 'asc' },
      }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /**
   * 校验并绑定等级权益。
   */
  async bindBenefits(levelId: string, dto: BindBenefitsDto, actorId: string) {
    const level = await this.prisma.membershipLevel.findFirst({
      where: { id: levelId, deletedAt: null },
    });
    if (!level) {
      throw new BusinessException('LEVEL_NOT_FOUND', '等级不存在', 404);
    }
    for (const item of dto.items) {
      const def = await this.prisma.benefitDefinition.findUnique({
        where: { code: item.benefitCode },
      });
      if (!def) {
        throw new BusinessException(
          'BENEFIT_NOT_FOUND',
          `权益码不存在: ${item.benefitCode}`,
        );
      }
      await this.prisma.levelBenefit.upsert({
        where: {
          levelId_benefitCode: {
            levelId,
            benefitCode: item.benefitCode,
          },
        },
        update: { valueJson: item.valueJson as Prisma.InputJsonValue },
        create: {
          levelId,
          benefitCode: item.benefitCode,
          valueJson: item.valueJson as Prisma.InputJsonValue,
        },
      });
    }
    await this.auditLogWriter.write({
      actorId,
      action: 'assign',
      resourceType: 'level_benefit',
      resourceId: levelId,
    });
    return this.prisma.membershipLevel.findUnique({
      where: { id: levelId },
      include: { benefits: true },
    });
  }

  /**
   * 工厂创建订单并落库（pending）；Mock 渠道直接返回支付指引。
   */
  async createOrder(dto: CreateOrderDto, actorId: string) {
    const draft = await this.orderFactory.create(dto, actorId);
    const { autoRenew: _autoRenew, ...data } = draft;
    const order = await this.prisma.membershipOrder.create({ data });
    await this.alipay.recordEvent({
      action: 'order.created',
      status: 'success',
      orderId: order.id,
      orderNo: order.orderNo,
      amount: order.amount.toFixed(2),
      actorId,
      details: { buyerType: order.buyerType },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'membership_order',
      resourceId: order.id,
    });
    return {
      ...order,
      paymentHint: {
        channel: 'mock',
        message: '调用 POST /admin/membership/payments/callback 完成 Mock 支付',
      },
    };
  }

  /**
   * 会员管理总览（专业版状态）。
   */
  async getOverview() {
    const proLevel = await this.prisma.membershipLevel.findFirst({
      where: { code: 'pro', deletedAt: null },
      include: {
        packages: {
          where: { deletedAt: null },
          orderBy: { sort: 'asc' },
        },
      },
    });
    if (!proLevel) {
      return {
        level: null,
        enabled: false,
        purchasable: false,
      };
    }
    return {
      level: {
        id: proLevel.id,
        code: proLevel.code,
        name: proLevel.name,
        status: proLevel.status,
        isPurchasable: proLevel.isPurchasable,
      },
      enabled: proLevel.status === CommonStatus.active,
      purchasable:
        proLevel.isPurchasable &&
        proLevel.status === CommonStatus.active &&
        proLevel.packages.some((p) => p.tag !== PackageTag.off_shelf),
    };
  }

  /**
   * 套餐列表（含等级信息）。
   */
  async listPackages(query: MembershipPageQueryDto) {
    const where: Prisma.MembershipPackageWhereInput = {
      deletedAt: null,
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' } },
              {
                level: {
                  name: { contains: query.keyword, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, items] = await this.prisma.$transaction([
      this.prisma.membershipPackage.count({ where }),
      this.prisma.membershipPackage.findMany({
        where,
        skip,
        take,
        include: { level: true },
        orderBy: [{ level: { sort: 'asc' } }, { sort: 'asc' }],
      }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /**
   * 创建套餐。
   */
  async createPackage(dto: CreatePackageDto, actorId: string) {
    const level = await this.prisma.membershipLevel.findFirst({
      where: { id: dto.levelId, deletedAt: null },
    });
    if (!level) {
      throw new BusinessException('LEVEL_NOT_FOUND', '会员等级不存在', 404);
    }
    const pkg = await this.prisma.membershipPackage.create({
      data: {
        levelId: dto.levelId,
        packageType: dto.packageType,
        name: dto.name,
        price: dto.price,
        originalPrice: dto.originalPrice,
        priceLabel: dto.priceLabel,
        description: dto.description,
        tag: dto.tag ?? PackageTag.on_sale,
        durationDays: dto.durationDays,
        sort: dto.sort ?? 0,
      },
      include: { level: true },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'membership_package',
      resourceId: pkg.id,
    });
    return pkg;
  }

  /**
   * 更新套餐。
   */
  async updatePackage(id: string, dto: UpdatePackageDto, actorId: string) {
    const exists = await this.prisma.membershipPackage.findFirst({
      where: { id, deletedAt: null },
    });
    if (!exists) {
      throw new BusinessException('PACKAGE_NOT_FOUND', '套餐不存在', 404);
    }
    const pkg = await this.prisma.membershipPackage.update({
      where: { id },
      data: dto,
      include: { level: true },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'membership_package',
      resourceId: id,
    });
    return pkg;
  }

  /**
   * 下架套餐（标签改为已下架）。
   */
  async offShelfPackage(id: string, actorId: string) {
    const exists = await this.prisma.membershipPackage.findFirst({
      where: { id, deletedAt: null },
    });
    if (!exists) {
      throw new BusinessException('PACKAGE_NOT_FOUND', '套餐不存在', 404);
    }
    const pkg = await this.prisma.membershipPackage.update({
      where: { id },
      data: { tag: PackageTag.off_shelf },
      include: { level: true },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'disable',
      resourceType: 'membership_package',
      resourceId: id,
    });
    return pkg;
  }

  /**
   * 上架套餐。
   */
  async onShelfPackage(id: string, actorId: string) {
    const exists = await this.prisma.membershipPackage.findFirst({
      where: { id, deletedAt: null },
    });
    if (!exists) {
      throw new BusinessException('PACKAGE_NOT_FOUND', '套餐不存在', 404);
    }
    const pkg = await this.prisma.membershipPackage.update({
      where: { id },
      data: { tag: PackageTag.on_sale },
      include: { level: true },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'enable',
      resourceType: 'membership_package',
      resourceId: id,
    });
    return pkg;
  }

  /**
   * 订单分页（含用户与套餐展示字段）。
   */
  async pageOrders(query: MembershipPageQueryDto) {
    const keyword = query.keyword?.trim();
    const paymentChannel = query.paymentChannel?.trim();

    let buyerIdsByKeyword: string[] | undefined;
    if (keyword) {
      const matchedUsers = await this.prisma.user.findMany({
        where: {
          OR: [
            { username: { contains: keyword, mode: 'insensitive' } },
            {
              profile: {
                displayName: { contains: keyword, mode: 'insensitive' },
              },
            },
          ],
        },
        select: { id: true },
        take: 200,
      });
      buyerIdsByKeyword = matchedUsers.map((u) => u.id);
    }

    const where: Prisma.MembershipOrderWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(paymentChannel && paymentChannel !== 'all' ? { paymentChannel } : {}),
      ...(keyword
        ? {
            OR: [
              { orderNo: { contains: keyword, mode: 'insensitive' } },
              { title: { contains: keyword, mode: 'insensitive' } },
              ...(buyerIdsByKeyword?.length
                ? [{ buyerId: { in: buyerIdsByKeyword } }]
                : []),
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membershipOrder.count({ where }),
      this.prisma.membershipOrder.findMany({
        where,
        skip,
        take,
        include: {
          level: true,
          package: true,
          payments: true,
          invoice: true,
          refunds: { orderBy: { refundedAt: 'desc' } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const userIds = [...new Set(rows.map((o) => o.buyerId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        username: true,
        profile: { select: { displayName: true } },
      },
    });
    const userMap = new Map(
      users.map((u) => [
        u.id,
        {
          username: u.username,
          displayName: u.profile?.displayName ?? null,
        },
      ]),
    );

    const items = rows.map((order) => {
      const buyer = userMap.get(order.buyerId);
      const { paymentCodeUrl: _paymentCodeUrl, ...safeOrder } = order;
      return {
        ...safeOrder,
        buyerUsername: buyer?.username ?? order.buyerId,
        buyerDisplayName: buyer?.displayName ?? null,
        levelTitle:
          order.title ??
          (order.package
            ? `${order.level.name} · ${order.package.name}`
            : order.level.name),
        channel:
          order.paymentChannel ??
          order.payments.find((p) => p.channel)?.channel ??
          null,
      };
    });
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /**
   * 订单详情。
   */
  async getOrderDetail(orderId: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: orderId, deletedAt: null },
      include: {
        level: true,
        package: true,
        payments: true,
        invoice: true,
        refunds: { orderBy: { refundedAt: 'desc' } },
      },
    });
    if (!order) {
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    }
    const { paymentCodeUrl: _paymentCodeUrl, ...safeOrder } = order;
    const buyer = await this.prisma.user.findFirst({
      where: { id: order.buyerId },
      select: {
        id: true,
        username: true,
        profile: { select: { displayName: true } },
      },
    });
    return {
      ...safeOrder,
      buyerUsername: buyer?.username ?? order.buyerId,
      buyerDisplayName: buyer?.profile?.displayName ?? null,
      levelTitle:
        order.title ??
        (order.package
          ? `${order.level.name} · ${order.package.name}`
          : order.level.name),
      channel:
        order.paymentChannel ??
        order.payments.find((p) => p.channel)?.channel ??
        null,
    };
  }

  /**
   * 支付成功入账：写流水、开通订阅（幂等）；供 Mock、支付宝 HTTP 通知等渠道复用。
   */
  async applyPaymentSuccess(input: {
    orderNo: string;
    channel?: string;
    tradeNo?: string;
    rawPayload?: unknown;
    paidAt?: Date;
    expectedAmount?: string | number;
  }) {
    const paidAt = input.paidAt ?? new Date();
    if (!Number.isFinite(paidAt.getTime()))
      throw new BusinessException('PAYMENT_DATE_INVALID', '支付时间无效');
    const initial = await this.prisma.membershipOrder.findUnique({
      where: { orderNo: input.orderNo },
    });
    if (!initial || initial.deletedAt)
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    const channel = input.channel ?? initial.paymentChannel ?? 'mock';
    const tradeNo = input.tradeNo ?? `MOCK${initial.orderNo}`;
    const outcome = await this.prisma.$transaction(async (tx) => {
      // 同一买方的不同订单也必须串行，避免续费覆盖；参数化 SQL，不拼接用户输入。
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${initial.buyerId} FOR UPDATE`;
      const order = await tx.membershipOrder.findUniqueOrThrow({
        where: { id: initial.id },
        include: { level: true, package: true },
      });
      if (order.deletedAt)
        throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
      if (order.paymentChannel && order.paymentChannel !== channel) {
        throw new BusinessException(
          'PAYMENT_CHANNEL_MISMATCH',
          '支付渠道不匹配',
        );
      }
      if (input.expectedAmount !== undefined) {
        const amount = String(input.expectedAmount);
        if (
          !/^\d+(?:\.\d{1,2})?$/.test(amount) ||
          !new Prisma.Decimal(amount).equals(order.amount)
        ) {
          throw new BusinessException(
            'PAYMENT_AMOUNT_MISMATCH',
            '支付金额与订单不一致',
          );
        }
      }
      if (
        (channel === 'alipay' || channel === 'wechat') &&
        (!input.tradeNo || input.expectedAmount === undefined)
      ) {
        throw new BusinessException(
          'PAYMENT_PROOF_REQUIRED',
          '缺少支付交易凭据',
        );
      }
      if (
        order.status === OrderStatus.paid ||
        order.status === OrderStatus.refunded
      ) {
        const payment = await tx.paymentRecord.findFirst({
          where: { orderId: order.id, channel, tradeNo },
        });
        if (!payment)
          throw new BusinessException(
            'PAYMENT_TRADE_MISMATCH',
            '重复通知交易号不匹配',
          );
        return null;
      }
      if (
        order.status !== OrderStatus.pending &&
        order.status !== OrderStatus.failed
      ) {
        throw new BusinessException('ORDER_STATUS_INVALID', '订单状态不可支付');
      }
      const durationDays =
        order.durationDays ??
        order.package?.durationDays ??
        order.level.durationDays;
      const existing = await tx.userSubscription.findFirst({
        where: {
          userId: order.buyerId,
          status: SubscriptionStatus.active,
          deletedAt: null,
          endAt: { gte: paidAt },
        },
        orderBy: { endAt: 'desc' },
      });
      const baseEnd =
        existing && existing.endAt > paidAt ? existing.endAt : paidAt;
      const endAt = new Date(baseEnd.getTime() + durationDays * 86400000);
      const entitlementChainId = existing?.entitlementChainId ?? order.id;
      await tx.paymentRecord.create({
        data: {
          orderId: order.id,
          channel,
          tradeNo,
          amount: order.amount,
          status: PaymentStatus.success,
          paidAt,
          // 仅保存对账所需字段，避免存储买方身份、签名等通知原文。
          rawPayload: {
            orderNo: order.orderNo,
            tradeNo,
            channel,
            amount: order.amount.toFixed(2),
          },
        },
      });
      await tx.membershipOrder.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.paid,
          paidAt,
          paymentChannel: channel,
          paymentCodeUrl: null,
          durationDays,
          entitlementStartAt: baseEnd,
          entitlementEndAt: endAt,
          entitlementChainId,
        },
      });
      await tx.userSubscription.updateMany({
        where: {
          userId: order.buyerId,
          status: SubscriptionStatus.active,
          deletedAt: null,
        },
        data: { status: SubscriptionStatus.cancelled },
      });
      await tx.userSubscription.create({
        data: {
          userId: order.buyerId,
          levelId: order.levelId,
          packageId: order.packageId,
          status: SubscriptionStatus.active,
          startAt: existing?.startAt ?? paidAt,
          endAt,
          entitlementChainId,
          // 电脑网站支付为单次支付，没有自动扣款签约。
          autoRenew: false,
        },
      });
      return { order, endAt };
    });
    if (!outcome) {
      await this.alipay.recordEvent({
        action: 'payment.credited',
        status: 'duplicate',
        channel,
        orderId: initial.id,
        orderNo: initial.orderNo,
        tradeNo,
        amount: initial.amount.toFixed(2),
      });
      return { ok: true, duplicated: true };
    }
    const { order, endAt: subscriptionEndAt } = outcome;
    await this.alipay.recordEvent({
      action: 'payment.credited',
      status: 'success',
      channel,
      orderId: order.id,
      orderNo: order.orderNo,
      tradeNo,
      amount: order.amount.toFixed(2),
      actorId: order.buyerId,
    });

    const channelLabel =
      channel === 'wechat'
        ? '微信支付'
        : channel === 'alipay'
          ? '支付宝'
          : '模拟支付';
    await this.notifications.paymentSuccess(
      order.buyerId,
      order.orderNo,
      Number(order.amount),
      channelLabel,
    );
    await this.notifications.membershipActivated(
      order.buyerId,
      order.level.name,
      formatAdminDate(subscriptionEndAt),
      { orderNo: order.orderNo },
    );

    return { ok: true, duplicated: false };
  }

  /**
   * Mock 支付回调：验单、写流水、开通订阅（幂等）。
   */
  async mockPayCallback(dto: MockPayCallbackDto) {
    if (
      this.config.get<string>('NODE_ENV') === 'production' ||
      this.config.get<string>('PAYMENT_MOCK_ENABLED', 'false') !== 'true'
    ) {
      throw new BusinessException(
        'PAYMENT_MOCK_DISABLED',
        '模拟支付已关闭',
        403,
      );
    }
    if (dto.channel && dto.channel !== 'mock')
      throw new BusinessException(
        'PAYMENT_CHANNEL_INVALID',
        '模拟回调仅允许 mock 渠道',
      );
    return this.applyPaymentSuccess({
      orderNo: dto.orderNo,
      channel: dto.channel,
      tradeNo: dto.tradeNo,
      rawPayload: { mock: true, channel: dto.channel ?? 'mock' },
    });
  }

  /**
   * 申请开票。
   */
  async applyInvoice(dto: ApplyInvoiceDto, actorId: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: dto.orderId, deletedAt: null, status: OrderStatus.paid },
    });
    if (!order) {
      throw new BusinessException('ORDER_NOT_PAID', '仅已支付订单可开票');
    }
    const invoice = await this.prisma.invoice.upsert({
      where: { orderId: dto.orderId },
      update: { title: dto.title, taxNo: dto.taxNo },
      create: {
        orderId: dto.orderId,
        title: dto.title,
        taxNo: dto.taxNo,
      },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'invoice',
      resourceId: invoice.id,
    });
    return invoice;
  }

  /**
   * 查询用户个人订阅（含当前有效）。
   */
  async listUserSubscriptions(userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }
    const now = new Date();
    const items = await this.prisma.userSubscription.findMany({
      where: { userId, deletedAt: null },
      include: { level: true },
      orderBy: { createdAt: 'desc' },
    });
    const active = items.find(
      (s) =>
        s.status === SubscriptionStatus.active &&
        s.startAt <= now &&
        s.endAt >= now,
    );
    return {
      active: active
        ? {
            id: active.id,
            levelId: active.levelId,
            status: active.status,
            startAt: active.startAt,
            endAt: active.endAt,
            level: {
              id: active.level.id,
              code: active.level.code,
              name: active.level.name,
            },
          }
        : null,
      items: items.map((s) => ({
        id: s.id,
        levelId: s.levelId,
        status: s.status,
        startAt: s.startAt,
        endAt: s.endAt,
        level: {
          id: s.level.id,
          code: s.level.code,
          name: s.level.name,
        },
      })),
    };
  }

  /** 管理员可分配的会员等级编码 */
  private static readonly ASSIGNABLE_LEVEL_CODES = [
    'normal',
    'plus',
    'pro',
  ] as const;

  /**
   * 可分配会员等级（普通版 / Plus / Pro）。
   */
  async listAssignableLevels() {
    return this.prisma.membershipLevel.findMany({
      where: {
        deletedAt: null,
        status: CommonStatus.active,
        code: { in: [...MembershipService.ASSIGNABLE_LEVEL_CODES] },
      },
      include: {
        packages: {
          where: { deletedAt: null, status: CommonStatus.active },
          orderBy: { sort: 'asc' },
        },
      },
      orderBy: { sort: 'asc' },
    });
  }

  /**
   * 管理员直赋个人会员：失效旧有效订阅，写入新订阅。
   */
  async grantUserSubscription(dto: GrantUserSubscriptionDto, actorId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: dto.userId, deletedAt: null },
    });
    if (!user) {
      throw new BusinessException('USER_NOT_FOUND', '用户不存在', 404);
    }

    const level = await this.prisma.membershipLevel.findFirst({
      where: { id: dto.levelId, deletedAt: null },
      include: {
        packages: {
          where: {
            deletedAt: null,
            status: CommonStatus.active,
            tag: { not: PackageTag.off_shelf },
          },
          orderBy: { sort: 'asc' },
        },
      },
    });
    if (!level) {
      throw new BusinessException('LEVEL_NOT_FOUND', '会员等级不存在', 404);
    }
    if (level.status !== CommonStatus.active) {
      throw new BusinessException('LEVEL_DISABLED', '会员等级已下架');
    }
    if (
      !MembershipService.ASSIGNABLE_LEVEL_CODES.includes(
        level.code as (typeof MembershipService.ASSIGNABLE_LEVEL_CODES)[number],
      )
    ) {
      throw new BusinessException(
        'LEVEL_NOT_ASSIGNABLE',
        '仅支持分配普通版 / Plus / Pro 会员',
      );
    }

    let packageId = dto.packageId;
    let selectedPackage = packageId
      ? level.packages.find((p) => p.id === packageId)
      : undefined;
    if (packageId && !selectedPackage) {
      throw new BusinessException('PACKAGE_NOT_FOUND', '会员套餐不存在', 404);
    }
    if (!selectedPackage && level.packages.length > 0) {
      selectedPackage =
        level.packages.find((p) => p.packageType === 'monthly') ??
        level.packages[0];
      packageId = selectedPackage.id;
    }

    const durationDays =
      dto.durationDays ?? selectedPackage?.durationDays ?? level.durationDays;

    const startAt = new Date();
    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + durationDays);

    const subscription = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${dto.userId} FOR UPDATE`;
      await tx.userSubscription.updateMany({
        where: {
          userId: dto.userId,
          status: SubscriptionStatus.active,
          deletedAt: null,
        },
        data: { status: SubscriptionStatus.cancelled },
      });
      return tx.userSubscription.create({
        data: {
          userId: dto.userId,
          levelId: level.id,
          packageId: packageId ?? null,
          status: SubscriptionStatus.active,
          startAt,
          endAt,
          autoRenew: selectedPackage?.packageType === 'auto_renew_monthly',
        },
        include: { level: true, package: true },
      });
    });

    await this.auditLogWriter.write({
      actorId,
      action: 'grant',
      resourceType: 'user_subscription',
      resourceId: subscription.id,
      detail: {
        userId: dto.userId,
        levelId: level.id,
        packageId,
        durationDays,
      },
    });

    return subscription;
  }

  /**
   * 解析用户有效权益。
   */
  resolveEntitlements(userId: string) {
    return this.entitlementResolver.resolveForUser(userId);
  }

  /**
   * 权益定义列表。
   */
  listBenefitDefinitions() {
    return this.prisma.benefitDefinition.findMany({
      orderBy: { code: 'asc' },
    });
  }

  /**
   * 支付流水分页。
   */
  async pagePayments(query: MembershipPageQueryDto) {
    const where: Prisma.PaymentRecordWhereInput = {
      ...(query.keyword
        ? {
            OR: [
              { tradeNo: { contains: query.keyword, mode: 'insensitive' } },
              {
                order: {
                  orderNo: { contains: query.keyword, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, items] = await this.prisma.$transaction([
      this.prisma.paymentRecord.count({ where }),
      this.prisma.paymentRecord.findMany({
        where,
        skip,
        take,
        include: { order: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /**
   * 发票分页。
   */
  async pageInvoices(query: MembershipPageQueryDto) {
    const where: Prisma.InvoiceWhereInput = {
      ...(query.keyword
        ? {
            OR: [
              { title: { contains: query.keyword, mode: 'insensitive' } },
              {
                order: {
                  orderNo: { contains: query.keyword, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, items] = await this.prisma.$transaction([
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.findMany({
        where,
        skip,
        take,
        include: { order: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /**
   * 管理员开票完成。
   */
  async issueInvoice(invoiceId: string, actorId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
    });
    if (!invoice) {
      throw new BusinessException('INVOICE_NOT_FOUND', '发票不存在', 404);
    }
    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: InvoiceStatus.issued, issuedAt: new Date() },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'invoice',
      resourceId: invoiceId,
    });
    return updated;
  }

  /**
   * 续费提醒候选列表（到期前 7 天窗口）。
   */
  async listRenewalCandidates() {
    const now = new Date();
    const subs = pickLatestActiveSubscriptionPerUser(
      await this.prisma.userSubscription.findMany({
        where: {
          ...activeUserSubscriptionWhere(now),
          level: { code: { not: 'free' } },
        },
        include: {
          user: { select: { id: true, username: true } },
          level: true,
        },
        orderBy: { endAt: 'desc' },
        take: 200,
      }),
    ).slice(0, 50);

    const subIds = subs.map((s) => s.id);
    const reminders = await this.prisma.renewalReminder.findMany({
      where: {
        subscriptionId: { in: subIds },
        subscriptionType: SubscriptionOwnerType.user,
      },
    });
    const sentMap = new Map(
      reminders.filter((r) => r.sentAt).map((r) => [r.subscriptionId, r]),
    );

    return subs.map((sub) => {
      const daysLeft = daysUntilEnd(sub.endAt, now);
      const inWindow = daysLeft <= 7;
      const sent = sentMap.has(sub.id);
      let remindStatus = '未到窗口';
      let action = '';
      if (inWindow) {
        remindStatus = sent ? '已提醒' : '待提醒';
        action = sent ? '提醒' : '发送';
      }
      const endDate = formatAdminDate(sub.endAt);
      return {
        subscriptionId: sub.id,
        userId: sub.userId,
        username: sub.user.username,
        levelName: sub.level.name,
        endAt: sub.endAt,
        daysLeft,
        inWindow,
        remindStatus,
        action,
        desc: `${endDate} 到期，剩余 ${daysLeft} 天 · 状态：${remindStatus}`,
        reminded: sent,
      };
    });
  }

  /**
   * 续费提醒分页（兼容旧接口）。
   */
  async pageReminders(query: MembershipPageQueryDto) {
    const items = await this.listRenewalCandidates();
    const { skip, take } = query.toSkipTake();
    const sliced = items.slice(skip, skip + take);
    return new PageResultDto(sliced, items.length, query.page, query.pageSize);
  }

  /**
   * 为有效订阅调度到期前 7 天续费提醒。
   */
  async scheduleRenewalReminders(actorId: string) {
    const now = new Date();
    const userSubs = await this.prisma.userSubscription.findMany({
      where: {
        deletedAt: null,
        status: SubscriptionStatus.active,
        endAt: { gt: now },
      },
    });

    let created = 0;
    for (const sub of userSubs) {
      const remindAt = new Date(sub.endAt);
      remindAt.setDate(remindAt.getDate() - 7);
      if (remindAt < now) continue;
      try {
        await this.prisma.renewalReminder.create({
          data: {
            subscriptionType: SubscriptionOwnerType.user,
            subscriptionId: sub.id,
            remindAt,
            channel: 'inbox',
          },
        });
        created += 1;
      } catch {
        // 唯一约束冲突则跳过
      }
    }

    await this.auditLogWriter.write({
      actorId,
      action: 'create',
      resourceType: 'renewal_reminder',
      detail: { created },
    });
    return { created };
  }

  /**
   * 发送单条续费提醒。
   */
  async sendReminder(subscriptionId: string, actorId: string) {
    const sub = await this.prisma.userSubscription.findFirst({
      where: { id: subscriptionId, deletedAt: null },
      include: { level: { select: { name: true } } },
    });
    if (!sub) {
      throw new BusinessException('SUBSCRIPTION_NOT_FOUND', '订阅不存在', 404);
    }
    const remindAt = new Date(sub.endAt);
    remindAt.setDate(remindAt.getDate() - 7);
    const reminder = await this.prisma.renewalReminder.upsert({
      where: {
        subscriptionType_subscriptionId_remindAt_channel: {
          subscriptionType: SubscriptionOwnerType.user,
          subscriptionId,
          remindAt,
          channel: 'inbox',
        },
      },
      update: { sentAt: new Date() },
      create: {
        subscriptionType: SubscriptionOwnerType.user,
        subscriptionId,
        remindAt,
        channel: 'inbox',
        sentAt: new Date(),
      },
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'send',
      resourceType: 'renewal_reminder',
      resourceId: reminder.id,
    });
    await this.notifications.renewalReminder(
      sub.userId,
      sub.level.name,
      formatAdminDate(sub.endAt),
    );
    return reminder;
  }

  /**
   * 批量发送续费提醒（7 天窗口内待提醒）。
   */
  async batchSendReminders(actorId: string) {
    const candidates = await this.listRenewalCandidates();
    let sent = 0;
    for (const item of candidates) {
      if (!item.inWindow || item.reminded) continue;
      await this.sendReminder(item.subscriptionId, actorId);
      sent += 1;
    }
    return { sent };
  }

  /**
   * 关闭待支付订单。
   */
  async cancelOrder(orderId: string, actorId: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: orderId, deletedAt: null },
    });
    if (!order) {
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    }
    if (order.status === OrderStatus.cancelled) return;
    if (order.status !== OrderStatus.pending)
      throw new BusinessException('ORDER_STATUS_INVALID', '仅待支付订单可关闭');
    if (order.paymentChannel === 'alipay') {
      const trade = await this.alipay.queryTrade(order.orderNo);
      if (trade && this.alipay.isTradeSuccess(trade.tradeStatus)) {
        await this.syncPaymentOrder(order.id);
        throw new BusinessException(
          'ORDER_ALREADY_PAID',
          '订单已支付，已同步结果，请使用退款功能',
        );
      }
      if (trade && trade.tradeStatus !== 'TRADE_CLOSED')
        await this.alipay.closeTrade(order.orderNo);
      if (!trade && Date.now() < order.createdAt.getTime() + 31 * 60000) {
        throw new BusinessException(
          'PAYMENT_FORM_ACTIVE',
          '支付表单仍在有效期内，请待订单过期后关闭',
        );
      }
    }
    if (order.paymentChannel === 'wechat') {
      const wechat = this.requireWechat();
      const trade = await wechat.queryTrade(order.orderNo);
      if (trade?.trade_state === 'SUCCESS') {
        await this.syncPaymentOrder(order.id);
        throw new BusinessException(
          'ORDER_ALREADY_PAID',
          '订单已支付，已同步结果',
        );
      }
      if (
        trade &&
        !['CLOSED', 'REVOKED', 'PAYERROR'].includes(trade.trade_state ?? '')
      ) {
        await wechat.closeTrade(order.orderNo);
      }
      if (!trade && Date.now() < order.createdAt.getTime() + 31 * 60000) {
        throw new BusinessException(
          'PAYMENT_REQUEST_ACTIVE',
          '支付请求仍在有效期内，请待订单过期后关闭',
        );
      }
    }
    const changed = await this.prisma.membershipOrder.updateMany({
      where: {
        id: orderId,
        status: OrderStatus.pending,
        paymentChannel: order.paymentChannel,
      },
      data: {
        status: OrderStatus.cancelled,
        closedAt: new Date(),
        paymentCodeUrl: null,
      },
    });
    if (!changed.count)
      throw new BusinessException(
        'ORDER_STATUS_INVALID',
        '订单状态已变化，请查询支付结果',
      );
    await this.alipay.recordEvent({
      action: 'order.cancelled',
      status: 'success',
      orderId: order.id,
      orderNo: order.orderNo,
      amount: order.amount.toFixed(2),
      actorId,
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'update',
      resourceType: 'membership_order',
      resourceId: orderId,
    });
  }

  /**
   * 已支付订单退款。
   */
  async refundOrder(orderId: string, dto: RefundOrderDto, actorId: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: orderId, deletedAt: null },
    });
    if (!order)
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    if (order.status === OrderStatus.refunded)
      return this.getOrderDetail(orderId);
    if (order.status !== OrderStatus.paid)
      throw new BusinessException('ORDER_STATUS_INVALID', '仅已支付订单可退款');
    // 历史订单缺少权益快照，禁止猜测扣减用户时长，应先人工核对补齐快照。
    if (
      !order.entitlementStartAt ||
      !order.entitlementEndAt ||
      !order.entitlementChainId
    ) {
      throw new BusinessException(
        'REFUND_SNAPSHOT_MISSING',
        '历史订单缺少权益快照，请先核对会员有效期',
      );
    }
    if (!['alipay', 'wechat', 'mock'].includes(order.paymentChannel ?? '')) {
      throw new BusinessException(
        'REFUND_CHANNEL_UNSUPPORTED',
        '该订单渠道不支持自动退款',
      );
    }
    await this.prisma.membershipOrder.updateMany({
      where: { id: orderId, status: OrderStatus.paid, refundRequestedAt: null },
      data: { refundRequestedAt: new Date(), refundReason: dto.reason },
    });
    await this.alipay.recordEvent({
      action: 'refund.requested',
      status: 'pending',
      orderId: order.id,
      orderNo: order.orderNo,
      amount: order.amount.toFixed(2),
      actorId,
      message: dto.reason,
    });
    // 外部调用放在数据库事务外；同一订单始终使用 RF + orderNo，失败可安全重试。
    if (order.paymentChannel === 'alipay')
      await this.alipay.refundTrade(
        order.orderNo,
        order.amount.toFixed(2),
        dto.reason,
      );
    if (order.paymentChannel === 'wechat') {
      await this.requireWechat().refundTrade(
        order.orderNo,
        order.amount.toFixed(2),
        dto.reason,
      );
    }
    const now = new Date();
    const applied = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${order.buyerId} FOR UPDATE`;
      const current = await tx.membershipOrder.findUniqueOrThrow({
        where: { id: orderId },
      });
      if (current.status === OrderStatus.refunded) return false;
      if (current.status !== OrderStatus.paid)
        throw new BusinessException(
          'ORDER_STATUS_INVALID',
          '退款订单状态已变化',
        );
      const start = current.entitlementStartAt!;
      const end = current.entitlementEndAt!;
      const cutoff = current.refundRequestedAt ?? now;
      const remainingMs = Math.max(
        0,
        end.getTime() - Math.max(cutoff.getTime(), start.getTime()),
      );
      const subscriptions = await tx.userSubscription.findMany({
        where: {
          userId: order.buyerId,
          deletedAt: null,
          status: SubscriptionStatus.active,
          entitlementChainId: current.entitlementChainId,
        },
      });
      for (const sub of subscriptions) {
        // 仅扣除此订单未消费的时长，保留其他续费；不延长已过期订阅。
        const nextEnd = new Date(
          Math.max(sub.startAt.getTime(), sub.endAt.getTime() - remainingMs),
        );
        await tx.userSubscription.update({
          where: { id: sub.id },
          data: {
            endAt: nextEnd,
            ...(nextEnd <= now ? { status: SubscriptionStatus.cancelled } : {}),
          },
        });
      }
      const later = await tx.membershipOrder.findMany({
        where: {
          buyerId: order.buyerId,
          status: OrderStatus.paid,
          entitlementChainId: current.entitlementChainId,
          id: { not: orderId },
          entitlementStartAt: { gte: end },
        },
      });
      for (const next of later) {
        await tx.membershipOrder.update({
          where: { id: next.id },
          data: {
            entitlementStartAt: new Date(
              next.entitlementStartAt!.getTime() - remainingMs,
            ),
            entitlementEndAt: new Date(
              next.entitlementEndAt!.getTime() - remainingMs,
            ),
          },
        });
      }
      await tx.refundRecord.create({
        data: {
          orderId,
          amount: order.amount,
          reason: current.refundReason,
          tradeNo: `RF${order.orderNo}`,
          createdBy: actorId,
        },
      });
      await tx.membershipOrder.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.refunded,
          refundedAt: now,
          paymentCodeUrl: null,
        },
      });
      await tx.paymentRecord.updateMany({
        where: { orderId, status: PaymentStatus.success },
        data: { status: PaymentStatus.refunded },
      });
      return true;
    });
    if (!applied) return this.getOrderDetail(orderId);
    await this.alipay.recordEvent({
      action: 'refund.completed',
      status: 'success',
      orderId: order.id,
      orderNo: order.orderNo,
      tradeNo: `RF${order.orderNo}`,
      amount: order.amount.toFixed(2),
      actorId,
    });
    await this.auditLogWriter.write({
      actorId,
      action: 'refund',
      resourceType: 'membership_order',
      resourceId: orderId,
    });
    await this.notifications.refund(
      order.buyerId,
      order.orderNo,
      Number(order.amount),
      dto.reason,
    );
    return this.getOrderDetail(orderId);
  }

  /**
   * 处理回调异常订单（重试支付成功）。
   */
  async reconcileOrder(orderId: string, actorId: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: orderId, deletedAt: null },
    });
    if (!order) {
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    }
    if (order.refundRequestedAt && order.status === OrderStatus.paid) {
      return this.refundOrder(
        order.id,
        { reason: order.refundReason ?? '退款重试' },
        actorId,
      );
    }
    await this.syncPaymentOrder(order.id);
    await this.auditLogWriter.write({
      actorId,
      action: 'reconcile',
      resourceType: 'membership_order',
      resourceId: orderId,
    });
    return this.getOrderDetail(orderId);
  }

  /**
   * 按订单支付渠道查询交易，同步支付结果。
   */
  async syncPaymentOrder(orderId: string, userId?: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: {
        id: orderId,
        deletedAt: null,
        ...(userId ? { buyerId: userId } : {}),
      },
    });
    if (!order)
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    if (
      order.paymentChannel === 'wechat' &&
      ['pending', 'failed'].includes(order.status)
    ) {
      const trade = await this.requireWechat().queryTrade(order.orderNo);
      if (trade?.trade_state === 'SUCCESS') {
        await this.applyPaymentSuccess({
          orderNo: order.orderNo,
          channel: 'wechat',
          tradeNo: trade.transaction_id,
          expectedAmount: (trade.amount.total / 100).toFixed(2),
          paidAt: new Date(trade.success_time!),
        });
      } else if (
        trade &&
        ['CLOSED', 'REVOKED', 'PAYERROR'].includes(trade.trade_state ?? '')
      ) {
        await this.prisma.membershipOrder.updateMany({
          where: {
            id: order.id,
            status: { in: [OrderStatus.pending, OrderStatus.failed] },
          },
          data: {
            status: OrderStatus.cancelled,
            closedAt: new Date(),
            paymentCodeUrl: null,
          },
        });
      }
    }
    if (
      order.paymentChannel === 'alipay' &&
      (order.status === OrderStatus.pending ||
        order.status === OrderStatus.failed)
    ) {
      const trade = await this.alipay.queryTrade(order.orderNo);
      if (trade && this.alipay.isTradeSuccess(trade.tradeStatus)) {
        await this.applyPaymentSuccess({
          orderNo: order.orderNo,
          channel: 'alipay',
          tradeNo: trade.tradeNo,
          expectedAmount: trade.totalAmount,
          paidAt: trade.sendPayDate
            ? new Date(trade.sendPayDate.replace(' ', 'T') + '+08:00')
            : undefined,
        });
      } else if (trade?.tradeStatus === 'TRADE_CLOSED') {
        await this.prisma.membershipOrder.updateMany({
          where: {
            id: order.id,
            status: { in: [OrderStatus.pending, OrderStatus.failed] },
          },
          data: { status: OrderStatus.cancelled, closedAt: new Date() },
        });
      }
    }
    const updated = await this.prisma.membershipOrder.findUniqueOrThrow({
      where: { id: orderId },
    });
    return {
      id: updated.id,
      orderNo: updated.orderNo,
      status: updated.status,
      amount: Number(updated.amount),
    };
  }

  async syncUserPaymentOrder(userId: string, orderNo: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { orderNo, buyerId: userId, deletedAt: null },
    });
    if (!order)
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    return this.syncPaymentOrder(order.id, userId);
  }

  async cancelUserOrder(userId: string, orderId: string) {
    const order = await this.prisma.membershipOrder.findFirst({
      where: { id: orderId, buyerId: userId, deletedAt: null },
    });
    if (!order)
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    return this.cancelOrder(orderId, userId);
  }

  async listOrderRefunds(orderId: string) {
    return this.prisma.refundRecord.findMany({
      where: { orderId },
      orderBy: { refundedAt: 'desc' },
    });
  }

  async pagePaymentOperationLogs(
    query: MembershipPageQueryDto,
    filters: { orderNo?: string; action?: string; status?: string },
  ) {
    const { skip, take } = query.toSkipTake();
    const where: Prisma.PaymentOperationLogWhereInput = {
      ...(filters.orderNo
        ? { orderNo: { contains: filters.orderNo.trim() } }
        : {}),
      ...(filters.action ? { action: filters.action.trim() } : {}),
      ...(filters.status ? { status: filters.status.trim() } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.paymentOperationLog.count({ where }),
      this.prisma.paymentOperationLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
    ]);
    return new PageResultDto(rows, total, query.page, query.pageSize);
  }

  /**
   * 用户端可售套餐目录（普通版 / Plus / Pro）。
   */
  async getUserFacingCatalog() {
    const levelFeatureMap: Record<string, string[]> = {
      normal: [
        '每月赠送 5,000 算力积分',
        '公共数据基础检索与摘要',
        '单文件知识问答',
        '单主题分析',
        '导出表格与基础图表',
      ],
      plus: [
        '每月赠送 12,000 算力积分',
        '完整公共数据检索与深度分析',
        '多文件联合问答',
        '跨文件/地区分析',
        '带来源研究报告导出',
      ],
      pro: [
        '每月赠送 26,000 算力积分',
        '批量多主题分析',
        '完整检索与私有数据研究',
        '长篇报告与批量导出',
        '高频深度研究支持',
      ],
    };
    const levelScenarioMap: Record<string, string> = {
      normal: '日常轻度研究',
      plus: '持续研究',
      pro: '高频深度研究',
    };

    const [levels, packages, rules] = await Promise.all([
      this.prisma.membershipLevel.findMany({
        where: {
          deletedAt: null,
          status: CommonStatus.active,
          isPurchasable: true,
        },
        select: {
          id: true,
          code: true,
          name: true,
          monthlyPoints: true,
          description: true,
          sort: true,
        },
        orderBy: { sort: 'asc' },
      }),
      this.prisma.membershipPackage.findMany({
        where: {
          deletedAt: null,
          status: CommonStatus.active,
          tag: { not: PackageTag.off_shelf },
          level: {
            deletedAt: null,
            status: CommonStatus.active,
            isPurchasable: true,
          },
        },
        include: {
          level: {
            select: { id: true, code: true, name: true, monthlyPoints: true },
          },
        },
        orderBy: [{ sort: 'asc' }],
      }),
      this.getPointRulesConfig(),
    ]);

    const monthlyPriceByLevel = new Map<string, number>();
    for (const pkg of packages) {
      if (pkg.packageType === PackageType.monthly) {
        monthlyPriceByLevel.set(pkg.levelId, Number(pkg.price));
      }
    }

    return {
      editions: levels.map((level) => ({
        code: level.code,
        name: level.name,
        available: true,
        monthlyPoints: level.monthlyPoints,
        monthlyLimit: level.monthlyPoints + rules.freeMonthlyLimit,
        scenario: levelScenarioMap[level.code] ?? '研究会员',
        features: (
          levelFeatureMap[level.code] ?? [
            `每月赠送 ${level.monthlyPoints.toLocaleString()} 算力积分`,
          ]
        ).map((text) =>
          text.replace(
            /每月赠送 [\d,]+ 算力积分/,
            `每月赠送 ${level.monthlyPoints.toLocaleString()} 算力积分`,
          ),
        ),
        description: level.description,
      })),
      packages: packages.map((pkg) => ({
        id: pkg.id,
        name: pkg.name,
        packageType: pkg.packageType,
        price: Number(pkg.price),
        originalPrice:
          pkg.originalPrice === null || pkg.originalPrice === undefined
            ? null
            : Number(pkg.originalPrice),
        priceLabel: pkg.priceLabel,
        description: pkg.description,
        tag: pkg.tag,
        durationDays: pkg.durationDays,
        levelCode: pkg.level.code,
        levelName: pkg.level.name,
        monthlyPoints: pkg.level.monthlyPoints,
        renewPrice: monthlyPriceByLevel.get(pkg.levelId) ?? null,
      })),
      compareRows: [
        {
          feature: '公共数据',
          free: '基础检索与摘要',
          normal: '基础检索与摘要',
          plus: '完整检索与深度分析',
          pro: '完整检索与深度分析',
        },
        {
          feature: '私有数据',
          free: '不可使用',
          normal: '单文件问答',
          plus: '多文件联合问答',
          pro: '完整检索与私有数据研究',
        },
        {
          feature: '分析能力',
          free: '简单问答',
          normal: '单主题分析',
          plus: '跨文件/地区分析',
          pro: '批量多主题分析',
        },
        {
          feature: '导出能力',
          free: '仅页面预览',
          normal: '表格与基础图表',
          plus: '带来源研究报告',
          pro: '长篇报告与批量导出',
        },
        {
          feature: '适用场景',
          free: '体验与轻度问答',
          normal: '日常轻度研究',
          plus: '持续研究',
          pro: '高频深度研究',
        },
        {
          feature: '月赠送积分',
          free: '—',
          normal: '5,000',
          plus: '12,000',
          pro: '26,000',
        },
        {
          feature: '月度最高积分',
          free: rules.freeMonthlyLimit.toLocaleString(),
          normal: (5_000 + rules.freeMonthlyLimit).toLocaleString(),
          plus: (12_000 + rules.freeMonthlyLimit).toLocaleString(),
          pro: (26_000 + rules.freeMonthlyLimit).toLocaleString(),
        },
      ].map((row) => {
        const byCode = Object.fromEntries(
          levels.map((level) => [level.code, level]),
        ) as Record<string, (typeof levels)[number]>;
        if (row.feature === '月赠送积分') {
          return {
            ...row,
            normal: (byCode.normal?.monthlyPoints ?? 5_000).toLocaleString(),
            plus: (byCode.plus?.monthlyPoints ?? 12_000).toLocaleString(),
            pro: (byCode.pro?.monthlyPoints ?? 26_000).toLocaleString(),
          };
        }
        if (row.feature === '月度最高积分') {
          return {
            ...row,
            free: rules.freeMonthlyLimit.toLocaleString(),
            normal: (
              (byCode.normal?.monthlyPoints ?? 5_000) + rules.freeMonthlyLimit
            ).toLocaleString(),
            plus: (
              (byCode.plus?.monthlyPoints ?? 12_000) + rules.freeMonthlyLimit
            ).toLocaleString(),
            pro: (
              (byCode.pro?.monthlyPoints ?? 26_000) + rules.freeMonthlyLimit
            ).toLocaleString(),
          };
        }
        return row;
      }),
      discountTip:
        '季付按月价 7 折，年付按月价 6 折；季付/年付为一次付清、到期手动续费。连续包月首月 7 折（每账号限一次）。',
      todayActivatedCount: 186,
    };
  }

  /**
   * 用户端会员状态与剩余免费体验次数。
   */
  async getUserMembershipStatus(userId: string) {
    const now = new Date();
    const subscription = await this.prisma.userSubscription.findFirst({
      where: {
        userId,
        ...activeUserSubscriptionWhere(now),
      },
      include: {
        level: { select: { id: true, code: true, name: true } },
      },
      orderBy: { endAt: 'desc' },
    });

    const isMember = Boolean(subscription);
    const usedTrials = isMember
      ? 0
      : await this.prisma.researchRun.count({
          where: {
            userId,
            status: ResearchRunStatus.COMPLETED,
          },
        });
    const remainingTrials = isMember
      ? null
      : Math.max(0, FREE_SEARCH_TRIAL_QUOTA - usedTrials);
    const points = await this.getPointSummary(userId);
    const rules = await this.getPointRulesConfig();
    const minSearchPoints = Math.max(0, rules.minSearchPoints);

    return {
      isMember,
      remainingTrials,
      trialQuota: FREE_SEARCH_TRIAL_QUOTA,
      canSearch: points.balance >= minSearchPoints,
      minSearchPoints,
      pointsBalance: points.balance,
      levelCode: subscription?.level.code ?? null,
      levelName: subscription?.level.name ?? null,
      endAt: subscription ? formatAdminDate(subscription.endAt) : null,
      autoRenew: subscription?.autoRenew ?? false,
    };
  }

  /** 返回积分账户，同时按当前月份补齐应发额度（可重复调用）。 */
  async getPointSummary(userId: string) {
    const now = new Date();
    const rules = await this.getPointRulesConfig();
    const subscription = await this.prisma.userSubscription.findFirst({
      where: { userId, ...activeUserSubscriptionWhere(now) },
      include: {
        level: { select: { code: true, name: true, monthlyPoints: true } },
      },
      orderBy: { endAt: 'desc' },
    });
    const membershipPoints = subscription?.level.monthlyPoints ?? 0;
    await this.ensureMonthlyPoints(userId, subscription?.id, membershipPoints);
    const [account, ledgers, levels] = await this.prisma.$transaction([
      this.prisma.pointAccount.findUniqueOrThrow({ where: { userId } }),
      this.prisma.pointLedger.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.membershipLevel.findMany({
        where: { deletedAt: null, status: CommonStatus.active },
        select: { code: true, name: true, monthlyPoints: true },
        orderBy: { sort: 'asc' },
      }),
    ]);
    const monthKey = this.monthKey(now);
    const monthlyLimit = membershipPoints + rules.freeMonthlyLimit;
    // 月度消费统计不能只统计最近 20 条智搜流水，学习及退款也必须纳入。
    const monthlyConsumption = await this.prisma.pointLedger.aggregate({
      where: { userId, source: { in: ['consume', 'refund'] }, createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } },
      _sum: { amount: true },
    });
    const monthlyUsed = Math.max(0, -(monthlyConsumption._sum.amount ?? 0));
    const dailyClaimed = await this.prisma.pointLedger.findUnique({
      where: {
        userId_reference: { userId, reference: `daily:${this.dayKey(now)}` },
      },
    });
    return {
      balance: account.balance,
      totalEarned: ledgers
        .filter((item) => item.amount > 0 && item.source !== 'refund')
        .reduce((total, item) => total + item.amount, 0),
      monthlyUsed,
      monthlyLimit,
      membership: subscription
        ? {
            levelName: subscription.level.name,
            endAt: formatAdminDate(subscription.endAt),
          }
        : null,
      daily: { amount: rules.dailyPoints, claimed: Boolean(dailyClaimed) },
      rules: {
        registrationPoints: rules.registrationPoints,
        monthlyFreePoints: rules.monthlyFreePoints,
        dailyPoints: rules.dailyPoints,
        freeMonthlyLimit: rules.freeMonthlyLimit,
        searchCostPoints: rules.searchCostPoints,
        minSearchPoints: rules.minSearchPoints,
        yuanPerPoint: rules.yuanPerPoint,
        levels: levels.map((item) => ({
          code: item.code,
          name: item.name,
          monthlyPoints: item.monthlyPoints,
        })),
      },
      ledgers: ledgers.map((item) => ({
        ...item,
        createdAt: formatAdminDateTime(item.createdAt),
      })),
    };
  }

  /** 当前用户积分流水分页。 */
  async pageUserPointLedgers(userId: string, query: UserBillingQueryDto) {
    const { skip, take } = query.toSkipTake();
    const where: Prisma.PointLedgerWhereInput = { userId };
    const [total, ledgers] = await this.prisma.$transaction([
      this.prisma.pointLedger.count({ where }),
      this.prisma.pointLedger.findMany({
        where,
        skip,
        take,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    ]);
    return new PageResultDto(
      ledgers.map((item) => ({
        ...item,
        createdAt: formatAdminDateTime(item.createdAt),
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  /** 管理端积分账户列表，汇总当月消耗和当前有效会员。 */
  async pagePointAccounts(query: MembershipPageQueryDto) {
    const { skip, take } = query.toSkipTake();
    const keyword = query.keyword?.trim();
    const now = new Date();
    const rules = await this.getPointRulesConfig();
    const monthKey = this.monthKey(now);
    const monthPrefix = `consume:${monthKey}:`;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(keyword
        ? {
            OR: [
              { username: { contains: keyword, mode: 'insensitive' } },
              {
                profile: {
                  displayName: { contains: keyword, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [total, users] = await this.prisma.$transaction([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          profile: { select: { displayName: true } },
          pointAccount: true,
          subscriptions: {
            where: activeUserSubscriptionWhere(now),
            include: {
              level: {
                select: { code: true, name: true, monthlyPoints: true },
              },
            },
            orderBy: { endAt: 'desc' },
            take: 1,
          },
          pointLedgers: {
            where: {
              OR: [
                { source: { in: ['consume', 'refund'] }, createdAt: { gte: startOfMonth } },
                {
                  amount: { gt: 0 },
                  source: { in: ['registration', 'free_monthly', 'daily'] },
                  createdAt: { gte: startOfMonth },
                },
              ],
            },
            select: { amount: true, createdAt: true, source: true },
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
    ]);
    const items = users.map((user) => {
      const subscription = user.subscriptions[0];
      const membershipPoints = subscription?.level.monthlyPoints ?? 0;
      const monthlyLimit = membershipPoints + rules.freeMonthlyLimit;
      const consumeLedgers = user.pointLedgers.filter(
        (item) => item.amount < 0,
      );
      const monthlyUsed = Math.max(0, -user.pointLedgers
        .filter((item) => ['consume', 'refund'].includes(item.source))
        .reduce((sum, item) => sum + item.amount, 0));
      const freeGrantedThisMonth = user.pointLedgers
        .filter((item) => item.amount > 0 && item.source !== 'refund')
        .reduce((sum, item) => sum + item.amount, 0);
      return {
        userId: user.id,
        username: user.username,
        displayName: user.profile?.displayName ?? null,
        levelName: subscription?.level.name ?? '免费版',
        levelCode: subscription?.level.code ?? 'free',
        freeGrantedThisMonth,
        freeMonthlyLimit: rules.freeMonthlyLimit,
        membershipMonthlyPoints: membershipPoints || null,
        monthlyLimit,
        monthlyUsed,
        lastConsumedAt: consumeLedgers[0]?.createdAt
          ? formatAdminDateTime(consumeLedgers[0].createdAt)
          : null,
        balance: user.pointAccount?.balance ?? 0,
        status: user.status,
      };
    });
    return new PageResultDto(items, total, query.page, query.pageSize);
  }

  /** 管理端查看单一用户的积分流水。 */
  async listPointLedgers(userId: string) {
    return this.prisma.pointLedger.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /** 每日领取积分，同一天由唯一流水约束保证只能领取一次。 */
  async claimDailyPoints(userId: string) {
    const now = new Date();
    const rules = await this.getPointRulesConfig();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const freeGranted = await this.prisma.pointLedger.aggregate({
      where: {
        userId,
        amount: { gt: 0 },
        source: { in: ['registration', 'free_monthly', 'daily'] },
        createdAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });
    if (
      (freeGranted._sum.amount ?? 0) + rules.dailyPoints >
      rules.freeMonthlyLimit
    ) {
      throw new BusinessException(
        'FREE_POINTS_MONTHLY_LIMIT_REACHED',
        '本月免费赠送积分已达上限',
        409,
      );
    }
    const reference = `daily:${this.dayKey(now)}`;
    const credited = await this.creditPoints(
      userId,
      rules.dailyPoints,
      'daily',
      reference,
      '每日积分领取',
    );
    if (!credited)
      throw new BusinessException(
        'DAILY_POINTS_CLAIMED',
        '今日积分已领取',
        409,
      );
    return this.getPointSummary(userId);
  }

  /** 按管理端配置扣除每次请求积分，余额不足时拒绝请求。 */
  async consumeSearchPoints(userId: string, reference: string) {
    const rules = await this.getPointRulesConfig();
    const cost = Math.max(1, rules.searchCostPoints);
    const minSearchPoints = Math.max(0, rules.minSearchPoints);
    const summary = await this.getPointSummary(userId);
    if (summary.balance < minSearchPoints) {
      throw new BusinessException(
        'POINTS_INSUFFICIENT',
        `当前积分低于 ${minSearchPoints}，暂无法使用 AI 智搜，请领取积分或升级会员`,
        403,
      );
    }
    if (summary.balance < cost) {
      throw new BusinessException(
        'POINTS_INSUFFICIENT',
        `当前积分不足（本次需 ${cost} 积分），请领取积分或升级会员`,
        403,
      );
    }
    await this.creditPoints(
      userId,
      -cost,
      'consume',
      `consume:${this.monthKey(new Date())}:${reference}`,
      `AI 智搜消耗 ${cost} 积分`,
    );
  }

  /** 学习余额准入仅校验有可用积分；最终费用取供应商实际 usage。 */
  async assertCanLearnKnowledge(userId: string): Promise<void> {
    const rules = await this.getPointRulesConfig();
    const model = this.config.get<string>('EMBEDDING_MODEL');
    if (!model || !(rules.modelPricing[model] ?? rules.modelPricing.default)) {
      throw new BusinessException('MODEL_PRICING_MISSING', '请先配置学习向量模型的 Token 单价', 503);
    }
    const summary = await this.getPointSummary(userId);
    if (summary.balance < 1) {
      throw new BusinessException('POINTS_INSUFFICIENT', '当前积分不足，无法开始文档学习', 403);
    }
  }

  /** 每次执行按实际用量结算；相同引用重放不会重复扣费。 */
  async consumeKnowledgeLearningPoints(userId: string, reference: string, usage: LlmUsageRecord[]): Promise<void> {
    await this.consumeLlmUsagePoints(userId, `knowledge:${reference}`, usage, '文档学习');
  }

  /** 根据供应商返回的实际 token 用量结算一次智搜，不再使用固定扣分。 */
  async consumeLlmUsagePoints(
    userId: string,
    reference: string,
    usage: LlmUsageRecord[],
    activity = 'AI 智搜',
  ): Promise<void> {
    const rules = await this.getPointRulesConfig();
    const pricing = rules.modelPricing;
    let costYuan = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    for (const item of usage) {
      const price = pricing[item.model] ?? pricing.default;
      if (!price) {
        throw new BusinessException('MODEL_PRICING_MISSING', `未配置模型 ${item.model} 的 Token 单价`, 503);
      }
      if (![item.promptTokens, item.completionTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) {
        throw new BusinessException('TOKEN_USAGE_INVALID', '供应商 Token 用量异常', 500);
      }
      promptTokens += item.promptTokens;
      completionTokens += item.completionTokens;
      costYuan +=
        (item.promptTokens * price.inputYuanPerMillionTokens) / 1_000_000;
      costYuan +=
        (item.completionTokens * price.outputYuanPerMillionTokens) / 1_000_000;
    }
    if (costYuan <= 0) return;
    const points = Math.ceil(costYuan / rules.yuanPerPoint);
    if (!Number.isSafeInteger(points) || points < 1) {
      throw new BusinessException(
        'POINTS_COST_INVALID',
        '本次 Token 费用计算异常',
        500,
      );
    }
    await this.creditPoints(
      userId,
      -points,
      'consume',
      activity === '文档学习' ? reference : `consume:${this.monthKey(new Date())}:${reference}`,
      `${activity}消耗 ${points} 积分（输入 ${promptTokens} Token，输出 ${completionTokens} Token）`,
    );
  }

  private readModelPricing(): Record<
    string,
    { inputYuanPerMillionTokens: number; outputYuanPerMillionTokens: number }
  > {
    const raw = this.config.get<string>('LLM_MODEL_PRICING_JSON');
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<
        string,
        {
          inputYuanPerMillionTokens?: unknown;
          outputYuanPerMillionTokens?: unknown;
        }
      >;
      return Object.fromEntries(
        Object.entries(parsed).flatMap(([model, value]) => {
          const input = Number(value?.inputYuanPerMillionTokens);
          const output = Number(value?.outputYuanPerMillionTokens);
          return Number.isFinite(input) &&
            input >= 0 &&
            Number.isFinite(output) &&
            output >= 0
            ? [
                [
                  model,
                  {
                    inputYuanPerMillionTokens: input,
                    outputYuanPerMillionTokens: output,
                  },
                ],
              ]
            : [];
        }),
      );
    } catch {
      throw new BusinessException(
        'LLM_PRICING_INVALID',
        '模型 Token 单价配置格式错误',
        500,
      );
    }
  }

  private toModelPricing(
    items: {
      model: string;
      inputYuanPerMillionTokens: number;
      outputYuanPerMillionTokens: number;
    }[],
  ) {
    const pricing: Record<
      string,
      { inputYuanPerMillionTokens: number; outputYuanPerMillionTokens: number }
    > = {};
    for (const item of items) {
      const model = item.model.trim();
      if (!model || pricing[model]) {
        throw new BusinessException(
          'MODEL_PRICING_INVALID',
          '模型名称不能为空且不能重复',
          400,
        );
      }
      pricing[model] = {
        inputYuanPerMillionTokens: item.inputYuanPerMillionTokens,
        outputYuanPerMillionTokens: item.outputYuanPerMillionTokens,
      };
    }
    return pricing;
  }

  private normalizeModelPricing(
    value: unknown,
  ): Record<
    string,
    { inputYuanPerMillionTokens: number; outputYuanPerMillionTokens: number }
  > {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return this.readModelPricing();
    const pricing = Object.entries(value as Record<string, unknown>).flatMap(
      ([model, item]) => {
        const candidate = item as {
          inputYuanPerMillionTokens?: unknown;
          outputYuanPerMillionTokens?: unknown;
        };
        const input = Number(candidate?.inputYuanPerMillionTokens);
        const output = Number(candidate?.outputYuanPerMillionTokens);
        return Number.isFinite(input) &&
          input >= 0 &&
          Number.isFinite(output) &&
          output >= 0
          ? [
              [
                model,
                {
                  inputYuanPerMillionTokens: input,
                  outputYuanPerMillionTokens: output,
                },
              ],
            ]
          : [];
      },
    );
    return pricing.length
      ? Object.fromEntries(pricing)
      : this.readModelPricing();
  }

  private async ensureMonthlyPoints(
    userId: string,
    subscriptionId?: string,
    membershipPoints = 0,
  ) {
    const rules = await this.getPointRulesConfig();
    const monthKey = this.monthKey(new Date());
    await this.creditPoints(
      userId,
      rules.registrationPoints,
      'registration',
      'registration',
      '注册赠送积分',
    );
    await this.creditPoints(
      userId,
      rules.monthlyFreePoints,
      'free_monthly',
      `free:${monthKey}`,
      '每月自动赠送积分',
    );
    if (subscriptionId && membershipPoints > 0) {
      await this.creditPoints(
        userId,
        membershipPoints,
        'membership_monthly',
        `membership:${subscriptionId}:${monthKey}`,
        '会员月度积分',
      );
    }
  }

  private async creditPoints(
    userId: string,
    amount: number,
    source: string,
    reference: string,
    description: string,
  ): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.pointAccount.upsert({
          where: { userId },
          update: {},
          create: { userId },
        });
        // 发放、消费及退款共用同一账户锁，避免并发读旧余额相互覆盖。
        const [account] = await tx.$queryRaw<{ balance: number }[]>`
          SELECT balance FROM point_accounts WHERE user_id = ${userId} FOR UPDATE
        `;
        const existing = await tx.pointLedger.findUnique({
          where: { userId_reference: { userId, reference } },
        });
        if (existing) return false;
        if (amount < 0 && account.balance + amount < 0)
          throw new BusinessException(
            'POINTS_INSUFFICIENT',
            '当前积分不足，请领取积分或升级会员',
            403,
          );
        const nextBalance = account.balance + amount;
        await tx.pointLedger.create({
          data: {
            userId,
            amount,
            balanceAfter: nextBalance,
            source,
            reference,
            description,
          },
        });
        await tx.pointAccount.update({
          where: { userId },
          data: { balance: nextBalance },
        });
        return true;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        return false;
      throw error;
    }
  }

  private monthKey(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
  }

  private dayKey(value: Date) {
    return `${this.monthKey(value)}-${String(value.getDate()).padStart(2, '0')}`;
  }

  /**
   * 积分低于最低门槛时拦截智搜。
   */
  async assertCanSearch(userId: string) {
    const status = await this.getUserMembershipStatus(userId);
    if (status.canSearch) return status;
    const minSearchPoints =
      status.minSearchPoints ?? DEFAULT_POINT_RULES.minSearchPoints;
    throw new BusinessException(
      'POINTS_INSUFFICIENT',
      `当前积分低于 ${minSearchPoints}，暂无法使用 AI 智搜，请领取积分或升级会员`,
      403,
    );
  }

  /**
   * 用户端购买：创建订单后立即 Mock 支付成功（演示环境，未对接第三方）。
   * 落库订单、支付流水与有效订阅。
   */
  async checkoutWithMockPay(userId: string, dto: CheckoutPackageDto) {
    const created = await this.createUserPendingOrder(userId, {
      packageId: dto.packageId,
    });
    return this.payUserOrder(userId, created.id, { channel: 'mock' });
  }

  /**
   * 用户端创建待支付订单（进入结算页再支付）。
   */
  async createUserPendingOrder(userId: string, dto: CreateUserOrderDto) {
    const created = await this.createOrder(
      {
        buyerType: BuyerType.user,
        buyerId: userId,
        packageId: dto.packageId,
        remark: '用户端待支付',
      },
      userId,
    );
    return {
      id: created.id,
      orderNo: created.orderNo,
      amount: Number(created.amount),
      status: created.status,
      title: created.title,
      content: created.title ? `会员缴费 · ${created.title}` : '会员缴费',
      createdAt: formatAdminDateTime(created.createdAt),
    };
  }

  /**
   * 用户端支付待支付订单（演示环境模拟成功）。
   */
  async payUserOrder(userId: string, orderId: string, dto: PayUserOrderDto) {
    const channel =
      dto.channel === 'alipay'
        ? 'alipay'
        : dto.channel === 'wechat'
          ? 'wechat'
          : dto.channel;
    const order = await this.prisma.membershipOrder.findFirst({
      where: {
        id: orderId,
        buyerId: userId,
        deletedAt: null,
      },
      include: { level: true, package: true },
    });
    if (!order) {
      throw new BusinessException('ORDER_NOT_FOUND', '订单不存在', 404);
    }
    await this.alipay.recordEvent({
      action: 'payment.requested',
      status: 'initiated',
      channel,
      orderId: order.id,
      orderNo: order.orderNo,
      amount: order.amount.toFixed(2),
      actorId: userId,
      details: { alipayMode: channel === 'alipay' ? 'page' : undefined },
    });
    if (order.status !== OrderStatus.pending) {
      await this.alipay.recordEvent({
        action: 'payment.requested',
        status: 'rejected',
        channel,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: order.amount.toFixed(2),
        actorId: userId,
        errorCode: 'ORDER_STATUS_INVALID',
      });
      throw new BusinessException('ORDER_STATUS_INVALID', '订单状态不可支付');
    }

    if (!['alipay', 'mock', 'wechat'].includes(dto.channel)) {
      await this.alipay.recordEvent({
        action: 'payment.requested',
        status: 'rejected',
        channel,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: order.amount.toFixed(2),
        actorId: userId,
        errorCode: 'PAYMENT_CHANNEL_INVALID',
      });
      throw new BusinessException('PAYMENT_CHANNEL_INVALID', '支付渠道无效');
    }
    if (order.paymentChannel && order.paymentChannel !== channel) {
      await this.alipay.recordEvent({
        action: 'payment.requested',
        status: 'rejected',
        channel,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: order.amount.toFixed(2),
        actorId: userId,
        errorCode: 'PAYMENT_CHANNEL_MISMATCH',
      });
      throw new BusinessException(
        'PAYMENT_CHANNEL_MISMATCH',
        '订单支付渠道不可切换',
      );
    }
    if (channel === 'alipay') {
      if (Date.now() >= order.createdAt.getTime() + 30 * 60000) {
        await this.alipay.recordEvent({
          action: 'payment.requested',
          status: 'rejected',
          channel,
          orderId: order.id,
          orderNo: order.orderNo,
          amount: order.amount.toFixed(2),
          actorId: userId,
          errorCode: 'ORDER_EXPIRED',
        });
        throw new BusinessException(
          'ORDER_EXPIRED',
          '订单已超过30分钟，请重新下单',
        );
      }
      if (!this.alipay.isEnabled()) {
        await this.alipay.recordEvent({
          action: 'payment.requested',
          status: 'rejected',
          channel,
          orderId: order.id,
          orderNo: order.orderNo,
          amount: order.amount.toFixed(2),
          actorId: userId,
          errorCode: 'ALIPAY_UNAVAILABLE',
        });
        throw new BusinessException(
          'ALIPAY_UNAVAILABLE',
          '支付宝配置不完整或未启用',
          503,
        );
      }
      const assigned = await this.prisma.membershipOrder.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.pending,
          OR: [{ paymentChannel: null }, { paymentChannel: 'alipay' }],
        },
        data: { paymentChannel: 'alipay' },
      });
      if (!assigned.count) {
        await this.alipay.recordEvent({
          action: 'payment.requested',
          status: 'rejected',
          channel,
          orderId: order.id,
          orderNo: order.orderNo,
          amount: order.amount.toFixed(2),
          actorId: userId,
          errorCode: 'ORDER_STATUS_INVALID',
        });
        throw new BusinessException('ORDER_STATUS_INVALID', '订单状态已变化');
      }
      const title =
        order.title ??
        (order.package
          ? `${order.level.name} · ${order.package.name}`
          : order.level.name);
      const payForm = this.alipay.createPagePayForm({
        orderNo: order.orderNo,
        subject: title,
        body: `会员缴费 · ${title}`,
        totalAmount: order.amount.toFixed(2),
        expiresAt: new Date(order.createdAt.getTime() + 30 * 60000),
      });
      await this.alipay.recordEvent({
        action: 'alipay.page.form',
        status: 'success',
        orderId: order.id,
        orderNo: order.orderNo,
        amount: order.amount.toFixed(2),
        actorId: userId,
      });
      const membership = await this.getUserMembershipStatus(userId);
      return {
        ok: true,
        channel,
        payMode: 'alipay_page' as const,
        payForm,
        message: '请在支付宝收银台完成支付',
        order: {
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          amount: Number(order.amount),
          title: order.title,
        },
        membership,
      };
    }

    if (channel === 'wechat') {
      const wechat = this.requireWechat();
      const expiresAt = new Date(order.createdAt.getTime() + 30 * 60000);
      if (Date.now() >= expiresAt.getTime()) {
        throw new BusinessException(
          'ORDER_EXPIRED',
          '订单已超过30分钟，请重新下单',
        );
      }
      // 先锁定渠道，网络超时也不允许切换渠道，避免同一订单被重复付款。
      const assigned = await this.prisma.membershipOrder.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.pending,
          OR: [{ paymentChannel: null }, { paymentChannel: 'wechat' }],
        },
        data: { paymentChannel: 'wechat' },
      });
      if (!assigned.count)
        throw new BusinessException('ORDER_STATUS_INVALID', '订单状态已变化');
      const qrCode =
        order.paymentCodeUrl ??
        (await wechat.createNativePay({
          orderNo: order.orderNo,
          subject:
            order.title ??
            `${order.level.name} · ${order.package?.name ?? '会员'}`,
          amount: order.amount.toFixed(2),
          expiresAt,
        }));
      if (!order.paymentCodeUrl) {
        await this.prisma.membershipOrder.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.pending,
            paymentChannel: 'wechat',
          },
          data: { paymentCodeUrl: qrCode },
        });
      }
      await this.alipay.recordEvent({
        action: 'wechat.native',
        status: 'success',
        channel,
        orderId: order.id,
        orderNo: order.orderNo,
        amount: order.amount.toFixed(2),
        actorId: userId,
      });
      return {
        ok: true,
        channel,
        payMode: 'wechat_native' as const,
        qrCode,
        expiresAt: expiresAt.toISOString(),
        message: '请使用微信扫码支付',
        order: {
          id: order.id,
          orderNo: order.orderNo,
          status: order.status,
          amount: Number(order.amount),
          title: order.title,
        },
        membership: await this.getUserMembershipStatus(userId),
      };
    }

    await this.mockPayCallback({ orderNo: order.orderNo, channel });

    const [detail, membership] = await Promise.all([
      this.getOrderDetail(order.id),
      this.getUserMembershipStatus(userId),
    ]);
    return {
      ok: true,
      channel,
      payMode: 'mock' as const,
      message: '演示环境已模拟支付成功',
      order: detail,
      membership,
    };
  }

  /**
   * 用户端订单列表（仅当前用户）。
   */
  async listUserOrders(userId: string, query: UserBillingQueryDto) {
    const createdAt = this.resolveCreatedAtFilter(query.timeRange);
    const status = this.resolveOrderStatusFilter(query.status);
    const where: Prisma.MembershipOrderWhereInput = {
      deletedAt: null,
      buyerId: userId,
      ...(createdAt ? { createdAt } : {}),
      ...(status ? { status } : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.membershipOrder.count({ where }),
      this.prisma.membershipOrder.findMany({
        where,
        skip,
        take,
        include: {
          level: { select: { name: true } },
          package: { select: { name: true } },
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return new PageResultDto(
      rows.map((order) => {
        const latestPayment = order.payments[0];
        return {
          id: order.id,
          orderNo: order.orderNo,
          content: order.title
            ? `会员缴费 · ${order.title}`
            : `会员缴费 · ${order.level.name}`,
          amount: Number(order.amount),
          paymentChannel: latestPayment?.channel ?? order.paymentChannel,
          status: order.status,
          createdAt: formatAdminDateTime(order.createdAt),
          expiresAt: new Date(
            order.createdAt.getTime() + 30 * 60000,
          ).toISOString(),
          paidAt: order.paidAt ? formatAdminDateTime(order.paidAt) : null,
        };
      }),
      total,
      query.page,
      query.pageSize,
    );
  }

  /**
   * 用户端支付流水（仅当前用户订单下的流水）。
   */
  async listUserPayments(userId: string, query: UserBillingQueryDto) {
    const createdAt = this.resolveCreatedAtFilter(query.timeRange);
    const status = this.resolvePaymentStatusFilter(query.status);
    const where: Prisma.PaymentRecordWhereInput = {
      order: {
        buyerId: userId,
        deletedAt: null,
      },
      ...(createdAt ? { createdAt } : {}),
      ...(status ? { status } : {}),
    };
    const { skip, take } = query.toSkipTake();
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.paymentRecord.count({ where }),
      this.prisma.paymentRecord.findMany({
        where,
        skip,
        take,
        include: {
          order: { select: { orderNo: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return new PageResultDto(
      rows.map((payment) => ({
        id: payment.id,
        tradeNo: payment.tradeNo,
        channel: payment.channel,
        orderNo: payment.order.orderNo,
        amount: Number(payment.amount),
        paidAt: payment.paidAt
          ? formatAdminDateTime(payment.paidAt)
          : formatAdminDateTime(payment.createdAt),
        status: payment.status,
      })),
      total,
      query.page,
      query.pageSize,
    );
  }

  private resolveCreatedAtFilter(
    timeRange?: string,
  ): Prisma.DateTimeFilter | undefined {
    if (!timeRange || timeRange === 'all') return undefined;
    const days =
      timeRange === '7d'
        ? 7
        : timeRange === '30d'
          ? 30
          : timeRange === '90d'
            ? 90
            : 0;
    if (!days) return undefined;
    const gte = new Date();
    gte.setDate(gte.getDate() - days);
    return { gte };
  }

  private resolveOrderStatusFilter(status?: string): OrderStatus | undefined {
    if (!status || status === 'all') return undefined;
    if ((Object.values(OrderStatus) as string[]).includes(status)) {
      return status as OrderStatus;
    }
    return undefined;
  }

  private resolvePaymentStatusFilter(
    status?: string,
  ): PaymentStatus | undefined {
    if (!status || status === 'all') return undefined;
    if ((Object.values(PaymentStatus) as string[]).includes(status)) {
      return status as PaymentStatus;
    }
    return undefined;
  }
}
