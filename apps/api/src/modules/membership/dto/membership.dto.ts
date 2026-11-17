import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BuyerType,
  MembershipScope,
  OrderStatus,
  PackageTag,
  PackageType,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/**
 * 创建会员等级请求。
 */
export class CreateLevelDto {
  /** 等级编码 */
  @ApiProperty({ description: '等级编码' })
  @IsString()
  code!: string;

  /** 等级名称 */
  @ApiProperty({ description: '等级名称' })
  @IsString()
  name!: string;

  /** 适用范围 */
  @ApiProperty({ enum: MembershipScope, description: '适用范围（个人）' })
  @IsEnum(MembershipScope)
  scope!: MembershipScope;

  /** 价格 */
  @ApiProperty({ description: '价格' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  /** 有效天数（兼容兜底；实际以套餐 durationDays 为准，可不传，默认 30） */
  @ApiPropertyOptional({
    description: '有效天数（兼容字段，默认 30；实际时长以套餐为准）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;

  /** 排序 */
  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  /** 会员月度赠送积分 */
  @ApiPropertyOptional({ description: '会员月度赠送积分' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyPoints?: number;

  /** 说明 */
  @ApiPropertyOptional({ description: '等级说明' })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * 更新会员等级请求。
 */
export class UpdateLevelDto {
  /** 等级名称 */
  @ApiPropertyOptional({ description: '等级名称' })
  @IsOptional()
  @IsString()
  name?: string;

  /** 适用范围 */
  @ApiPropertyOptional({
    enum: MembershipScope,
    description: '适用范围（个人）',
  })
  @IsOptional()
  @IsEnum(MembershipScope)
  scope?: MembershipScope;

  /** 价格 */
  @ApiPropertyOptional({ description: '价格' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  /** 有效天数 */
  @ApiPropertyOptional({ description: '有效天数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;

  /** 排序 */
  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  /** 会员月度赠送积分 */
  @ApiPropertyOptional({ description: '会员月度赠送积分' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyPoints?: number;

  /** 说明 */
  @ApiPropertyOptional({ description: '等级说明' })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * 会员等级月度积分项。
 */
export class LevelMonthlyPointsItemDto {
  /** 等级 ID */
  @ApiProperty({ description: '会员等级 ID' })
  @IsString()
  levelId!: string;

  /** 月度赠送积分 */
  @ApiProperty({ description: '会员月度赠送积分' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyPoints!: number;
}

/** 单个模型的 Token 单价配置（元/百万 Token）。 */
export class ModelPricingItemDto {
  @ApiProperty({ description: '模型名称；default 表示未精确匹配时的兜底价格' })
  @IsString()
  model!: string;

  @ApiProperty({ description: '输入 Token 单价（元/百万 Token）' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  inputYuanPerMillionTokens!: number;

  @ApiProperty({ description: '输出 Token 单价（元/百万 Token）' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  outputYuanPerMillionTokens!: number;
}

/**
 * 更新积分发放与计费规则。
 */
export class UpdatePointRulesDto {
  /** 注册赠送积分 */
  @ApiProperty({ description: '注册赠送积分' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  registrationPoints!: number;

  /** 每月自动赠送积分 */
  @ApiProperty({ description: '每月自动赠送积分' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyFreePoints!: number;

  /** 每日可领取积分 */
  @ApiProperty({ description: '每日可领取积分' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  dailyPoints!: number;

  /** 免费赠分自然月上限 */
  @ApiProperty({ description: '免费赠分自然月上限' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  freeMonthlyLimit!: number;

  /** 历史固定扣分字段，已废弃；保留仅为兼容旧客户端。 */
  @ApiPropertyOptional({ description: '历史固定扣分字段（已废弃）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  searchCostPoints?: number;

  /** 发起 AI 智搜所需的最低积分余额 */
  @ApiProperty({ description: '发起 AI 智搜所需的最低积分余额' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minSearchPoints!: number;

  /** 积分折算单价（元/积分） */
  @ApiProperty({ description: '积分折算单价（元/积分）' })
  @Type(() => Number)
  @IsNumber()
  @Min(0.000001)
  yuanPerPoint!: number;

  /** 模型 Token 单价 */
  @ApiProperty({
    type: [ModelPricingItemDto],
    description: '模型 Token 单价（元/百万 Token）',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ModelPricingItemDto)
  modelPricing!: ModelPricingItemDto[];

  /** 各会员等级月度积分 */
  @ApiPropertyOptional({
    type: [LevelMonthlyPointsItemDto],
    description: '会员等级月度积分',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LevelMonthlyPointsItemDto)
  levelMonthlyPoints?: LevelMonthlyPointsItemDto[];
}

/**
 * 权益绑定项。
 */
export class BenefitBindItemDto {
  /** 权益码 */
  @ApiProperty({ description: '权益码' })
  @IsString()
  benefitCode!: string;

  /** 值 JSON，如 { n: 20 } 或 { bytes: 1073741824 } */
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: '权益值 JSON，如 { n: 20 } 或 { bytes: 1073741824 }',
  })
  @IsObject()
  valueJson!: Record<string, unknown>;
}

/**
 * 绑定权益请求。
 */
export class BindBenefitsDto {
  /** 权益列表 */
  @ApiProperty({ type: [BenefitBindItemDto], description: '权益绑定列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BenefitBindItemDto)
  items!: BenefitBindItemDto[];
}

/**
 * 创建订单请求。
 */
export class CreateOrderDto {
  /** 买方类型 */
  @ApiProperty({ enum: BuyerType, description: '买方类型（用户）' })
  @IsEnum(BuyerType)
  buyerType!: BuyerType;

  /** 买方用户 ID */
  @ApiProperty({ description: '买方用户 ID' })
  @IsString()
  buyerId!: string;

  /** 套餐 ID */
  @ApiProperty({ description: '会员套餐 ID' })
  @IsString()
  packageId!: string;

  /** 备注 */
  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

/**
 * 支付回调（Mock）。
 */
export class MockPayCallbackDto {
  /** 订单号 */
  @ApiProperty({ description: '订单号' })
  @IsString()
  orderNo!: string;

  /** 渠道交易号 */
  @ApiPropertyOptional({ description: '渠道交易号' })
  @IsOptional()
  @IsString()
  tradeNo?: string;

  /** 支付渠道：wechat / alipay / mock */
  @ApiPropertyOptional({ description: '支付渠道' })
  @IsOptional()
  @IsString()
  channel?: string;
}

/**
 * 申请发票。
 */
export class ApplyInvoiceDto {
  /** 订单 ID */
  @ApiProperty({ description: '订单 ID' })
  @IsString()
  orderId!: string;

  /** 抬头 */
  @ApiProperty({ description: '发票抬头' })
  @IsString()
  title!: string;

  /** 税号 */
  @ApiPropertyOptional({ description: '税号' })
  @IsOptional()
  @IsString()
  taxNo?: string;
}

/**
 * 管理员直接为用户开通/覆盖个人会员等级。
 */
export class GrantUserSubscriptionDto {
  /** 用户 ID */
  @ApiProperty({ description: '用户 ID' })
  @IsString()
  userId!: string;

  /** 会员等级 ID */
  @ApiProperty({ description: '会员等级 ID' })
  @IsString()
  levelId!: string;

  /** 套餐 ID；不传则使用该等级默认套餐 */
  @ApiPropertyOptional({ description: '会员套餐 ID' })
  @IsOptional()
  @IsString()
  packageId?: string;

  /** 有效天数；不传则使用套餐/等级默认天数 */
  @ApiPropertyOptional({
    description: '有效天数；不传则使用默认天数',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;
}

/**
 * 等级/订单分页。
 */
export class MembershipPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: OrderStatus, description: '订单状态' })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({
    description: '支付渠道：wechat | alipay | mock',
  })
  @IsOptional()
  @IsString()
  paymentChannel?: string;
}

/**
 * 创建会员套餐。
 */
export class CreatePackageDto {
  @ApiProperty({ description: '会员等级 ID' })
  @IsString()
  levelId!: string;

  @ApiProperty({ enum: PackageType, description: '套餐周期类型' })
  @IsEnum(PackageType)
  packageType!: PackageType;

  @ApiProperty({ description: '展示名称，如单月' })
  @IsString()
  name!: string;

  @ApiProperty({ description: '售价' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiPropertyOptional({ description: '原价（划线价）' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  originalPrice?: number;

  @ApiPropertyOptional({ description: '价格展示文案，如 ¥59 / 月' })
  @IsOptional()
  @IsString()
  priceLabel?: string;

  @ApiPropertyOptional({ description: '说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: PackageTag, description: '营销标签' })
  @IsOptional()
  @IsEnum(PackageTag)
  tag?: PackageTag;

  @ApiProperty({ description: '有效天数' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays!: number;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;
}

/**
 * 更新会员套餐。
 */
export class UpdatePackageDto {
  @ApiPropertyOptional({ description: '展示名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '售价' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiPropertyOptional({ description: '原价' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  originalPrice?: number;

  @ApiPropertyOptional({ description: '价格展示文案' })
  @IsOptional()
  @IsString()
  priceLabel?: string;

  @ApiPropertyOptional({ description: '说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: PackageTag, description: '营销标签' })
  @IsOptional()
  @IsEnum(PackageTag)
  tag?: PackageTag;

  @ApiPropertyOptional({ description: '有效天数' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationDays?: number;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;
}

/**
 * 退款请求。
 */
export class RefundOrderDto {
  @ApiPropertyOptional({ description: '退款原因' })
  @IsOptional()
  @IsString()
  reason?: string;
}

/**
 * 用户端购买套餐（演示环境模拟支付）。
 */
export class CheckoutPackageDto {
  @ApiProperty({ description: '会员套餐 ID' })
  @IsString()
  packageId!: string;
}

/**
 * 用户端创建待支付订单。
 */
export class CreateUserOrderDto {
  @ApiProperty({ description: '会员套餐 ID' })
  @IsString()
  packageId!: string;
}

/**
 * 用户端支付待支付订单（演示环境模拟成功）。
 */
export class PayUserOrderDto {
  @ApiProperty({
    description: '支付渠道：wechat / alipay',
    enum: ['wechat', 'alipay'],
  })
  @IsString()
  channel!: string;

  @ApiPropertyOptional({
    description: '支付宝电脑网站收银台；旧版 qr 参数兼容为 page',
    enum: ['qr', 'page'],
    default: 'page',
  })
  @IsOptional()
  @IsIn(['qr', 'page'])
  alipayMode?: 'qr' | 'page';
}

/**
 * 用户端账单查询。
 */
export class UserBillingQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: '订单/支付状态过滤；不传为全部',
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: '时间范围：all | 7d | 30d | 90d',
  })
  @IsOptional()
  @IsString()
  timeRange?: string;
}
