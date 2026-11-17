import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CommonStatus, DataScopeType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../../common/dto/page.dto';

/**
 * 创建角色请求。
 */
export class CreateRoleDto {
  /** 角色编码 */
  @ApiProperty({ description: '角色编码' })
  @IsString()
  code!: string;

  /** 角色名称 */
  @ApiProperty({ description: '角色名称' })
  @IsString()
  name!: string;

  /** 描述 */
  @ApiPropertyOptional({ description: '角色描述' })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * 更新角色请求。
 */
export class UpdateRoleDto {
  /** 角色名称 */
  @ApiPropertyOptional({ description: '角色名称' })
  @IsOptional()
  @IsString()
  name?: string;

  /** 描述 */
  @ApiPropertyOptional({ description: '角色描述' })
  @IsOptional()
  @IsString()
  description?: string;
}

/**
 * 覆盖权限请求。
 */
export class ReplacePermissionsDto {
  /** 权限 ID 列表 */
  @ApiProperty({ type: [String], description: '权限 ID 列表' })
  @IsArray()
  @IsString({ each: true })
  permissionIds!: string[];
}

/**
 * 数据范围配置请求。
 */
export class SetDataScopeDto {
  /** 范围类型 */
  @ApiProperty({ enum: DataScopeType, description: '数据范围类型' })
  @IsEnum(DataScopeType)
  scopeType!: DataScopeType;
}

/**
 * 用户角色绑定项。
 */
export class UserRoleBindingDto {
  /** 角色 ID */
  @ApiProperty({ description: '角色 ID' })
  @IsString()
  roleId!: string;
}

/**
 * 分配用户角色请求。
 */
export class AssignUserRolesDto {
  /** 绑定列表 */
  @ApiProperty({ type: [UserRoleBindingDto], description: '用户角色绑定列表' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UserRoleBindingDto)
  bindings!: UserRoleBindingDto[];
}

/**
 * 批量删除角色请求。
 */
export class BatchDeleteRolesDto {
  /** 角色 ID 列表 */
  @ApiProperty({ type: [String], description: '角色 ID 列表' })
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

/**
 * 角色分页查询。
 */
export class RolePageQueryDto extends PageQueryDto {}

/**
 * 权限矩阵行。
 */
export class PermissionMatrixRowDto {
  @ApiProperty({ description: '模块 key' })
  @IsString()
  key!: string;

  @ApiProperty({ description: '平台管理员是否拥有' })
  @IsBoolean()
  platform_admin!: boolean;

  @ApiProperty({ description: '普通用户是否拥有' })
  @IsBoolean()
  regular_user!: boolean;
}

/**
 * 保存权限矩阵。
 */
export class SavePermissionMatrixDto {
  @ApiProperty({ type: [PermissionMatrixRowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionMatrixRowDto)
  rows!: PermissionMatrixRowDto[];
}

/**
 * 更新角色状态。
 */
export class UpdateRoleStatusDto {
  @ApiProperty({ enum: CommonStatus, description: '角色状态' })
  @IsEnum(CommonStatus)
  status!: CommonStatus;
}
