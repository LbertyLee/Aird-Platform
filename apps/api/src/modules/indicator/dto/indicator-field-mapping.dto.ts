import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus, FieldMappingSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/** 字段映射分页查询 */
export class FieldMappingPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '按指标 ID 过滤' })
  @IsOptional()
  @IsString()
  indicatorId?: string;

  @ApiPropertyOptional({ description: '按数据集 ID 过滤' })
  @IsOptional()
  @IsString()
  datasetId?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({
    enum: FieldMappingSource,
    description: '来源：manual / auto / auto_pending',
  })
  @IsOptional()
  @IsEnum(FieldMappingSource)
  source?: FieldMappingSource;
}

/** 创建指标字段映射 */
export class CreateIndicatorFieldMappingDto {
  @ApiProperty({ description: '指标 ID' })
  @IsString()
  indicatorId!: string;

  @ApiProperty({ description: '数据集字段 ID' })
  @IsString()
  datasetFieldId!: string;

  @ApiPropertyOptional({
    description: '聚合方式',
    example: 'SUM',
    default: 'SUM',
  })
  @IsOptional()
  @IsString()
  aggregation?: string;

  @ApiPropertyOptional({ description: '计算公式' })
  @IsOptional()
  @IsString()
  formula?: string;

  @ApiPropertyOptional({ description: '过滤条件' })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({ description: '优先级（越大越优先）', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  priority?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新指标字段映射 */
export class UpdateIndicatorFieldMappingDto {
  @ApiPropertyOptional({ description: '指标 ID' })
  @IsOptional()
  @IsString()
  indicatorId?: string;

  @ApiPropertyOptional({ description: '数据集字段 ID' })
  @IsOptional()
  @IsString()
  datasetFieldId?: string;

  @ApiPropertyOptional({ description: '聚合方式' })
  @IsOptional()
  @IsString()
  aggregation?: string;

  @ApiPropertyOptional({ description: '计算公式' })
  @IsOptional()
  @IsString()
  formula?: string;

  @ApiPropertyOptional({ description: '过滤条件' })
  @IsOptional()
  @IsString()
  condition?: string;

  @ApiPropertyOptional({ description: '优先级' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  priority?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 批量删除字段映射 */
export class BatchDeleteFieldMappingsDto {
  @ApiProperty({ description: '映射 ID 列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

/** 批量采纳 / 忽略自动映射 */
export class BatchReviewFieldMappingsDto {
  @ApiProperty({ description: '映射 ID 列表', type: [String] })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

/** 重新跑自动字段映射 */
export class ReapplyFieldMappingsDto {
  @ApiPropertyOptional({
    description: '限定数据集 ID；不传则对知识库结构化 READY 全量重跑',
  })
  @IsOptional()
  @IsString()
  datasetId?: string;
}

/** 可选数据集字段查询 */
export class DatasetFieldOptionsQueryDto {
  @ApiPropertyOptional({ description: '按数据集 ID 过滤' })
  @IsOptional()
  @IsString()
  datasetId?: string;

  @ApiPropertyOptional({ description: '关键字（字段名）' })
  @IsOptional()
  @IsString()
  keyword?: string;
}
