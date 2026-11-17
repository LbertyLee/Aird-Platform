import { Controller, Post, Req, Res } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import { MembershipService } from '../../membership/membership.service';
import { AlipayService } from '../alipay/alipay.service';
import { WechatService } from './wechat.service';

@ApiTags('支付-微信')
@Controller('payment/wechat')
export class WechatController {
  constructor(
    private readonly wechat: WechatService,
    private readonly membership: MembershipService,
    private readonly events: AlipayService,
  ) {}

  @Public()
  @Post('notify')
  @ApiOperation({
    summary:
      '微信支付 APIv3 通知：原始报文验签、解密、校验商户及金额后幂等入账',
  })
  async notify(@Req() req: RawBodyRequest<Request>, @Res() res: Response) {
    try {
      const body = req.rawBody?.toString('utf8');
      if (
        !body ||
        !this.wechat.verifyMessage(
          req.get('Wechatpay-Timestamp') ?? '',
          req.get('Wechatpay-Nonce') ?? '',
          body,
          req.get('Wechatpay-Signature') ?? '',
          req.get('Wechatpay-Serial') ?? '',
        )
      ) {
        res.status(401).json({ code: 'FAIL', message: 'invalid signature' });
        return;
      }
      const trade = this.wechat.decryptNotification(body);
      await this.membership.applyPaymentSuccess({
        orderNo: trade.out_trade_no,
        channel: 'wechat',
        tradeNo: trade.transaction_id,
        expectedAmount: (trade.amount.total / 100).toFixed(2),
        paidAt: new Date(trade.success_time!),
        rawPayload: trade,
      });
      await this.events.recordEvent({
        action: 'wechat.notify',
        status: 'success',
        channel: 'wechat',
        orderNo: trade.out_trade_no,
        tradeNo: trade.transaction_id,
        amount: (trade.amount.total / 100).toFixed(2),
      });
      res.status(204).send();
    } catch {
      // 不返回密钥、解密内容或原始异常；非成功应答触发微信重试。
      res
        .status(500)
        .json({ code: 'FAIL', message: 'notification processing failed' });
    }
  }
}
