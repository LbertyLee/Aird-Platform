import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ConfigService } from '@nestjs/config';
import { AlipaySdk } from 'alipay-sdk';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import type { AlipayRuntimeConfig } from './alipay.config';
import { loadAlipayConfig } from './alipay.config';

export type AlipayPagePayInput = {
  orderNo: string;
  subject: string;
  body?: string;
  totalAmount: string;
  expiresAt?: Date;
};

export type AlipayTradeNotify = {
  outTradeNo: string;
  tradeNo: string;
  tradeStatus: string;
  totalAmount: string;
  gmtPayment?: string;
  raw: Record<string, string>;
};

@Injectable()
export class AlipayService implements OnModuleInit {
  private readonly logger = new Logger(AlipayService.name);
  private config: AlipayRuntimeConfig = {
    enabled: false,
    appId: '',
    gateway: '',
    privateKey: '',
    alipayPublicKey: null,
    notifyUrl: '',
    returnUrl: '',
    webReturnUrl: '',
    keyType: 'PKCS8',
    wsHost: null,
  };
  private sdk: AlipaySdk | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async recordEvent(input: {
    action: string;
    status: string;
    channel?: string | null;
    orderId?: string;
    orderNo?: string;
    tradeNo?: string;
    amount?: string | number;
    actorId?: string;
    errorCode?: string;
    message?: string;
    durationMs?: number;
    details?: Record<string, unknown>;
  }) {
    await this.prisma.paymentOperationLog.create({
      data: {
        action: input.action.slice(0, 64),
        status: input.status.slice(0, 24),
        orderId: input.orderId,
        orderNo: input.orderNo?.slice(0, 64),
        channel: input.channel?.slice(0, 32),
        tradeNo: input.tradeNo?.slice(0, 128),
        amount:
          input.amount === undefined
            ? undefined
            : new Prisma.Decimal(input.amount),
        actorId: input.actorId,
        errorCode: input.errorCode?.slice(0, 64),
        message: input.message?.slice(0, 256),
        durationMs: input.durationMs,
        details: input.details as Prisma.InputJsonValue | undefined,
      },
    });
  }

  onModuleInit() {
    this.config = loadAlipayConfig(this.configService);
    if (!this.config.enabled || !this.config.alipayPublicKey) {
      this.logger.warn(
        '支付宝未启用或配置不完整（需 ALIPAY_ENABLED、APP_ID、私钥、API_PUBLIC_BASE_URL / NOTIFY_URL、WEB_PUBLIC_BASE_URL / RETURN_URL）',
      );
      return;
    }
    this.sdk = new AlipaySdk({
      appId: this.config.appId,
      privateKey: this.config.privateKey,
      alipayPublicKey: this.config.alipayPublicKey ?? undefined,
      gateway: this.config.gateway,
      keyType: this.config.keyType,
      signType: 'RSA2',
      timeout: 15000,
    });
    this.logger.log(
      `支付宝已就绪：gateway=${this.config.gateway} appId=${this.config.appId}`,
    );
  }

  isEnabled(): boolean {
    return this.config.enabled && this.sdk !== null;
  }

  getPageReturnUrl(orderNo?: string): string {
    if (!orderNo) return this.config.returnUrl;
    const url = new URL(this.config.returnUrl);
    return url.toString();
  }

  getWebReturnUrl(orderNo?: string): string {
    if (!orderNo) return this.config.webReturnUrl;
    const url = new URL(this.config.webReturnUrl);
    url.searchParams.set('orderNo', orderNo);
    return url.toString();
  }

  createPagePayForm(input: AlipayPagePayInput): string {
    if (!this.sdk) {
      throw new Error('Alipay SDK not initialized');
    }
    return this.sdk.pageExecute('alipay.trade.page.pay', 'POST', {
      notifyUrl: this.config.notifyUrl,
      returnUrl: this.getPageReturnUrl(input.orderNo),
      bizContent: {
        out_trade_no: input.orderNo,
        product_code: 'FAST_INSTANT_TRADE_PAY',
        qr_pay_mode: '4',
        qrcode_width: 220,
        integration_type: 'PCWEB',
        total_amount: input.totalAmount,
        subject: input.subject,
        body: input.body ?? input.subject,
        time_expire: input.expiresAt
          ? new Date(input.expiresAt.getTime() + 8 * 3600000)
              .toISOString()
              .slice(0, 19)
              .replace('T', ' ')
          : undefined,
        timeout_express: '30m',
      },
    });
  }

  async createQrPayCode(input: AlipayPagePayInput): Promise<string> {
    const result = this.requireSuccess(
      await this.execute(
        'alipay.trade.precreate',
        {
          out_trade_no: input.orderNo,
          total_amount: input.totalAmount,
          subject: input.subject,
          body: input.body ?? input.subject,
          timeout_express: '30m',
        },
        true,
      ),
    );
    if (result.outTradeNo !== input.orderNo || !result.qrCode) {
      throw new BusinessException(
        'ALIPAY_QR_RESPONSE_INVALID',
        '支付宝未返回有效的支付二维码，请重试',
        502,
      );
    }
    return result.qrCode;
  }

  verifyNotifyPayload(payload: Record<string, unknown>): boolean {
    if (!this.sdk || payload.app_id !== this.config.appId) return false;
    const sellerId = this.configService
      .get<string>('ALIPAY_SELLER_ID', '')
      .trim();
    if (sellerId && payload.seller_id !== sellerId) return false;
    if (!this.config.alipayPublicKey) return false;
    try {
      return (
        this.sdk.checkNotifySignV2(payload) || this.sdk.checkNotifySign(payload)
      );
    } catch {
      this.logger.warn(`支付宝通知验签异常`);
      return false;
    }
  }

