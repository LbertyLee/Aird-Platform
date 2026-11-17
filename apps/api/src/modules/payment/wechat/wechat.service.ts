import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  sign,
  verify,
  X509Certificate,
} from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BusinessException } from '../../../common/exceptions/business.exception';

export interface WechatTrade {
  appid: string;
  mchid: string;
  out_trade_no: string;
  transaction_id?: string;
  trade_state?: string;
  success_time?: string;
  amount: { total: number; currency: string };
}

/** 微信支付 API v3，直连商户 Native 支付，使用微信支付公钥模式。 */
@Injectable()
export class WechatService implements OnModuleInit {
  private readonly logger = new Logger(WechatService.name);
  private ready = false;
  private appId = '';
  private mchId = '';
  private serial = '';
  private publicKeyId = '';
  private privateKey = '';
  private publicKey = '';
  private apiKey = '';
  private notifyUrl = '';

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    if (this.config.get<string>('WECHAT_PAY_ENABLED', 'false') !== 'true')
      return;
    try {
      const read = (name: string) =>
        readFileSync(
          resolve(process.cwd(), this.config.getOrThrow<string>(name)),
          'utf8',
        ).trim();
      this.appId = this.config.getOrThrow<string>('WECHAT_PAY_APP_ID').trim();
      this.mchId = this.config.getOrThrow<string>('WECHAT_PAY_MCH_ID').trim();
      this.serial = this.config
        .getOrThrow<string>('WECHAT_PAY_CERT_SERIAL')
        .trim()
        .toUpperCase();
      this.publicKeyId = this.config
        .getOrThrow<string>('WECHAT_PAY_PUBLIC_KEY_ID')
        .trim();
      this.privateKey = read('WECHAT_PAY_PRIVATE_KEY_PATH');
      this.publicKey = read('WECHAT_PAY_PUBLIC_KEY_PATH');
      this.apiKey = read('WECHAT_PAY_API_V3_KEY_PATH');
      this.notifyUrl = this.config
        .getOrThrow<string>('WECHAT_PAY_NOTIFY_URL')
        .trim();
      const cert = new X509Certificate(read('WECHAT_PAY_CERT_PATH'));
      const key = createPrivateKey(this.privateKey);
      if (
        Buffer.byteLength(this.apiKey) !== 32 ||
        !this.appId ||
        !this.mchId ||
        !this.publicKeyId.startsWith('PUB_KEY_ID_') ||
        new URL(this.notifyUrl).protocol !== 'https:' ||
        cert.serialNumber.toUpperCase() !== this.serial ||
        !cert.checkPrivateKey(key) ||
        Date.parse(cert.validTo) <= Date.now() ||
        Date.parse(cert.validFrom) > Date.now()
      )
        throw new Error('invalid configuration');
      createPublicKey(this.publicKey);
      this.ready = true;
      this.logger.log('微信 Native 支付已就绪');
    } catch {
      this.ready = false;
      this.logger.warn('微信支付配置不完整或证书、密钥无效，已禁用微信支付');
    }
  }

  isEnabled() {
    return this.ready;
  }

  private requireReady() {
    if (!this.ready)
      throw new BusinessException(
        'WECHAT_PAY_UNAVAILABLE',
        '微信支付尚未配置完整或未启用',
        503,
      );
  }

  verifyMessage(
    timestamp: string,
    nonce: string,
    body: string,
    signature: string,
    serial: string,
  ) {
    this.requireReady();
    if (
      serial !== this.publicKeyId ||
      !/^\d+$/.test(timestamp) ||
      !nonce ||
      !signature ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
    )
      return false;
    try {
      return verify(
        'RSA-SHA256',
        Buffer.from(`${timestamp}\n${nonce}\n${body}\n`),
        this.publicKey,
        Buffer.from(signature, 'base64'),
      );
    } catch {
      return false;
    }
  }

  private async request(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
  ): Promise<Record<string, any>> {
    this.requireReady();
    const body = data === undefined ? '' : JSON.stringify(data);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const signature = sign(
      'RSA-SHA256',
      Buffer.from(`${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`),
      this.privateKey,
    ).toString('base64');
    let response: globalThis.Response;
    try {
      response = await fetch(`https://api.mch.weixin.qq.com${path}`, {
        method,
        headers: {
          Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchId}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.serial}",signature="${signature}"`,
          'Wechatpay-Serial': this.publicKeyId,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body || undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new BusinessException(
        'WECHAT_PAY_NETWORK_ERROR',
        '微信支付连接失败，请稍后重试',
        502,
      );
    }
    const text = await response.text();
    // 包括空响应在内的成功应答均验签，不信任网关返回的未验签订单或二维码。
    if (
      !this.verifyMessage(
        response.headers.get('Wechatpay-Timestamp') ?? '',
        response.headers.get('Wechatpay-Nonce') ?? '',
        text,
        response.headers.get('Wechatpay-Signature') ?? '',
        response.headers.get('Wechatpay-Serial') ?? '',
      )
    ) {
      throw new BusinessException(
        'WECHAT_PAY_INVALID_SIGNATURE',
        '微信支付响应验签失败，请稍后重试',
        502,
      );
    }
    let result: Record<string, any>;
    try {
      result = text ? JSON.parse(text) : {};
    } catch {
      throw new BusinessException(
        'WECHAT_PAY_INVALID_RESPONSE',
        '微信支付返回格式异常',
        502,
      );
    }
    if (!response.ok) {
      if (
        method === 'GET' &&
        ['ORDER_NOT_EXIST', 'RESOURCE_NOT_EXISTS'].includes(result.code)
      )
        return { code: result.code };
      this.logger.warn(
        `微信支付接口失败 status=${response.status} code=${String(
          result.code ?? 'UNKNOWN',
        )
          .replace(/[^A-Z_]/g, '')
          .slice(0, 64)}`,
      );
      throw new BusinessException(
        'WECHAT_PAY_REQUEST_FAILED',
        '微信支付请求失败，请稍后查询订单或联系管理员',
        502,
      );
    }
    return result;
  }

  async createNativePay(input: {
    orderNo: string;
    subject: string;
    amount: string;
    expiresAt: Date;
  }) {
    const total = this.toFen(input.amount);
    const result = await this.request('POST', '/v3/pay/transactions/native', {
      appid: this.appId,
      mchid: this.mchId,
      description: input.subject.slice(0, 127),
      out_trade_no: input.orderNo,
      time_expire: input.expiresAt.toISOString(),
      notify_url: this.notifyUrl,
      amount: { total, currency: 'CNY' },
    });
    if (
      typeof result.code_url !== 'string' ||
      !result.code_url.startsWith('weixin://wxpay/')
    ) {
      throw new BusinessException(
        'WECHAT_PAY_INVALID_RESPONSE',
        '微信支付二维码生成失败',
        502,
      );
    }
    return result.code_url as string;
  }

  toFen(amount: string) {
    if (!/^\d+(?:\.\d{1,2})?$/.test(amount))
      throw new BusinessException('PAYMENT_AMOUNT_INVALID', '支付金额无效');
    const [yuan, fraction = ''] = amount.split('.');
    const fen = Number(yuan) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(fen) || fen < 1)
      throw new BusinessException(
        'PAYMENT_AMOUNT_INVALID',
        '微信支付金额至少为0.01元',
      );
    return fen;
  }

  validateTrade(trade: WechatTrade, orderNo?: string) {
    if (
      !trade ||
      trade.appid !== this.appId ||
      trade.mchid !== this.mchId ||
      !trade.out_trade_no ||
      (orderNo && trade.out_trade_no !== orderNo) ||
      trade.amount?.currency !== 'CNY' ||
      !Number.isSafeInteger(trade.amount?.total) ||
      trade.amount.total < 1 ||
      (trade.trade_state === 'SUCCESS' &&
        (!trade.transaction_id ||
          !trade.success_time ||
          !Number.isFinite(Date.parse(trade.success_time))))
    ) {
      throw new BusinessException(
        'WECHAT_PAY_INVALID_TRADE',
        '微信支付交易数据不匹配',
        400,
      );
    }
    return trade;
  }

  async queryTrade(orderNo: string): Promise<WechatTrade | null> {
    const trade = await this.request(
      'GET',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}?mchid=${encodeURIComponent(this.mchId)}`,
    );
    return trade.code === 'ORDER_NOT_EXIST'
      ? null
      : this.validateTrade(trade as WechatTrade, orderNo);
  }

  async closeTrade(orderNo: string) {
    await this.request(
      'POST',
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(orderNo)}/close`,
      { mchid: this.mchId },
    );
  }

  async refundTrade(orderNo: string, amount: string, reason?: string) {
    const refundNo = `RF${orderNo}`;
    const total = this.toFen(amount);
    // 固定退款号保证重试幂等。查询优先，PROCESSING 时不提前撤销会员权益。
    let result = await this.request(
      'GET',
      `/v3/refund/domestic/refunds/${encodeURIComponent(refundNo)}`,
    );
    if (result.code === 'RESOURCE_NOT_EXISTS') {
      result = await this.request('POST', '/v3/refund/domestic/refunds', {
        out_trade_no: orderNo,
        out_refund_no: refundNo,
        reason: reason?.slice(0, 80),
        amount: { refund: total, total, currency: 'CNY' },
      });
    }
    if (
      result.out_trade_no !== orderNo ||
      result.out_refund_no !== refundNo ||
      result.amount?.total !== total ||
      result.amount?.refund !== total ||
      result.amount?.currency !== 'CNY'
    ) {
      throw new BusinessException(
        'WECHAT_PAY_INVALID_REFUND',
        '微信退款数据不匹配',
        502,
      );
    }
    if (result.status !== 'SUCCESS') {
      throw new BusinessException(
        'WECHAT_REFUND_PENDING',
        '微信退款尚未成功，系统将自动查询处理；会员权益暂未撤销',
      );
    }
  }

  decryptNotification(body: string): WechatTrade {
    this.requireReady();
    const event = JSON.parse(body);
    if (
      event.event_type !== 'TRANSACTION.SUCCESS' ||
      event.resource_type !== 'encrypt-resource' ||
      event.resource?.algorithm !== 'AEAD_AES_256_GCM' ||
      event.resource?.original_type !== 'transaction'
    ) {
      throw new BusinessException(
        'WECHAT_PAY_INVALID_NOTIFY',
        '微信支付通知类型无效',
        400,
      );
    }
    const resource = event.resource;
    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.apiKey),
      Buffer.from(resource.nonce),
    );
    decipher.setAuthTag(ciphertext.subarray(-16));
    decipher.setAAD(Buffer.from(resource.associated_data ?? ''));
    const trade = JSON.parse(
      Buffer.concat([
        decipher.update(ciphertext.subarray(0, -16)),
        decipher.final(),
      ]).toString('utf8'),
    );
    if (trade.trade_state !== 'SUCCESS')
      throw new BusinessException(
        'WECHAT_PAY_INVALID_NOTIFY',
        '微信支付状态无效',
        400,
      );
    return this.validateTrade(trade);
  }
}
