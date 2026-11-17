import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus, LocationKind } from '@prisma/client';
import { Type, Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/** 创建字典类型 */
export class CreateDictionaryTypeDto {
  @ApiProperty({ description: '类型编码（小写字母/数字/下划线）' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/, {
    message: '编码需以小写字母开头，仅含小写字母、数字、下划线',
  })
  code!: string;

  @ApiProperty({ description: '类型名称' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ description: '说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新字典类型 */
export class UpdateDictionaryTypeDto {
  @ApiPropertyOptional({ description: '类型编码（系统类型不可改）' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/, {
    message: '编码需以小写字母开头，仅含小写字母、数字、下划线',
  })
  code?: string;

  @ApiPropertyOptional({ description: '类型名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 字典类型列表查询 */
export class DictionaryTypeQueryDto {
  @ApiPropertyOptional({
    description: '仅返回启用中的类型',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  activeOnly?: boolean;
}

/** 创建字典项 */
export class CreateDictionaryDto {
  @ApiProperty({ description: '字典类型编码' })
  @IsString()
  type!: string;

  @ApiPropertyOptional({ enum: LocationKind })
  @IsOptional()
  @IsEnum(LocationKind)
  locationKind?: LocationKind;

  @ApiProperty({ description: '字典编码' })
  @IsString()
  code!: string;

  @ApiProperty({ description: '字典名称' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ type: [String], description: '别名列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ description: '描述说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新字典项 */
export class UpdateDictionaryDto {
  @ApiPropertyOptional({ enum: LocationKind })
  @IsOptional()
  @IsEnum(LocationKind)
  locationKind?: LocationKind;

  @ApiPropertyOptional({ description: '字典名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ type: [String], description: '别名列表' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  aliases?: string[];

  @ApiPropertyOptional({ description: '描述说明' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 字典分页 */
export class DictionaryPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '字典类型编码' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 语义检索 */
export class DictionarySearchDto {
  @ApiProperty({ description: '语义检索关键词' })
  @IsString()
  query!: string;

  @ApiPropertyOptional({ description: '限定字典类型编码' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ default: 10, description: '返回条数，默认 10，最大 50' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  topK?: number = 10;
}

/** 批量删除字典项 */
export class BatchDeleteDictionariesDto {
  @ApiProperty({ type: [String], description: '字典项 ID 列表' })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
