import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { DASHBOARD_DEFAULT_TIMEZONE } from '../dashboard-timezone.util';

/**
 * 看板时间范围查询。
 */
export class DashboardRangeQueryDto {
  /** 开始日期 YYYY-MM-DD（业务时区） */
  @ApiPropertyOptional({
    description: '开始日期 YYYY-MM-DD（业务时区日历日）',
    example: '2026-08-01',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate?: string;

  /** 结束日期 YYYY-MM-DD（业务时区） */
  @ApiPropertyOptional({
    description: '结束日期 YYYY-MM-DD（业务时区日历日）',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate?: string;

  /** 业务时区 */
  @ApiPropertyOptional({
    description: '业务时区，默认 Asia/Shanghai',
    default: DASHBOARD_DEFAULT_TIMEZONE,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string = DASHBOARD_DEFAULT_TIMEZONE;
}

/**
 * 聚合刷新请求（与范围查询字段一致）。
 */
export class DashboardAggregateBodyDto extends DashboardRangeQueryDto {}

/**
 * Swagger：指标口径。
 */
export class DashboardMetricDefinitionDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  definition!: string;

  @ApiProperty()
  available!: boolean;

  @ApiProperty({ nullable: true, type: String })
  source!: string | null;
}
