import { ApiProperty } from '@nestjs/swagger';
import { CommonStatus, IndicatorSourceTransform } from '@prisma/client';

/** 指标来源映射视图 */
export class IndicatorSourceMappingViewDto {
  @ApiProperty({ description: '映射 ID' })
  id!: string;

  @ApiProperty({ description: '所属指标 ID' })
  indicatorId!: string;

  @ApiProperty({ description: '外部数据源名称' })
  dataSource!: string;

  @ApiProperty({ description: '来源字段编码' })
  sourceField!: string;

  @ApiProperty({ enum: IndicatorSourceTransform, description: '换算/处理方式' })
  transform!: IndicatorSourceTransform;

  @ApiProperty({ enum: CommonStatus, description: '状态' })
  status!: CommonStatus;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ description: '更新时间' })
  updatedAt!: Date;
}
