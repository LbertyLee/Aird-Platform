import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsNumber,
  MaxLength,
  MinLength,
  ValidateNested,
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

export class RecentAnalysisSessionsDto {
  @IsArray()
  @ArrayMaxSize(4)
  @ArrayMinSize(1)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  runIds!: string[];
}

export class AnalysisPresentationDto {
  @ApiPropertyOptional({
    type: [String],
    description: '工作台筛选来源，省略时使用全部已提取来源',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  sourceIds?: string[];

  @IsString()
  @MaxLength(500)
  datasetId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  comparisonDatasetIds?: string[];

  @IsArray()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  entities!: string[];

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  periods?: string[];

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

export class ReportSectionEditDto {
  @IsString() @MaxLength(500) title!: string;
  @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(10000, { each: true }) paragraphs!: string[];
}

export class ReportPointEditDto {
  @IsString() @MaxLength(500) datasetId!: string;
  @IsString() @MaxLength(300) entity!: string;
  @IsString() @MaxLength(100) period!: string;
  @IsOptional() @IsNumber() value!: number | null;
}

export class AnalysisReportEditDto {
  @IsString() @MaxLength(500) title!: string;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ReportSectionEditDto) sections!: ReportSectionEditDto[];
  @IsArray() @ArrayMaxSize(50000) @ValidateNested({ each: true }) @Type(() => ReportPointEditDto) edits!: ReportPointEditDto[];
}

export class ExportAnalysisSessionDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  columns?: string[];

  @ApiPropertyOptional({
    type: AnalysisPresentationDto,
    description: '导出当前工作台矩阵，省略时导出原始结构化记录',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AnalysisPresentationDto)
  presentation?: AnalysisPresentationDto;
}