  /** SDK 默认将支付宝响应字段转换为 camelCase；所有服务端响应必须验签。 */
  private async execute(
    method: string,
    bizContent: Record<string, unknown>,
    includeNotifyUrl = false,
  ) {
    if (!this.isEnabled() || !this.sdk) {
      throw new BusinessException(
        'ALIPAY_UNAVAILABLE',
        '支付宝配置不完整或未启用',
        503,
      );
    }
    const startedAt = Date.now();
    const orderNo = String(bizContent.out_trade_no ?? '');
    const amount =
      bizContent.total_amount ?? bizContent.refund_amount ?? undefined;
    let result: Record<string, string>;
    try {
      result = (await this.sdk.exec(
        method,
        {
          ...(includeNotifyUrl ? { notifyUrl: this.config.notifyUrl } : {}),
          bizContent,
        },
        { validateSign: true },
      )) as Record<string, string>;
    } catch {
      await this.recordEvent({
        action: method,
        status: 'failed',
        orderNo,
        amount: amount === undefined ? undefined : String(amount),
        errorCode: 'ALIPAY_GATEWAY_ERROR',
        message: '支付宝网关请求失败',
        durationMs: Date.now() - startedAt,
      });
      // 请求超时可能已被支付宝受理，调用方须沿用订单号/退款请求号重试。
      throw new BusinessException(
        'ALIPAY_GATEWAY_ERROR',
        '支付宝响应异常，请稍后查询订单或重试',
        502,
      );
    }
    await this.recordEvent({
      action: method,
      status:
        result.code === '10000'
          ? 'success'
          : result.subCode === 'ACQ.TRADE_NOT_EXIST' ||
              result.subCode === 'ACQ.REFUND_NOT_EXIST'
            ? 'not_found'
            : 'failed',
      orderNo,
      tradeNo: result.tradeNo,
      amount: amount === undefined ? undefined : String(amount),
      errorCode:
        result.code === '10000' ? undefined : result.subCode || result.code,
      message: result.code === '10000' ? undefined : '支付宝接口返回失败',
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  private requireSuccess(result: Record<string, string>) {
    if (result.code !== '10000') {
      throw new BusinessException(
        'ALIPAY_REQUEST_FAILED',
        `支付宝处理失败：${result.subCode || result.code || 'UNKNOWN'}`,
        502,
      );
    }
    return result;
  }

  async queryTrade(orderNo: string) {
    const result = await this.execute('alipay.trade.query', {
      out_trade_no: orderNo,
    });
    if (result.subCode === 'ACQ.TRADE_NOT_EXIST') return null;
    this.requireSuccess(result);
    if (result.outTradeNo !== orderNo)
      throw new BusinessException(
        'ALIPAY_ORDER_MISMATCH',
        '支付宝订单不匹配',
        502,
      );
    return result;
  }

  async closeTrade(orderNo: string) {
    // TRADE_NOT_EXIST 不等于关单成功：浏览器可能尚未提交已签名的支付表单。
    return this.requireSuccess(
      await this.execute('alipay.trade.close', { out_trade_no: orderNo }),
    );
  }

  async refundTrade(orderNo: string, amount: string, reason?: string) {
    const requestNo = `RF${orderNo}`;
    const query = await this.execute('alipay.trade.fastpay.refund.query', {
      out_trade_no: orderNo,
      out_request_no: requestNo,
    });
    if (query.code === '10000' && query.refundStatus === 'REFUND_SUCCESS') {
      this.validateRefund(query, orderNo, amount, requestNo);
      return query;
    }
    if (
      query.code !== '10000' &&
      query.subCode !== 'ACQ.TRADE_NOT_EXIST' &&
      query.subCode !== 'ACQ.REFUND_NOT_EXIST'
    ) {
      this.requireSuccess(query);
    }
    const result = this.requireSuccess(
      await this.execute('alipay.trade.refund', {
        out_trade_no: orderNo,
        out_request_no: requestNo,
        refund_amount: amount,
        refund_reason: reason,
      }),
    );
    this.validateRefund(result, orderNo, amount);
    return result;
  }

  private validateRefund(
    result: Record<string, string>,
    orderNo: string,
    amount: string,
    requestNo?: string,
  ) {
    if (
      result.outTradeNo !== orderNo ||
      (requestNo && result.outRequestNo !== requestNo) ||
      !/^\d+(?:\.\d{1,2})?$/.test(
        result.refundAmount ?? result.refundFee ?? '',
      ) ||
      Number(result.refundAmount ?? result.refundFee) !== Number(amount)
    ) {
      throw new BusinessException(
        'ALIPAY_REFUND_MISMATCH',
        '支付宝退款结果不匹配，请重试查询',
        502,
      );
    }
  }

  parseTradeNotify(payload: Record<string, string>): AlipayTradeNotify | null {
    const outTradeNo = payload.out_trade_no;
    const tradeNo = payload.trade_no;
    const tradeStatus = payload.trade_status;
    const totalAmount = payload.total_amount;
    if (!outTradeNo || !tradeNo || !tradeStatus || !totalAmount) {
      return null;
    }
    return {
      outTradeNo,
      tradeNo,
      tradeStatus,
      totalAmount,
      gmtPayment: payload.gmt_payment,
      raw: payload,
    };
  }

  isTradeSuccess(status: string): boolean {
    return status === 'TRADE_SUCCESS' || status === 'TRADE_FINISHED';
  }
}
