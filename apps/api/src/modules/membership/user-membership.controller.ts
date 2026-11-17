import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUserContext } from '../../common/types/auth-user.context';
import {
  CheckoutPackageDto,
  CreateUserOrderDto,
  PayUserOrderDto,
  UserBillingQueryDto,
} from './dto/membership.dto';
import { MembershipService } from './membership.service';

/**
 * 用户端会员中心入口。
 */
@ApiTags('用户端-会员')
@Controller('membership')
export class UserMembershipController {
  constructor(private readonly membershipService: MembershipService) {}

  /**
   * 可售套餐目录（登录前后均可浏览）。
   */
  @Public()
  @Get('catalog')
  @ApiOperation({ summary: '用户端会员套餐目录' })
  getCatalog() {
    return this.membershipService.getUserFacingCatalog();
  }

  /**
   * 当前登录用户的会员与免费体验状态。
   */
  @ApiBearerAuth()
  @Get('me')
  @ApiOperation({ summary: '当前用户会员状态' })
  getMe(@CurrentUser() user: AuthUserContext) {
    return this.membershipService.getUserMembershipStatus(user.userId);
  }

  /** 当前用户积分账户、月度额度与流水。 */
  @ApiBearerAuth()
  @Get('points')
  @ApiOperation({ summary: '当前用户积分账户' })
  getPoints(@CurrentUser() user: AuthUserContext) {
    return this.membershipService.getPointSummary(user.userId);
  }

  /** 当前用户积分流水分页。 */
  @ApiBearerAuth()
  @Get('points/ledgers')
  @ApiOperation({ summary: '当前用户积分流水分页' })
  listPointLedgers(
    @Query() query: UserBillingQueryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.pageUserPointLedgers(user.userId, query);
  }

  /** 领取当日积分。 */
  @ApiBearerAuth()
  @Post('points/daily-claim')
  @ApiOperation({ summary: '领取每日积分' })
  claimDailyPoints(@CurrentUser() user: AuthUserContext) {
    return this.membershipService.claimDailyPoints(user.userId);
  }

  /**
   * 购买套餐：演示环境直接模拟支付成功并开通会员。
   */
  @ApiBearerAuth()
  @Post('checkout')
  @ApiOperation({ summary: '购买会员套餐（模拟支付）' })
  checkout(
    @Body() dto: CheckoutPackageDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.checkoutWithMockPay(user.userId, dto);
  }

  /**
   * 创建待支付订单（进入结算页）。
   */
  @ApiBearerAuth()
  @Post('orders')
  @ApiOperation({ summary: '创建待支付会员订单' })
  createOrder(
    @Body() dto: CreateUserOrderDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.createUserPendingOrder(user.userId, dto);
  }

  /**
   * 支付待支付订单（演示环境模拟成功）。
   */
  @ApiBearerAuth()
  @Post('orders/:id/pay')
  @ApiOperation({ summary: '支付会员订单（支付宝网页 / 微信扫码 / 模拟）' })
  payOrder(
    @Param('id') id: string,
    @Body() dto: PayUserOrderDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.payUserOrder(user.userId, id, dto);
  }

  @ApiBearerAuth()
  @Post('orders/by-no/:orderNo/sync')
  @ApiOperation({ summary: '主动查询支付渠道并同步自己的订单' })
  syncOrder(
    @Param('orderNo') orderNo: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.syncUserPaymentOrder(user.userId, orderNo);
  }

  @ApiBearerAuth()
  @Post('orders/:id/cancel')
  @ApiOperation({ summary: '关闭自己的待支付订单' })
  cancelOrder(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.membershipService.cancelUserOrder(user.userId, id);
  }

  /**
   * 当前用户订单列表。
   */
  @ApiBearerAuth()
  @Get('orders')
  @ApiOperation({ summary: '用户端订单列表' })
  listOrders(
    @Query() query: UserBillingQueryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.listUserOrders(user.userId, query);
  }

  /**
   * 当前用户支付流水。
   */
  @ApiBearerAuth()
  @Get('payments')
  @ApiOperation({ summary: '用户端支付流水' })
  listPayments(
    @Query() query: UserBillingQueryDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.listUserPayments(user.userId, query);
  }
}
