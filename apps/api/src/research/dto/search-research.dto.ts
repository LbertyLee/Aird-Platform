import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ResearchFiltersDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  countries?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  regions?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  entities?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  indicators?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  timeRanges?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sources?: string[];

  @ApiProperty({ required: false, type: [String], description: '指定知识库 ID，与来源筛选互斥' })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  libraryIds?: string[];
}

export class SearchResearchDto {
  @ApiProperty({
    example: '比较中国、日本与韩国近十年的城镇人口占比变化',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query!: string;

  @ValidateNested()
  @Type(() => ResearchFiltersDto)
  @IsOptional()
  filters?: ResearchFiltersDto;

  @ApiProperty({ enum: ['mixed', 'exa', 'knowledge', 'ai-search'], default: 'mixed' })
  @IsIn(['mixed', 'exa', 'knowledge', 'ai-search'])
  @IsOptional()
  mode?: 'mixed' | 'exa' | 'knowledge' | 'ai-search';
}

export class GenerateResearchReportDto {
  @ApiProperty({ example: '中国、日本和韩国的城镇人口占比变化' })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query!: string;

  @ApiProperty({ example: ['source-id-1'], type: [String] })
  @IsArray()
  @IsString({ each: true })
  sourceIds!: string[];
}
