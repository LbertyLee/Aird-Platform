import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus, FieldMappingSource } from '@prisma/client';

/** 字段映射中的指标摘要 */
export class FieldMappingIndicatorDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  unit!: string;
}

/** 字段映射中的数据集摘要 */
export class FieldMappingDatasetDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;
}

/** 字段映射中的字段摘要 */
export class FieldMappingFieldDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fieldName!: string;

  @ApiPropertyOptional()
  displayName?: string | null;

  @ApiProperty()
  dataType!: string;

  @ApiPropertyOptional()
  semanticType?: string | null;

  @ApiPropertyOptional({ type: FieldMappingDatasetDto })
  dataset?: FieldMappingDatasetDto;
}

/** 指标字段映射视图 */
export class IndicatorFieldMappingViewDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  indicatorId!: string;

  @ApiProperty()
  datasetFieldId!: string;

  @ApiProperty({ description: '聚合方式' })
  aggregation!: string;

  @ApiPropertyOptional()
  formula?: string | null;

  @ApiPropertyOptional()
  condition?: string | null;

  @ApiProperty()
  priority!: number;

  @ApiProperty({ enum: CommonStatus })
  status!: CommonStatus;

  @ApiProperty({ enum: FieldMappingSource })
  source!: FieldMappingSource;

  @ApiPropertyOptional({ description: '自动匹配置信度' })
  confidence?: number | null;

  @ApiPropertyOptional({ description: '命中的指标名/别名' })
  matchTerm?: string | null;

  @ApiProperty({ type: FieldMappingIndicatorDto })
  indicator!: FieldMappingIndicatorDto;

  @ApiProperty({ type: FieldMappingFieldDto })
  datasetField!: FieldMappingFieldDto;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** 数据集字段选项（下拉用） */
export class DatasetFieldOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  fieldName!: string;

  @ApiPropertyOptional()
  displayName?: string | null;

  @ApiProperty()
  dataType!: string;

  @ApiPropertyOptional()
  semanticType?: string | null;

  @ApiProperty()
  datasetId!: string;

  @ApiProperty()
  datasetCode!: string;

  @ApiProperty()
  datasetName!: string;

  @ApiProperty()
  datasetVersionId!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ description: '展示标签' })
  label!: string;
}

/** 知识库结构化文件选项（下拉用） */
export class KnowledgeStructuredDatasetOptionDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  code!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional()
  fileName?: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty({ description: '展示标签' })
  label!: string;
}
