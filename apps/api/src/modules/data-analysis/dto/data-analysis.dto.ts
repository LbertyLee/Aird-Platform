import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ResearchFiltersDto } from '../../../research/dto/search-research.dto';
import type { ResearchSearchMode } from '@agent/contracts';

export class SearchDataAnalysisDto {
  @ApiProperty({
    example: '比较中国近十年城镇人口占比变化，并结合知识库中的政策解读',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(500)
  query!: string;

  @ValidateNested()
  @Type(() => ResearchFiltersDto)
  @IsOptional()
  filters?: ResearchFiltersDto;

  @ApiProperty({ required: false, enum: ['mixed', 'exa', 'knowledge', 'ai-search'], default: 'mixed' })
  @IsOptional()
  @IsIn(['mixed', 'exa', 'knowledge', 'ai-search'])
  mode?: ResearchSearchMode;

  @ApiProperty({ required: false, description: '用户选择的模型值，由后台配置的可选模型白名单校验' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;
}
