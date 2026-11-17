import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus, IndicatorSourceTransform } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';

/** 创建来源映射 */
export class CreateIndicatorSourceMappingDto {
  @ApiProperty({ description: '外部数据源名称', example: '世界银行 WDI' })
  @IsString()
  dataSource!: string;

  @ApiProperty({ description: '来源字段编码', example: 'WDI.NY.GDP.MKTP.KD.ZG' })
  @IsString()
  sourceField!: string;

  @ApiPropertyOptional({
    enum: IndicatorSourceTransform,
    default: IndicatorSourceTransform.direct,
    description: '换算/处理方式',
  })
  @IsOptional()
  @IsEnum(IndicatorSourceTransform)
  transform?: IndicatorSourceTransform;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}

/** 更新来源映射 */
export class UpdateIndicatorSourceMappingDto {
  @ApiPropertyOptional({ description: '外部数据源名称' })
  @IsOptional()
  @IsString()
  dataSource?: string;

  @ApiPropertyOptional({ description: '来源字段编码' })
  @IsOptional()
  @IsString()
  sourceField?: string;

  @ApiPropertyOptional({ enum: IndicatorSourceTransform, description: '换算/处理方式' })
  @IsOptional()
  @IsEnum(IndicatorSourceTransform)
  transform?: IndicatorSourceTransform;

  @ApiPropertyOptional({ enum: CommonStatus, description: '状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;
}
