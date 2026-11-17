import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/**
 * 创建用户请求。
 */
export class CreateUserDto {
  /** 登录名 */
  @ApiProperty({ description: '登录用户名' })
  @IsString()
  username!: string;

  /** 初始密码，可选则自动生成 */
  @ApiPropertyOptional({ description: '初始密码，不传则自动生成' })
  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;

  /** 邮箱 */
  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail()
  email?: string;

  /** 手机号 */
  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @IsString()
  phone?: string;

  /** 显示名 */
  @ApiPropertyOptional({ description: '显示名称' })
  @IsOptional()
  @IsString()
  displayName?: string;

  /** 角色 ID 列表（至少 1 个） */
  @ApiProperty({ type: [String], description: '角色 ID 列表（至少一个）' })
  @IsArray()
  @IsString({ each: true })
  roleIds!: string[];
}

/**
 * 更新用户请求。
 */
export class UpdateUserDto {
  /** 邮箱 */
  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail()
  email?: string;

  /** 手机号 */
  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @IsString()
  phone?: string;

  /** 显示名 */
  @ApiPropertyOptional({ description: '显示名称' })
  @IsOptional()
  @IsString()
  displayName?: string;

  /** 备注 */
  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString()
  remark?: string;
}

/**
 * 用户分页查询。
 */
export class UserPageQueryDto extends PageQueryDto {
  /** 角色 ID 过滤 */
  @ApiPropertyOptional({ description: '角色 ID' })
  @IsOptional()
  @IsString()
  roleId?: string;

  /** 状态过滤 */
  @ApiPropertyOptional({ enum: UserStatus, description: '用户状态' })
  @IsOptional()
  @IsEnum(UserStatus)
  status?: UserStatus;

  /** 指定用户 ID（逗号分隔或数组），用于勾选导出 */
  @ApiPropertyOptional({
    type: [String],
    description: '用户 ID 列表（勾选导出时使用）',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value == null || value === '') return undefined;
    if (Array.isArray(value)) return value as string[];
    return String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  })
  @IsArray()
  @IsString({ each: true })
  ids?: string[];
}

/**
 * 批量删除用户请求。
 */
export class BatchDeleteUsersDto {
  /** 用户 ID 列表 */
  @ApiProperty({ type: [String], description: '用户 ID 列表' })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}
