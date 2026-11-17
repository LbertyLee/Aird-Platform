import { WechatController } from './wechat.controller';

describe('WeChat payment notification controller', () => {
  let controller: WechatController;
  let wechat: any;
  let membership: any;
  let events: any;
  let response: any;
  const paidTrade = {
    appid: 'app',
    mchid: 'merchant',
    out_trade_no: 'O1',
    transaction_id: 'T1',
    success_time: '2026-11-05T03:00:00+08:00',
    amount: { total: 1, currency: 'CNY' },
  };
  const request = () => ({
    rawBody: Buffer.from('{"event_type":"TRANSACTION.SUCCESS"}'),
    get: jest.fn(
      (name: string) =>
        ({
          'Wechatpay-Timestamp': '123',
          'Wechatpay-Nonce': 'n',
          'Wechatpay-Signature': 's',
          'Wechatpay-Serial': 'PUB_KEY_ID_TEST',
        })[name],
    ),
  });
  beforeEach(() => {
    wechat = {
      verifyMessage: jest.fn().mockReturnValue(true),
      decryptNotification: jest.fn().mockReturnValue(paidTrade),
    };
    membership = {
      applyPaymentSuccess: jest.fn().mockResolvedValue({ ok: true }),
    };
    events = { recordEvent: jest.fn().mockResolvedValue(undefined) };
    response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    };
    controller = new WechatController(wechat, membership, events);
  });
  it('rejects an invalid signature without crediting membership', async () => {
    wechat.verifyMessage.mockReturnValue(false);
    await controller.notify(request() as any, response);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(membership.applyPaymentSuccess).not.toHaveBeenCalled();
  });
  it('credits a verified and decrypted 0.01 yuan payment idempotently', async () => {
    await controller.notify(request() as any, response);
    expect(wechat.verifyMessage).toHaveBeenCalledWith(
      '123',
      'n',
      '{"event_type":"TRANSACTION.SUCCESS"}',
      's',
      'PUB_KEY_ID_TEST',
    );
    expect(membership.applyPaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        orderNo: 'O1',
        channel: 'wechat',
        tradeNo: 'T1',
        expectedAmount: '0.01',
      }),
    );
    expect(response.status).toHaveBeenCalledWith(204);
    expect(response.send).toHaveBeenCalled();
  });
  it('asks WeChat to retry if transactional processing fails', async () => {
    membership.applyPaymentSuccess.mockRejectedValue(
      new Error('database unavailable'),
    );
    await controller.notify(request() as any, response);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'FAIL',
      message: 'notification processing failed',
    });
  });
});
