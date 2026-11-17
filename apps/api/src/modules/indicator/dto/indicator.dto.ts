import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus } from '@prisma/client';
import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/** 创建指标 */
export class CreateIndicatorDto {
  @ApiProperty({ description: '指标名称' })
  @IsString()
  name!: string;

  @ApiProperty({ description: '指标编码' })
  @IsString()
  code!: string;

  @ApiProperty({ description: '指标定义/口径说明' })
  @IsString()
  definition!: string;

  @ApiProperty({ description: '计量单位' })
  @IsString()
  unit!: string;

  @ApiProperty({ description: '指标分类' })
  @IsString()
  category!: string;

  @ApiProperty({ description: '指标来源' })
  @IsString()
  source!: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新指标 */
export class UpdateIndicatorDto {
  @ApiPropertyOptional({ description: '指标名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '指标定义/口径说明' })
  @IsOptional()
  @IsString()
  definition?: string;

  @ApiPropertyOptional({ description: '计量单位' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional({ description: '指标分类' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: '指标来源' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 指标分页查询 */
export class IndicatorPageQueryDto extends PageQueryDto {
  @ApiPropertyOptional({ description: '指标分类' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 批量删除指标 */
export class BatchDeleteIndicatorsDto {
  @ApiProperty({ type: [String], description: '指标 ID 列表' })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

