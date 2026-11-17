import { Module, forwardRef } from '@nestjs/common';
import { MembershipModule } from '../membership/membership.module';
import { AlipayController } from './alipay/alipay.controller';
import { AlipayMessageListener } from './alipay/alipay-message.listener';
import { AlipayReconciliationWorker } from './alipay/alipay-reconciliation.worker';
import { AlipayService } from './alipay/alipay.service';
import { WechatService } from './wechat/wechat.service';
import { WechatController } from './wechat/wechat.controller';
import { WechatReconciliationWorker } from './wechat/wechat-reconciliation.worker';

@Module({
  imports: [forwardRef(() => MembershipModule)],
  controllers: [AlipayController, WechatController],
  providers: [
    AlipayService,
    AlipayMessageListener,
    AlipayReconciliationWorker,
    WechatService,
    WechatReconciliationWorker,
  ],
  exports: [AlipayService, WechatService],
})
export class PaymentModule {}
