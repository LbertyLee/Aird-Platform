import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CommonStatus,
  DatasetPublishStatus,
  DatasetVisibility,
} from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  ArrayMaxSize,
  ArrayMinSize,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/** 创建数据集 / 来源 */
export class CreateDatasetDto {
  @ApiProperty({ description: '来源名称' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: '英文名' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: '来源编码；不传则自动生成' })
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional({ description: '来源分类编码（字典 source_category）' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: '地区/层级' })
  @IsOptional()
  @IsString()
  regionLevel?: string;

  @ApiPropertyOptional({ description: '网站链接' })
  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '启用状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '描述说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: DatasetVisibility,
    description: '可见性（public/private），默认 private',
  })
  @IsOptional()
  @IsEnum(DatasetVisibility)
  visibility?: DatasetVisibility;

  @ApiPropertyOptional({
    type: [String],
    description: '关联指标 ID 列表',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  indicatorIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: '关联字典项 ID 列表',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  dictionaryItemIds?: string[];
}

/** 更新数据集 / 来源 */
export class UpdateDatasetDto {
  @ApiPropertyOptional({ description: '来源名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '英文名' })
  @IsOptional()
  @IsString()
  nameEn?: string;

  @ApiPropertyOptional({ description: '来源分类编码（字典 source_category）' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: '地区/层级' })
  @IsOptional()
  @IsString()
  regionLevel?: string;

  @ApiPropertyOptional({ description: '网站链接' })
  @IsOptional()
  @IsString()
  websiteUrl?: string;

  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '启用状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '描述说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    enum: DatasetVisibility,
    description: '可见性（public/private）',
  })
  @IsOptional()
  @IsEnum(DatasetVisibility)
  visibility?: DatasetVisibility;

  @ApiPropertyOptional({
    type: [String],
    description: '关联指标 ID 列表（传入则全量替换）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  indicatorIds?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: '关联字典项 ID 列表（传入则全量替换）',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  dictionaryItemIds?: string[];
}

/** 数据集 / 来源分页 */
export class DatasetPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    enum: DatasetVisibility,
    description: '可见性过滤',
  })
  @IsOptional()
  @IsEnum(DatasetVisibility)
  visibility?: DatasetVisibility;

  @ApiPropertyOptional({
    enum: DatasetPublishStatus,
    description: '上架状态过滤',
  })
  @IsOptional()
  @IsEnum(DatasetPublishStatus)
  publishStatus?: DatasetPublishStatus;

  @ApiPropertyOptional({ enum: CommonStatus, description: '启用状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '来源分类编码' })
  @IsOptional()
  @IsString()
  categoryCode?: string;

  @ApiPropertyOptional({ description: '地区/层级（精确匹配）' })
  @IsOptional()
  @IsString()
  regionLevel?: string;
}

/** 批量删除来源 */
export class BatchDeleteDatasetsDto {
  @ApiProperty({ type: [String], description: '来源 ID 列表' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}
