import {
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { MembershipService } from '../../membership/membership.service';
import { AlipayService } from './alipay.service';

function flattenNotifyBody(req: Request): Record<string, string> {
  const source = { ...req.query, ...req.body } as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      out[key] = String(value[0]);
    } else {
      out[key] = String(value);
    }
  }
  return out;
}

/**
 * 支付宝电脑网站支付：异步通知与同步回跳。
 * 电脑网站支付需在开放平台订阅「交易通知」并配置 HTTP 网关（与 WebSocket 资金消息互补）。
 */
@ApiTags('支付-支付宝')
@Controller('payment/alipay')
export class AlipayController {
  private readonly logger = new Logger(AlipayController.name);

  constructor(
    private readonly alipay: AlipayService,
    private readonly membership: MembershipService,
  ) {}

  @Public()
  @Post('notify')
  @HttpCode(200)
  @ApiOperation({
    summary: '支付宝交易异步通知（application/x-www-form-urlencoded）',
  })
  async notify(@Req() req: Request, @Res() res: Response) {
    const payload = flattenNotifyBody(req);
    const event = {
      action: 'alipay.notify',
      orderNo: payload.out_trade_no,
      tradeNo: payload.trade_no,
      amount: /^\d+(?:\.\d{1,2})?$/.test(payload.total_amount ?? '')
        ? payload.total_amount
        : undefined,
      details: { tradeStatus: payload.trade_status?.slice(0, 32) ?? null },
    };
    await this.alipay.recordEvent({ ...event, status: 'received' });
    if (!this.alipay.verifyNotifyPayload(payload)) {
      this.logger.warn('支付宝异步通知验签失败');
      await this.alipay.recordEvent({
        ...event,
        status: 'invalid',
        errorCode: 'INVALID_SIGNATURE',
        message: '支付宝通知验签失败',
      });
      res.type('text/plain').send('fail');
      return;
    }
    const trade = this.alipay.parseTradeNotify(payload);
    if (!trade) {
      await this.alipay.recordEvent({
        ...event,
        status: 'invalid',
        errorCode: 'INVALID_PAYLOAD',
        message: '支付宝通知缺少必要字段',
      });
      res.type('text/plain').send('fail');
      return;
    }
    if (!this.alipay.isTradeSuccess(trade.tradeStatus)) {
      await this.alipay.recordEvent({ ...event, status: 'ignored' });
      res.type('text/plain').send('success');
      return;
    }
    try {
      await this.membership.applyPaymentSuccess({
        orderNo: trade.outTradeNo,
        channel: 'alipay',
        tradeNo: trade.tradeNo,
        rawPayload: trade.raw,
        paidAt: trade.gmtPayment
          ? new Date(trade.gmtPayment.replace(' ', 'T') + '+08:00')
          : undefined,
        expectedAmount: trade.totalAmount,
      });
    } catch {
      this.logger.error('处理支付宝通知失败，请通过订单对账接口重试');
      await this.alipay.recordEvent({
        ...event,
        status: 'failed',
        errorCode: 'PAYMENT_CREDIT_FAILED',
        message: '支付入账失败，请稍后对账重试',
      });
      res.type('text/plain').send('fail');
      return;
    }
    await this.alipay.recordEvent({ ...event, status: 'success' });
    res.type('text/plain').send('success');
  }

  @Public()
  @Get('return')
  @ApiOperation({ summary: '支付宝同步回跳（验签后重定向到用户端结算页）' })
  async syncReturn(
    @Query() query: Record<string, string>,
    @Res() res: Response,
  ) {
    const payload = { ...query };
    if (!this.alipay.verifyNotifyPayload(payload)) {
      await this.alipay.recordEvent({
        action: 'alipay.return',
        status: 'invalid',
        orderNo: query.out_trade_no,
        errorCode: 'INVALID_SIGNATURE',
        message: '支付宝同步回跳验签失败',
      });
      res.status(400).type('text/plain').send('invalid sign');
      return;
    }
    const trade = this.alipay.parseTradeNotify(payload);
    const orderNo = trade?.outTradeNo ?? query.out_trade_no ?? '';
    await this.alipay.recordEvent({
      action: 'alipay.return',
      status: 'success',
      orderNo,
      tradeNo: trade?.tradeNo,
      amount: trade?.totalAmount,
      details: { tradeStatus: trade?.tradeStatus ?? null },
    });
    const target = this.alipay.getWebReturnUrl(orderNo || undefined);
    res.redirect(302, target);
  }
}
