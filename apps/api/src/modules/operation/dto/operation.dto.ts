import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AnnouncementAudienceScope,
  AnnouncementStatus,
  BusinessNotificationStatus,
  CommonStatus,
  SensitiveWordCategory,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/** 公告分页查询 */
export class AnnouncementPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: AnnouncementStatus })
  @IsOptional()
  @IsEnum(AnnouncementStatus)
  status?: AnnouncementStatus;
}

/** 创建 / 更新公告正文 */
export class UpsertAnnouncementDto {
  @ApiProperty({ description: '公告标题，最多 60 字' })
  @IsString()
  @MinLength(1, { message: '公告标题不能为空' })
  @MaxLength(60, { message: '公告标题最多 60 字' })
  title!: string;

  @ApiProperty({ description: '公告内容，最多 500 字' })
  @IsString()
  @MinLength(1, { message: '公告内容不能为空' })
  @MaxLength(500, { message: '公告内容最多 500 字' })
  content!: string;

  @ApiProperty({ enum: AnnouncementAudienceScope, description: '接收范围' })
  @IsEnum(AnnouncementAudienceScope)
  audienceScope!: AnnouncementAudienceScope;

  @ApiPropertyOptional({ type: [String], description: '指定角色 ID 列表' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  audienceRoleIds?: string[];
}

/** 创建公告时可指定是否立即发布 */
export class CreateAnnouncementDto extends UpsertAnnouncementDto {
  @ApiPropertyOptional({
    description: '是否立即发布；默认存草稿',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

/** 业务通知分页 */
export class NotificationPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: BusinessNotificationStatus })
  @IsOptional()
  @IsEnum(BusinessNotificationStatus)
  status?: BusinessNotificationStatus;

  @ApiPropertyOptional({ description: '业务类型，如 payment_success' })
  @IsOptional()
  @IsString()
  bizType?: string;

  @ApiPropertyOptional({
    description: '时间范围：all | today | 7d | 30d',
  })
  @IsOptional()
  @IsString()
  timeRange?: string;

  @ApiPropertyOptional({ description: '接收人用户名/显示名关键字' })
  @IsOptional()
  @IsString()
  receiver?: string;
}

/** 热门词 / 无结果词时间范围 */
export class SearchOpsRangeQueryDto {
  @ApiPropertyOptional({
    description: '统计窗口：7d 或 30d',
    default: '7d',
    enum: ['7d', '30d'],
  })
  @IsOptional()
  @IsString()
  range?: '7d' | '30d' = '7d';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 50;
}

/** 设为快捷检索 */
export class SetQuickSearchDto {
  @ApiProperty({ description: '搜索词' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  keyword!: string;
}

/** 标记无结果词已处理 */
export class MarkNoResultDto {
  @ApiProperty({ description: '搜索词' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  keyword!: string;

  @ApiPropertyOptional({ description: '处理备注' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  note?: string;
}

/** 创建敏感词 */
export class CreateSensitiveWordDto {
  @ApiProperty({ description: '敏感词' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  word!: string;

  @ApiProperty({ enum: SensitiveWordCategory })
  @IsEnum(SensitiveWordCategory)
  category!: SensitiveWordCategory;

  @ApiPropertyOptional({ enum: CommonStatus })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新敏感词 */
export class UpdateSensitiveWordDto {
  @ApiPropertyOptional({ description: '敏感词' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  word?: string;

  @ApiPropertyOptional({ enum: SensitiveWordCategory })
  @IsOptional()
  @IsEnum(SensitiveWordCategory)
  category?: SensitiveWordCategory;

  @ApiPropertyOptional({ enum: CommonStatus })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 敏感词分页 */
export class SensitiveWordPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ enum: CommonStatus })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ enum: SensitiveWordCategory })
  @IsOptional()
  @IsEnum(SensitiveWordCategory)
  category?: SensitiveWordCategory;
}
