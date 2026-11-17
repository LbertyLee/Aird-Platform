import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** 用户创建个人智能体 */
export class CreateUserAgentDto {
  @ApiProperty({ description: '智能体名称' })
  @IsString()
  @MaxLength(128)
  name!: string;

  @ApiPropertyOptional({ description: '智能体简介' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: '分类编码（字典 agent_category）' })
  @IsString()
  @MaxLength(64)
  categoryCode!: string;

  @ApiPropertyOptional({ description: '图标字符' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  @ApiPropertyOptional({ description: '图标背景颜色' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  iconColor?: string;
}

/** 用户更新个人智能体（仅允许修改自己的记录） */
export class UpdateUserAgentDto {
  @ApiPropertyOptional({ description: '智能体名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ description: '智能体简介' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: '分类编码（字典 agent_category）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryCode?: string;

  @ApiPropertyOptional({ description: '图标字符' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  @ApiPropertyOptional({ description: '图标背景颜色' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  iconColor?: string;
}

/** 管理端创建平台智能体 */
export class CreatePlatformAgentDto extends CreateUserAgentDto {
  @ApiPropertyOptional({ description: '作者名称（由当前登录用户自动设置）' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  author?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '上架状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999999)
  sort?: number;
}

/** 管理端更新智能体 */
export class UpdatePlatformAgentDto {
  @ApiPropertyOptional({ description: '智能体名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({ description: '智能体简介' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: '分类编码（字典 agent_category）' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  categoryCode?: string;

  @ApiPropertyOptional({ description: '作者名称' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  author?: string;

  @ApiPropertyOptional({ description: '图标字符' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  icon?: string;

  @ApiPropertyOptional({ description: '图标背景颜色' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  iconColor?: string;

  @ApiPropertyOptional({ enum: CommonStatus, description: '上架状态' })
  @IsOptional()
  @IsEnum(CommonStatus)
  status?: CommonStatus;

  @ApiPropertyOptional({ description: '排序值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(999999)
  sort?: number;
}
