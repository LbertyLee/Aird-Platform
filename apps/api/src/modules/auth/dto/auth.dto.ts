import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

/**
 * 登录请求 DTO。
 */
export class LoginRequestDto {
  /** 登录名 */
  @ApiProperty({ example: 'netsoil', description: '登录用户名' })
  @IsString()
  username!: string;

  /** 密码 */
  @ApiProperty({ example: '123456', description: '登录密码' })
  @IsString()
  @MinLength(6)
  password!: string;
}

export class RegisterRequestDto extends LoginRequestDto {
  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone?: string;

  @ApiPropertyOptional({ description: '短信验证码（填写手机号时必填）' })
  @ValidateIf((dto: RegisterRequestDto) => Boolean(dto.phone?.trim()))
  @IsString()
  @MinLength(4)
  code?: string;
  @ApiPropertyOptional({ description: '显示名称' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @IsEmail()
  email?: string;
}

export class PhoneAuthRequestDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  phone!: string;

  @ApiProperty({ example: '1234', description: '短信验证码（4 位）' })
  @IsString()
  @MinLength(4)
  code!: string;

  @ApiPropertyOptional({ description: '注册时的显示名称' })
  @IsOptional()
  @IsString()
  displayName?: string;
}

/**
 * 刷新令牌请求 DTO。
 */
export class SendSmsCodeDto {
  @ApiProperty({ example: '13800138000' })
  @IsString()
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone!: string;

  @ApiProperty({ enum: ['login', 'register'], example: 'login' })
  @IsIn(['login', 'register'])
  scene!: 'login' | 'register';
}

export class RefreshRequestDto {
  /** 刷新令牌 */
  @ApiProperty({ description: '刷新令牌' })
  @IsString()
  refreshToken!: string;
}

/**
 * 更新当前用户资料。
 */
export class UpdateMyProfileDto {
  /** 显示名 */
  @ApiPropertyOptional({ description: '显示名称' })
  @IsOptional()
  @IsString()
  displayName?: string;

  /** 邮箱 */
  @ApiPropertyOptional({ description: '邮箱' })
  @IsOptional()
  @ValidateIf((_, value) => value !== '' && value != null)
  @IsEmail()
  email?: string;

  /** 手机号 */
  @ApiPropertyOptional({ description: '手机号' })
  @IsOptional()
  @IsString()
  phone?: string;
}

/**
 * 修改当前用户密码。
 */
export class ChangeMyPasswordDto {
  /** 当前密码 */
  @ApiProperty({ description: '当前密码' })
  @IsString()
  @MinLength(6)
  oldPassword!: string;

  /** 新密码 */
  @ApiProperty({ description: '新密码' })
  @IsString()
  @MinLength(6)
  newPassword!: string;
}

/**
 * 登录用户资料。
 */
export class LoginProfileDto {
  @ApiProperty({ description: '用户 ID' })
  id!: string;

  @ApiProperty({ description: '登录名' })
  username!: string;

  @ApiPropertyOptional({ description: '显示名', nullable: true })
  displayName!: string | null;
}

/**
 * 令牌对响应。
 */
export class TokenPairDto {
  @ApiProperty({ description: '访问令牌（Bearer JWT）' })
  accessToken!: string;

  @ApiProperty({ description: '刷新令牌' })
  refreshToken!: string;

  @ApiProperty({ description: '访问令牌过期秒数', example: 7200 })
  expiresIn!: number;
}

/**
 * 登录响应。
 */
export class LoginResponseDto extends TokenPairDto {
  @ApiProperty({ type: [String], description: '权限码列表' })
  permissionCodes!: string[];

  @ApiProperty({ type: LoginProfileDto, description: '用户资料' })
  profile!: LoginProfileDto;
}

/** 当前用户角色项 */
export class AuthMeRoleDto {
  @ApiProperty({ description: '角色 ID' })
  id!: string;

  @ApiProperty({ description: '角色编码' })
  code!: string;

  @ApiProperty({ description: '角色名称' })
  name!: string;
}

/**
 * 当前用户信息响应。
 */
export class AuthMeResponseDto {
  @ApiProperty({ description: '用户 ID' })
  id!: string;

  @ApiProperty({ description: '登录名' })
  username!: string;

  @ApiPropertyOptional({ description: '邮箱', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ description: '手机号', nullable: true })
  phone?: string | null;

  @ApiProperty({ description: '用户状态' })
  status!: string;

  @ApiPropertyOptional({ description: '最近登录时间', nullable: true })
  lastLoginAt?: Date | null;

  @ApiPropertyOptional({ description: '显示名', nullable: true })
  displayName?: string | null;

  @ApiProperty({ type: [AuthMeRoleDto], description: '角色列表' })
  roles!: AuthMeRoleDto[];

  @ApiProperty({ type: [String], description: '权限码列表' })
  permissionCodes!: string[];
}
