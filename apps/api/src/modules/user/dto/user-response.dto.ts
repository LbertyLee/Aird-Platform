import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';

/** 用户角色简要 */
export class UserRoleBriefDto {
  @ApiProperty({ description: '角色 ID' })
  id!: string;

  @ApiProperty({ description: '角色编码' })
  code!: string;

  @ApiProperty({ description: '角色名称' })
  name!: string;
}

/** 个人会员摘要 */
export class UserMembershipBriefDto {
  @ApiProperty({ description: '订阅 ID' })
  subscriptionId!: string;

  @ApiProperty({ description: '等级 ID' })
  levelId!: string;

  @ApiProperty({ description: '等级编码' })
  levelCode!: string;

  @ApiProperty({ description: '等级名称' })
  levelName!: string;

  @ApiProperty({ description: '到期时间' })
  endAt!: Date;
}

/** 用户视图 */
export class UserViewDto {
  @ApiProperty({ description: '用户 ID' })
  id!: string;

  @ApiProperty({ description: '登录名' })
  username!: string;

  @ApiPropertyOptional({ description: '邮箱', nullable: true })
  email?: string | null;

  @ApiPropertyOptional({ description: '手机号', nullable: true })
  phone?: string | null;

  @ApiProperty({ enum: UserStatus, description: '用户状态' })
  status!: UserStatus;

  @ApiPropertyOptional({ description: '显示名', nullable: true })
  displayName?: string | null;

  @ApiPropertyOptional({ description: '最近登录时间', nullable: true })
  lastLoginAt?: Date | null;

  @ApiProperty({ description: '创建时间' })
  createdAt!: Date;

  @ApiProperty({ type: [UserRoleBriefDto], description: '角色列表' })
  roles!: UserRoleBriefDto[];

  @ApiPropertyOptional({
    type: UserMembershipBriefDto,
    description: '个人会员',
    nullable: true,
  })
  membership?: UserMembershipBriefDto | null;
}

/** 创建用户响应（可能含临时密码） */
export class CreateUserResponseDto extends UserViewDto {
  @ApiPropertyOptional({
    description: '系统生成的临时密码（仅创建时且未传 password 时返回）',
  })
  tempPassword?: string;
}

/** 用户分页响应 */
export class UserPageResultDto {
  @ApiProperty({ type: [UserViewDto], description: '当前页数据' })
  items!: UserViewDto[];

  @ApiProperty({ description: '总条数' })
  total!: number;

  @ApiProperty({ description: '当前页码' })
  page!: number;

  @ApiProperty({ description: '每页条数' })
  pageSize!: number;
}

/** 重置密码响应 */
export class ResetPasswordResponseDto {
  @ApiProperty({ description: '新的临时密码' })
  tempPassword!: string;
}
