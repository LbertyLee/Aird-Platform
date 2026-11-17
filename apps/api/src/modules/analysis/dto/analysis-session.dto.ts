import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AnalysisVisualView } from '@agent/contracts';

export class CreateAnalysisSessionDto {
  @ApiProperty({ description: '本次检索运行 ID' })
  @IsString()
  runId!: string;

  @ApiProperty({ type: [String], description: '用户在检索结果中选中的来源 ID' })
  @IsArray()
  @IsString({ each: true })
  sourceIds!: string[];

  @ApiPropertyOptional({ type: [String], description: '优先使用的后台指标 ID' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  indicatorIds?: string[];

  @ApiProperty({ minLength: 2, maxLength: 500 })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query!: string;
}

export class ExportAnalysisSessionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  columns?: string[];
}

export class RecentAnalysisSessionsDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  runIds!: string[];
}

export class AnalysisPresentationDto {
  @IsString()
  @MaxLength(500)
  datasetId!: string;

  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  entities!: string[];

  @IsString()
  @MaxLength(100)
  startPeriod!: string;

  @IsString()
  @MaxLength(100)
  endPeriod!: string;

  @IsString()
  @MaxLength(100)
  currentPeriod!: string;

  @IsIn(['line', 'map', 'table'])
  view!: AnalysisVisualView;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(['line', 'map', 'table'], { each: true })
  reportViews!: AnalysisVisualView[];
}
