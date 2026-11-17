import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus } from '@prisma/client';
import { IndicatorSourceMappingViewDto } from './indicator-source-mapping-response.dto';

/** 指标视图 */
export class IndicatorViewDto {
  @ApiProperty({ description: '指标 ID' })
  id!: string;

  @ApiProperty({ description: '指标名称' })
  name!: string;

  @ApiProperty({ description: '指标编码' })
  code!: string;

  @ApiProperty({ description: '指标定义/口径说明' })
  definition!: string;

  @ApiProperty({ description: '计量单位' })
  unit!: string;

  @ApiProperty({ description: '指标分类' })
  category!: string;

  @ApiProperty({ description: '数据来源' })
  source!: string;

  @ApiProperty({ enum: CommonStatus, description: '状态' })
  status!: CommonStatus;

  @ApiProperty({ description: '来源映射数量', example: 1 })
  mappingCount!: number;

  @ApiPropertyOptional({
    type: [IndicatorSourceMappingViewDto],
    description: '来源映射列表（详情接口返回）',
  })
  sourceMappings?: IndicatorSourceMappingViewDto[];

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}

/** 指标分页响应 */
export class IndicatorPageResultDto {
  @ApiProperty({ type: [IndicatorViewDto], description: '当前页数据' })
  items!: IndicatorViewDto[];

  @ApiProperty({ description: '总条数', example: 100 })
  total!: number;

  @ApiProperty({ description: '当前页码', example: 1 })
  page!: number;

  @ApiProperty({ description: '每页条数', example: 20 })
  pageSize!: number;
}
