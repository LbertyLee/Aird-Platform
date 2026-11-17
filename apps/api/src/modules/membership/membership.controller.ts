import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { AuthUserContext } from '../../common/types/auth-user.context';
import {
  ApplyInvoiceDto,
  BindBenefitsDto,
  CreateLevelDto,
  CreateOrderDto,
  CreatePackageDto,
  GrantUserSubscriptionDto,
  MembershipPageQueryDto,
  MockPayCallbackDto,
  RefundOrderDto,
  UpdateLevelDto,
  UpdatePackageDto,
  UpdatePointRulesDto,
} from './dto/membership.dto';
import { MembershipService } from './membership.service';

/**
 * 会员管理 HTTP 入口。
 */
@ApiTags('管理端-会员')
@ApiBearerAuth()
@Controller('admin/membership')
export class MembershipController {
  /**
   * @param membershipService 会员服务
   */
  constructor(private readonly membershipService: MembershipService) {}

  /**
   * 会员管理总览。
   */
  @Get('overview')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '会员管理总览' })
  getOverview() {
    return this.membershipService.getOverview();
  }

  @Get('points/accounts')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '用户积分账户分页' })
  pagePointAccounts(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.pagePointAccounts(query);
  }

  @Get('points/accounts/:userId/ledgers')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '用户积分流水' })
  listPointLedgers(@Param('userId') userId: string) {
    return this.membershipService.listPointLedgers(userId);
  }

  @Get('points/rules')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '积分发放与计费规则' })
  getPointRules() {
    return this.membershipService.getPointRules();
  }

  @Put('points/rules')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '更新积分发放与计费规则' })
  updatePointRules(
    @Body() dto: UpdatePointRulesDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.updatePointRules(dto, user.userId);
  }

  /**
   * 套餐分页。
   */
  @Get('packages')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '会员套餐列表' })
  listPackages(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.listPackages(query);
  }

  /**
   * 创建套餐。
   */
  @Post('packages')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '创建会员套餐' })
  createPackage(
    @Body() dto: CreatePackageDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.createPackage(dto, user.userId);
  }

  /**
   * 更新套餐。
   */
  @Put('packages/:id')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '更新会员套餐' })
  updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.updatePackage(id, dto, user.userId);
  }

  /**
   * 下架套餐。
   */
  @Patch('packages/:id/off-shelf')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '下架会员套餐' })
  offShelfPackage(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.offShelfPackage(id, user.userId);
  }

  /**
   * 上架套餐。
   */
  @Patch('packages/:id/on-shelf')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '上架会员套餐' })
  onShelfPackage(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.onShelfPackage(id, user.userId);
  }

  /**
   * 创建等级。
   */
  @Post('levels')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '创建会员等级' })
  createLevel(
    @Body() dto: CreateLevelDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.createLevel(dto, user.userId);
  }

  /**
   * 可分配会员等级列表（须在 levels 静态路由之前注册）。
   */
  @Get('levels/assignable')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '可分配会员等级' })
  listAssignableLevels() {
    return this.membershipService.listAssignableLevels();
  }

  /**
   * 等级分页。
   */
  @Get('levels')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '会员等级分页' })
  pageLevels(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.pageLevels(query);
  }

  /**
   * 更新等级。
   */
  @Put('levels/:id')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '更新会员等级' })
  updateLevel(
    @Param('id') id: string,
    @Body() dto: UpdateLevelDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.updateLevel(id, dto, user.userId);
  }

  /**
   * 下架等级。
   */
  @Patch('levels/:id/disable')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '下架会员等级' })
  disableLevel(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.membershipService.disableLevel(id, user.userId);
  }

  /**
   * 配置等级权益。
   */
  @Put('levels/:id/benefits')
  @RequirePermissions('button:membership:bind_benefit')
  @ApiOperation({ summary: '绑定等级权益' })
  bindBenefits(
    @Param('id') id: string,
    @Body() dto: BindBenefitsDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.bindBenefits(id, dto, user.userId);
  }

  /**
   * 权益定义列表。
   */
  @Get('benefits')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '权益定义列表' })
  listBenefits() {
    return this.membershipService.listBenefitDefinitions();
  }

  /**
   * 创建订单。
   */
  @Post('orders')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '创建会员订单' })
  createOrder(
    @Body() dto: CreateOrderDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.createOrder(dto, user.userId);
  }

  /**
   * 订单分页。
   */
  @Get('orders')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '订单分页' })
  pageOrders(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.pageOrders(query);
  }

  @Get('payment-operation-logs')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '支付全链路事件日志' })
  pagePaymentOperationLogs(
    @Query() query: MembershipPageQueryDto,
    @Query('orderNo') orderNo?: string,
    @Query('action') action?: string,
    @Query('status') status?: string,
  ) {
    return this.membershipService.pagePaymentOperationLogs(query, {
      orderNo,
      action,
      status,
    });
  }

  /**
   * 订单详情。
   */
  @Get('orders/:id')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '订单详情' })
  getOrder(@Param('id') id: string) {
    return this.membershipService.getOrderDetail(id);
  }

  /**
   * 关闭订单。
   */
  @Patch('orders/:id/cancel')
  @RequirePermissions('button:payment:order:close')
  @ApiOperation({ summary: '关闭待支付订单' })
  cancelOrder(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.membershipService.cancelOrder(id, user.userId);
  }

  /**
   * 订单退款。
   */
  @Post('orders/:id/refund')
  @RequirePermissions('button:payment:order:refund')
  @ApiOperation({ summary: '订单退款' })
  refundOrder(
    @Param('id') id: string,
    @Body() dto: RefundOrderDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.refundOrder(id, dto, user.userId);
  }

  /**
   * 处理回调异常。
   */
  @Post('orders/:id/reconcile')
  @RequirePermissions('button:payment:order:process')
  @ApiOperation({ summary: '处理回调异常订单' })
  reconcileOrder(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.reconcileOrder(id, user.userId);
  }

  /**
   * 退款流水。
   */
  @Get('orders/:id/refunds')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '订单退款流水' })
  listRefunds(@Param('id') id: string) {
    return this.membershipService.listOrderRefunds(id);
  }

  /**
   * Mock 支付回调（公开，一期联调）。
   */
  @RequirePermissions('menu:membership:order')
  @Post('payments/callback')
  @ApiOperation({ summary: 'Mock 支付回调' })
  payCallback(@Body() dto: MockPayCallbackDto) {
    return this.membershipService.mockPayCallback(dto);
  }

  /**
   * 支付流水分页。
   */
  @Get('payments')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '支付流水' })
  pagePayments(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.pagePayments(query);
  }

  /**
   * 申请发票。
   */
  @Post('invoices')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '申请发票' })
  applyInvoice(
    @Body() dto: ApplyInvoiceDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.applyInvoice(dto, user.userId);
  }

  /**
   * 发票分页。
   */
  @Get('invoices')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '发票列表' })
  pageInvoices(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.pageInvoices(query);
  }

  /**
   * 开具发票。
   */
  @Patch('invoices/:id/issue')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '开具发票' })
  issueInvoice(@Param('id') id: string, @CurrentUser() user: AuthUserContext) {
    return this.membershipService.issueInvoice(id, user.userId);
  }

  /**
   * 续费提醒候选。
   */
  @Get('reminders/candidates')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '续费提醒候选列表' })
  listRenewalCandidates() {
    return this.membershipService.listRenewalCandidates();
  }

  /**
   * 发送单条续费提醒。
   */
  @Post('reminders/:subscriptionId/send')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '发送续费提醒' })
  sendReminder(
    @Param('subscriptionId') subscriptionId: string,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.sendReminder(subscriptionId, user.userId);
  }

  /**
   * 批量发送续费提醒。
   */
  @Post('reminders/batch-send')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '批量发送续费提醒' })
  batchSendReminders(@CurrentUser() user: AuthUserContext) {
    return this.membershipService.batchSendReminders(user.userId);
  }

  /**
   * 续费提醒列表。
   */
  @Get('reminders')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '续费提醒列表' })
  pageReminders(@Query() query: MembershipPageQueryDto) {
    return this.membershipService.pageReminders(query);
  }

  /**
   * 为有效订阅生成续费提醒。
   */
  @Post('reminders/schedule')
  @RequirePermissions('menu:membership:order')
  @ApiOperation({ summary: '调度续费提醒' })
  scheduleReminders(@CurrentUser() user: AuthUserContext) {
    return this.membershipService.scheduleRenewalReminders(user.userId);
  }

  /**
   * 查询指定用户有效权益。
   */
  @Get('entitlements/:userId')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '用户有效权益' })
  entitlements(@Param('userId') userId: string) {
    return this.membershipService.resolveEntitlements(userId);
  }

  /**
   * 查询用户个人会员订阅。
   */
  @Get('subscriptions/user/:userId')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '用户个人会员订阅' })
  userSubscriptions(@Param('userId') userId: string) {
    return this.membershipService.listUserSubscriptions(userId);
  }

  /**
   * 管理员为用户直接分配会员等级。
   */
  @Post('subscriptions/user')
  @RequirePermissions('menu:membership:level')
  @ApiOperation({ summary: '分配用户会员等级' })
  grantUserSubscription(
    @Body() dto: GrantUserSubscriptionDto,
    @CurrentUser() user: AuthUserContext,
  ) {
    return this.membershipService.grantUserSubscription(dto, user.userId);
  }
}
