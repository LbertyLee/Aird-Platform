import { ConfigService } from '@nestjs/config';
import { AlipayService } from './alipay.service';

describe('AlipayService money operations', () => {
  let service: AlipayService;
  let exec: jest.Mock;
  beforeEach(() => {
    service = new AlipayService(
      new ConfigService({ ALIPAY_SELLER_ID: 'seller' }),
      {
        paymentOperationLog: { create: jest.fn().mockResolvedValue({}) },
      } as any,
    );
    exec = jest.fn();
    Object.assign(service, {
      config: {
        enabled: true,
        appId: 'app',
        alipayPublicKey: 'public',
        notifyUrl: 'https://example.test/notify',
      },
      sdk: { exec, checkNotifySignV2: jest.fn().mockReturnValue(true) },
    });
  });

  it('builds page pay with callbacks, amount and the fixed order expiry', () => {
    const pageExecute = jest.fn().mockReturnValue('<form></form>');
    Object.assign(service, {
      sdk: { pageExecute },
      config: {
        notifyUrl: 'https://example.test/notify',
        returnUrl: 'https://example.test/return',
      },
    });
    expect(service.createPagePayForm({
      orderNo: 'O1', subject: 'Plus', totalAmount: '9.90',
      expiresAt: new Date('2026-11-05T02:30:00Z'),
    })).toBe('<form></form>');
    expect(pageExecute).toHaveBeenCalledWith('alipay.trade.page.pay', 'POST', {
      notifyUrl: 'https://example.test/notify',
      returnUrl: 'https://example.test/return',
      bizContent: expect.objectContaining({
        out_trade_no: 'O1', total_amount: '9.90',
        product_code: 'FAST_INSTANT_TRADE_PAY', qr_pay_mode: '4', qrcode_width: 220,
        time_expire: '2026-11-05 10:30:00',
      }),
    });
  });

  it('rejects notifications from another app or seller even with a valid signature', () => {
    expect(
      service.verifyNotifyPayload({ app_id: 'other', seller_id: 'seller' }),
    ).toBe(false);
    expect(
      service.verifyNotifyPayload({ app_id: 'app', seller_id: 'other' }),
    ).toBe(false);
    expect(
      service.verifyNotifyPayload({ app_id: 'app', seller_id: 'seller' }),
    ).toBe(true);
  });

  it('verifies query responses and distinguishes missing trades from gateway errors', async () => {
    exec.mockResolvedValueOnce({
      code: '40004',
      subCode: 'ACQ.TRADE_NOT_EXIST',
    });
    expect(await service.queryTrade('O1')).toBeNull();
    expect(exec).toHaveBeenCalledWith(
      'alipay.trade.query',
      { bizContent: { out_trade_no: 'O1' } },
      { validateSign: true },
    );
    exec.mockRejectedValueOnce(new Error('sensitive SDK details'));
    await expect(service.queryTrade('O1')).rejects.toThrow('支付宝响应异常');
  });

  it('rejects a signed response for another order', async () => {
    exec.mockResolvedValue({ code: '10000', outTradeNo: 'other' });
    await expect(service.queryTrade('O1')).rejects.toThrow('支付宝订单不匹配');
  });

  it('creates an Alipay QR code and sends the asynchronous notification URL', async () => {
    exec.mockResolvedValue({
      code: '10000',
      outTradeNo: 'O1',
      qrCode: 'https://qr.alipay.test/Q1',
    });
    await expect(
      service.createQrPayCode({
        orderNo: 'O1',
        subject: 'Plus',
        totalAmount: '9.90',
      }),
    ).resolves.toBe('https://qr.alipay.test/Q1');
    expect(exec).toHaveBeenCalledWith(
      'alipay.trade.precreate',
      expect.objectContaining({
        notifyUrl: 'https://example.test/notify',
        bizContent: expect.objectContaining({
          out_trade_no: 'O1',
          total_amount: '9.90',
          timeout_express: '30m',
        }),
      }),
      { validateSign: true },
    );
  });

  it('rejects a QR response belonging to another order', async () => {
    exec.mockResolvedValue({
      code: '10000',
      outTradeNo: 'other',
      qrCode: 'https://qr.alipay.test/Q1',
    });
    await expect(
      service.createQrPayCode({
        orderNo: 'O1',
        subject: 'Plus',
        totalAmount: '9.90',
      }),
    ).rejects.toThrow('未返回有效的支付二维码');
  });

  it('does not treat a rejected close as success', async () => {
    exec.mockResolvedValue({
      code: '40004',
      subCode: 'ACQ.TRADE_STATUS_ERROR',
    });
    await expect(service.closeTrade('O1')).rejects.toThrow(
      'ACQ.TRADE_STATUS_ERROR',
    );
  });

  it('reuses a completed refund after a local failure without another money operation', async () => {
    exec.mockResolvedValue({
      code: '10000',
      refundStatus: 'REFUND_SUCCESS',
      outTradeNo: 'O1',
      outRequestNo: 'RFO1',
      refundAmount: '9.90',
    });
    await service.refundTrade('O1', '9.90');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('uses a stable refund key and validates the returned amount', async () => {
    exec.mockResolvedValueOnce({
      code: '40004',
      subCode: 'ACQ.REFUND_NOT_EXIST',
    });
    exec.mockResolvedValueOnce({
      code: '10000',
      outTradeNo: 'O1',
      refundFee: '9.90',
    });
    await service.refundTrade('O1', '9.90', 'reason');
    expect(exec.mock.calls[1][1].bizContent).toEqual({
      out_trade_no: 'O1',
      out_request_no: 'RFO1',
      refund_amount: '9.90',
      refund_reason: 'reason',
    });
    exec.mockResolvedValue({
      code: '10000',
      refundStatus: 'REFUND_SUCCESS',
      outTradeNo: 'O1',
      outRequestNo: 'RFO1',
      refundAmount: '0.01',
    });
    await expect(service.refundTrade('O1', '9.90')).rejects.toThrow(
      '支付宝退款结果不匹配',
    );
  });
});
