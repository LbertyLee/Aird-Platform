/**
 * 当前登录用户上下文（由 JWT 策略填充）。
 */
export class AuthUserContext {
  /** 当前用户 ID */
  userId!: string;
  /** 登录名 */
  username!: string;
  /** 已解析权限码集合 */
  permissionCodes!: string[];
  /** 角色 ID 列表 */
  roleIds!: string[];
}
