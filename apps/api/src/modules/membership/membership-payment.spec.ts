import { Prisma } from '@prisma/client';
import { MembershipService } from './membership.service';

describe('membership payment lifecycle', () => {
  const paidAt = new Date('2026-11-03T00:00:00Z');
  let service: MembershipService;
  let order: any;
  let tx: any;
  let prisma: any;
  let alipay: any;
  let notifications: any;
  let wechat: any;
  beforeEach(() => {
    order = {
      id: 'id',
      orderNo: 'O1',
      buyerId: 'u',
      paymentChannel: 'alipay',
      status: 'pending',
      amount: new Prisma.Decimal('9.90'),
      durationDays: 30,
      level: { name: 'Plus' },
      levelId: 'level',
      createdAt: new Date(),
      entitlementChainId: 'id',
      entitlementStartAt: paidAt,
      entitlementEndAt: new Date(paidAt.getTime() + 30 * 86400000),
    };
    tx = {
      $queryRaw: jest.fn(),
      membershipOrder: {
        findUniqueOrThrow: jest.fn(async () => order),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      paymentRecord: {
        create: jest.fn(),
        findFirst: jest.fn().mockResolvedValue({ tradeNo: 'T1' }),
        updateMany: jest.fn(),
      },
      userSubscription: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refundRecord: { create: jest.fn() },
    };
    prisma = {
      membershipOrder: {
        findUnique: jest.fn(async () => order),
        findFirst: jest.fn(async () => order),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest.fn(async (fn) => fn(tx)),
    };
    alipay = {
      recordEvent: jest.fn().mockResolvedValue(undefined),
      queryTrade: jest.fn(),
      closeTrade: jest.fn(),
      refundTrade: jest.fn(),
      isTradeSuccess: jest.fn((s) => s === 'TRADE_SUCCESS'),
    };
    notifications = {
      paymentSuccess: jest.fn(),
      membershipActivated: jest.fn(),
      refund: jest.fn(),
    };
    wechat = {
      isEnabled: jest.fn().mockReturnValue(true),
      createNativePay: jest.fn().mockResolvedValue('weixin://wxpay/test'),
      queryTrade: jest.fn(),
      closeTrade: jest.fn(),
      refundTrade: jest.fn(),
    };
    service = new MembershipService(
      prisma,
      {} as any,
      {} as any,
      { write: jest.fn() } as any,
      notifications,
      { get: () => 'false' } as any,
      alipay,
      wechat,
    );
    jest.spyOn(service, 'getOrderDetail').mockResolvedValue({} as any);
  });
  it.each([undefined, 'page', 'qr'] as const)(
    'uses page pay for mode %s without calling precreate',
    async (alipayMode) => {
      alipay.isEnabled = jest.fn().mockReturnValue(true);
      alipay.createPagePayForm = jest.fn().mockReturnValue('<form></form>');
      alipay.createQrPayCode = jest.fn();
      jest
        .spyOn(service, 'getUserMembershipStatus')
        .mockResolvedValue({} as any);
      const result = await service.payUserOrder('u', 'id', {
        channel: 'alipay',
        alipayMode,
      });
      expect(result.payMode).toBe('alipay_page');
      expect(result.payForm).toBe('<form></form>');
      expect(alipay.createPagePayForm).toHaveBeenCalledWith(
        expect.objectContaining({ orderNo: 'O1', totalAmount: '9.90' }),
      );
      expect(alipay.createQrPayCode).not.toHaveBeenCalled();
      expect(tx.paymentRecord.create).not.toHaveBeenCalled();
    },
  );

  it('returns an absolute payment deadline matching the 30-minute server limit', async () => {
    order.createdAt = new Date('2026-11-05T11:00:00+08:00');
    order.payments = [];
    prisma.membershipOrder.count = jest.fn().mockResolvedValue(1);
    prisma.membershipOrder.findMany = jest.fn().mockResolvedValue([order]);
    prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) =>
      Promise.all(queries),
    );
    const result = await service.listUserOrders('u', {
      page: 1,
      pageSize: 50,
      toSkipTake: () => ({ skip: 0, take: 50 }),
    } as any);
    expect(result.items[0].expiresAt).toBe('2026-11-05T03:30:00.000Z');
  });

  it('creates a Native payment for 0.01 yuan and locks the order channel', async () => {
    order.amount = new Prisma.Decimal('0.01');
    order.paymentChannel = null;
    jest.spyOn(service, 'getUserMembershipStatus').mockResolvedValue({} as any);
    const result = await service.payUserOrder('u', 'id', {
      channel: 'wechat',
    } as any);
    expect(result).toMatchObject({
      payMode: 'wechat_native',
      qrCode: 'weixin://wxpay/test',
    });
    expect(wechat.createNativePay).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: 'O1', amount: '0.01' }),
    );
    expect(prisma.membershipOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ paymentChannel: null }, { paymentChannel: 'wechat' }],
        }),
        data: { paymentChannel: 'wechat' },
      }),
    );
  });

  it('creates an Alipay page payment for 0.01 yuan', async () => {
    order.amount = new Prisma.Decimal('0.01');
    alipay.isEnabled = jest.fn().mockReturnValue(true);
    alipay.createPagePayForm = jest.fn().mockReturnValue('<form></form>');
    jest.spyOn(service, 'getUserMembershipStatus').mockResolvedValue({} as any);

    await service.payUserOrder('u', 'id', { channel: 'alipay' });

    expect(alipay.createPagePayForm).toHaveBeenCalledWith(
      expect.objectContaining({ orderNo: 'O1', totalAmount: '0.01' }),
    );
  });

  it('reuses the saved WeChat QR after the page or modal is reopened', async () => {
    order.paymentChannel = 'wechat';
    order.paymentCodeUrl = 'weixin://wxpay/saved';
    jest.spyOn(service, 'getUserMembershipStatus').mockResolvedValue({} as any);
    const result = await service.payUserOrder('u', 'id', {
      channel: 'wechat',
    } as any);
    expect(result).toMatchObject({ qrCode: 'weixin://wxpay/saved' });
    expect(wechat.createNativePay).not.toHaveBeenCalled();
  });

  it('does not create a WeChat transaction after order expiry', async () => {
    order.paymentChannel = null;
    order.createdAt = new Date(Date.now() - 31 * 60_000);
    await expect(
      service.payUserOrder('u', 'id', { channel: 'wechat' } as any),
    ).rejects.toThrow('订单已超过30分钟');
    expect(wechat.createNativePay).not.toHaveBeenCalled();
    expect(prisma.membershipOrder.updateMany).not.toHaveBeenCalled();
  });

  it('keeps membership rights while a WeChat refund is pending', async () => {
    order.status = 'paid';
    order.paymentChannel = 'wechat';
    wechat.refundTrade.mockRejectedValue(new Error('pending'));
    await expect(
      service.refundOrder('id', { reason: 'test' }, 'admin'),
    ).rejects.toThrow('pending');
    expect(prisma.membershipOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundRequestedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.refundRecord.create).not.toHaveBeenCalled();
  });

  const proof = {
    orderNo: 'O1',
    channel: 'alipay',
    tradeNo: 'T1',
    expectedAmount: '9.90',
    paidAt,
  };

  it('rejects an amount mismatch before writing a payment or subscription', async () => {
    await expect(
      service.applyPaymentSuccess({ ...proof, expectedAmount: '0.01' }),
    ).rejects.toThrow('支付金额与订单不一致');
    expect(tx.paymentRecord.create).not.toHaveBeenCalled();
    expect(tx.userSubscription.create).not.toHaveBeenCalled();
  });
  it('extends existing entitlement and forces single payment rather than auto debit', async () => {
    const existingEnd = new Date(paidAt.getTime() + 86400000);
    tx.userSubscription.findFirst.mockResolvedValue({
      startAt: paidAt,
      endAt: existingEnd,
      entitlementChainId: 'chain',
    });
    await service.applyPaymentSuccess(proof);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.userSubscription.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        endAt: new Date(existingEnd.getTime() + 30 * 86400000),
        entitlementChainId: 'chain',
        autoRenew: false,
      }),
    });
  });
  it('accepts duplicate paid/refunded notifications without extending membership again', async () => {
    for (const status of ['paid', 'refunded']) {
      order.status = status;
      expect(await service.applyPaymentSuccess(proof)).toEqual({
        ok: true,
        duplicated: true,
      });
    }
    expect(tx.paymentRecord.create).not.toHaveBeenCalled();
    expect(notifications.paymentSuccess).not.toHaveBeenCalled();
    tx.paymentRecord.findFirst.mockResolvedValue(null);
    await expect(service.applyPaymentSuccess(proof)).rejects.toThrow(
      '重复通知交易号不匹配',
    );
  });
  it('keeps a local order pending while an unsubmitted signed form is valid', async () => {
    alipay.queryTrade.mockResolvedValue(null);
    await expect(service.cancelOrder('id', 'u')).rejects.toThrow(
      '支付表单仍在有效期',
    );
    expect(prisma.membershipOrder.updateMany).not.toHaveBeenCalled();
  });
  it('never closes locally when the remote close fails', async () => {
    alipay.queryTrade.mockResolvedValue({ tradeStatus: 'WAIT_BUYER_PAY' });
    alipay.closeTrade.mockRejectedValue(new Error('network'));
    await expect(service.cancelOrder('id', 'u')).rejects.toThrow('network');
    expect(prisma.membershipOrder.updateMany).not.toHaveBeenCalled();
  });
  it('keeps failed refunds retryable without recording a successful refund', async () => {
    order.status = 'paid';
    alipay.refundTrade.mockRejectedValue(new Error('timeout'));
    await expect(
      service.refundOrder('id', { reason: 'test' }, 'admin'),
    ).rejects.toThrow('timeout');
    expect(prisma.membershipOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ refundRequestedAt: expect.any(Date) }),
      }),
    );
    expect(tx.refundRecord.create).not.toHaveBeenCalled();
  });
  it('limits entitlement revocation to the same payment chain and skips repeated refunds', async () => {
    order.status = 'paid';
    await service.refundOrder('id', { reason: 'test' }, 'admin');
    expect(tx.userSubscription.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ entitlementChainId: 'id' }),
    });
    expect(tx.refundRecord.create).toHaveBeenCalledTimes(1);
    order.status = 'refunded';
    await service.refundOrder('id', { reason: 'test' }, 'admin');
    expect(alipay.refundTrade).toHaveBeenCalledTimes(1);
    expect(tx.refundRecord.create).toHaveBeenCalledTimes(1);
  });
  it('disables the mock payment entry by default', async () => {
    await expect(
      service.mockPayCallback({ orderNo: 'O1' } as any),
    ).rejects.toThrow('模拟支付已关闭');
  });
});
