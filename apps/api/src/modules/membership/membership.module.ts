import { Module, forwardRef } from '@nestjs/common';
import { PaymentModule } from '../payment/payment.module';
import { BENEFIT_MERGE_STRATEGY } from '../../common/constants/injection-tokens';
import { AuditLogWriter } from '../../common/services/audit-log.writer';
import { BusinessNotificationWriter } from '../../common/services/business-notification.writer';
import { HigherWinsMergeStrategy } from '../../domain/strategies/benefit-merge.strategy';
import { EntitlementResolver } from './entitlement.resolver';
import { MembershipController } from './membership.controller';
import { MembershipOrderFactory } from './membership-order.factory';
import { MembershipService } from './membership.service';
import { UserMembershipController } from './user-membership.controller';

/**
 * 会员模块。
 */
@Module({
  imports: [forwardRef(() => PaymentModule)],
  controllers: [MembershipController, UserMembershipController],
  providers: [
    MembershipService,
    MembershipOrderFactory,
    EntitlementResolver,
    AuditLogWriter,
    BusinessNotificationWriter,
    { provide: BENEFIT_MERGE_STRATEGY, useClass: HigherWinsMergeStrategy },
  ],
  exports: [MembershipService, EntitlementResolver],
})
export class MembershipModule {}
