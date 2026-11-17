import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnnouncementAudienceScope,
  AnnouncementStatus,
  BusinessNotificationStatus,
  CommonStatus,
  SensitiveWordCategory,
} from '@prisma/client';

/** 公告视图 */
export class AnnouncementViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty({ enum: AnnouncementAudienceScope })
  audienceScope!: AnnouncementAudienceScope;

  @ApiPropertyOptional({ type: [String], nullable: true })
  audienceRoleIds!: string[] | null;

  @ApiProperty({ enum: AnnouncementStatus })
  status!: AnnouncementStatus;

  @ApiPropertyOptional({ nullable: true })
  publishedAt!: string | null;

  @ApiPropertyOptional({ nullable: true })
  recalledAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/** 公告列表（含状态汇总） */
export class AnnouncementListResultDto {
  @ApiProperty({ type: [AnnouncementViewDto] })
  items!: AnnouncementViewDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty({ description: '草稿数' })
  draftCount!: number;

  @ApiProperty({ description: '已发布数' })
  publishedCount!: number;

  @ApiProperty({ description: '已撤回数' })
  recalledCount!: number;
}

/** 业务通知视图 */
export class BusinessNotificationViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  receiverId!: string;

  @ApiProperty()
  receiverName!: string;

  @ApiProperty({ enum: BusinessNotificationStatus })
  status!: BusinessNotificationStatus;

  @ApiProperty()
  bizType!: string;

  @ApiProperty()
  sentAt!: string;
}

/** 热门词行 */
export class HotWordItemDto {
  @ApiProperty({ description: '排名' })
  rank!: number;

  @ApiProperty()
  keyword!: string;

  @ApiProperty()
  frequency!: number;

  @ApiProperty({ description: '相对上一周期涨跌百分比' })
  trendPercent!: number;

  @ApiProperty({ description: '是否已设为快捷检索' })
  isQuickSearch!: boolean;
}

/** 无结果词行 */
export class NoResultWordItemDto {
  @ApiProperty()
  keyword!: string;

  @ApiProperty()
  lastSearchedAt!: string;

  @ApiProperty()
  frequency!: number;

  @ApiProperty({ description: '是否已处理' })
  handled!: boolean;
}

/** 敏感词视图 */
export class SensitiveWordViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  word!: string;

  @ApiProperty({ enum: SensitiveWordCategory })
  category!: SensitiveWordCategory;

  @ApiProperty()
  hitCount!: number;

  @ApiProperty({ enum: CommonStatus })
  status!: CommonStatus;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}
