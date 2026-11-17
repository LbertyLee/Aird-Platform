import { ConfigService } from '@nestjs/config';
import { createCipheriv, generateKeyPairSync, sign, verify } from 'node:crypto';
import { WechatService } from './wechat.service';

describe('WeChat APIv3 payment security', () => {
  const merchant = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const platform = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serial = 'PUB_KEY_ID_TEST';
  const apiKey = '0123456789abcdef0123456789abcdef';
  let service: WechatService;
  const trade = () => ({
    appid: 'app',
    mchid: 'merchant',
    out_trade_no: 'O1',
    trade_state: 'SUCCESS',
    transaction_id: 'T1',
    success_time: new Date().toISOString(),
    amount: { total: 1, currency: 'CNY' },
  });
  function signedResponse(value: unknown, status = 200) {
    const body = status === 204 ? '' : JSON.stringify(value);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'test-nonce';
    return new Response(status === 204 ? null : body, {
      status,
      headers: {
        'Wechatpay-Timestamp': timestamp,
        'Wechatpay-Nonce': nonce,
        'Wechatpay-Serial': serial,
        'Wechatpay-Signature': sign(
          'RSA-SHA256',
          Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
          platform.privateKey,
        ).toString('base64'),
      },
    });
  }
  beforeEach(() => {
    service = new WechatService(new ConfigService());
    Object.assign(service, {
      ready: true,
      appId: 'app',
      mchId: 'merchant',
      serial: 'MERCHANT_SERIAL',
      publicKeyId: serial,
      apiKey,
      notifyUrl: 'https://example.test/notify',
      privateKey: merchant.privateKey.export({ type: 'pkcs8', format: 'pem' }),
      publicKey: platform.publicKey.export({ type: 'spki', format: 'pem' }),
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('keeps incomplete production configuration disabled', () => {
    const disabled = new WechatService(
      new ConfigService({ WECHAT_PAY_ENABLED: 'true' }),
    );
    disabled.onModuleInit();
    expect(disabled.isEnabled()).toBe(false);
  });
  it.each(['0', '-1', '0.001', 'NaN'])(
    'rejects invalid amount %s',
    (amount) => {
      expect(() => service.toFen(amount)).toThrow();
    },
  );
  it('signs the request and sends 0.01 yuan as exactly one fen', async () => {
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(signedResponse({ code_url: 'weixin://wxpay/test' }));
    const expiresAt = new Date(Date.now() + 60000);
    await expect(
      service.createNativePay({
        orderNo: 'O1',
        subject: '会员',
        amount: '0.01',
        expiresAt,
      }),
    ).resolves.toBe('weixin://wxpay/test');
    const [url, request] = mock.mock.calls[0];
    expect(url).toBe(
      'https://api.mch.weixin.qq.com/v3/pay/transactions/native',
    );
    const body = JSON.parse(request!.body as string);
    expect(body.amount).toEqual({ total: 1, currency: 'CNY' });
    expect(body.time_expire).toBe(expiresAt.toISOString());
    const auth = (request!.headers as Record<string, string>).Authorization;
    const parts = Object.fromEntries(
      [...auth.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
    expect(
      verify(
        'RSA-SHA256',
        Buffer.from(
          `POST\n/v3/pay/transactions/native\n${parts.timestamp}\n${parts.nonce_str}\n${request!.body}\n`,
        ),
        merchant.publicKey,
        Buffer.from(parts.signature, 'base64'),
      ),
    ).toBe(true);
  });
  it('rejects tampered, stale and wrong-key responses', async () => {
    const response = signedResponse(trade());
    const body = await response.text();
    const timestamp = response.headers.get('Wechatpay-Timestamp')!;
    const signature = response.headers.get('Wechatpay-Signature')!;
    expect(
      service.verifyMessage(timestamp, 'test-nonce', body, signature, serial),
    ).toBe(true);
    expect(
      service.verifyMessage(
        timestamp,
        'test-nonce',
        body + ' ',
        signature,
        serial,
      ),
    ).toBe(false);
    expect(
      service.verifyMessage(timestamp, 'test-nonce', body, signature, 'wrong'),
    ).toBe(false);
    expect(
      service.verifyMessage('1', 'test-nonce', body, signature, serial),
    ).toBe(false);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body));
    await expect(service.queryTrade('O1')).rejects.toThrow('验签失败');
  });
  it('checks merchant, app, order and currency even on signed responses', async () => {
    for (const change of [
      { appid: 'other' },
      { mchid: 'other' },
      { out_trade_no: 'other' },
      { amount: { total: 1, currency: 'USD' } },
    ]) {
      jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(signedResponse({ ...trade(), ...change }));
      await expect(service.queryTrade('O1')).rejects.toThrow('交易数据不匹配');
    }
  });
  it('supports signed missing-order and empty close responses', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(signedResponse({ code: 'ORDER_NOT_EXIST' }, 404))
      .mockResolvedValueOnce(signedResponse(null, 204));
    await expect(service.queryTrade('O1')).resolves.toBeNull();
    await expect(service.closeTrade('O1')).resolves.toBeUndefined();
  });
  it('authenticates encrypted notifications and rejects tampered ciphertext', () => {
    const nonce = '123456789012';
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(apiKey),
      Buffer.from(nonce),
    );
    cipher.setAAD(Buffer.from('transaction'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(trade())),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const event = {
      event_type: 'TRANSACTION.SUCCESS',
      resource_type: 'encrypt-resource',
      resource: {
        algorithm: 'AEAD_AES_256_GCM',
        original_type: 'transaction',
        nonce,
        associated_data: 'transaction',
        ciphertext: ciphertext.toString('base64'),
      },
    };
    expect(
      service.decryptNotification(JSON.stringify(event)).amount.total,
    ).toBe(1);
    ciphertext[0] ^= 1;
    event.resource.ciphertext = ciphertext.toString('base64');
    expect(() => service.decryptNotification(JSON.stringify(event))).toThrow();
  });
  it('reuses a fixed refund number and waits for confirmed SUCCESS', async () => {
    const refund = {
      out_trade_no: 'O1',
      out_refund_no: 'RFO1',
      status: 'PROCESSING',
      amount: { total: 1, refund: 1, currency: 'CNY' },
    };
    const mock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        signedResponse({ code: 'RESOURCE_NOT_EXISTS' }, 404),
      )
      .mockResolvedValueOnce(signedResponse(refund))
      .mockResolvedValueOnce(signedResponse({ ...refund, status: 'SUCCESS' }));
    await expect(service.refundTrade('O1', '0.01')).rejects.toThrow(
      '退款尚未成功',
    );
    await expect(service.refundTrade('O1', '0.01')).resolves.toBeUndefined();
    expect(
      mock.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  });
});
