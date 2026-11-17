import { z } from 'zod';

/**
 * 管理端登录请求。
 */
export const loginRequestSchema = z.object({
  /** 登录名 */
  username: z.string().min(1).describe('登录名'),
  /** 密码 */
  password: z.string().min(6).describe('密码'),
});

/**
 * 管理端登录响应。
 */
export const loginResponseSchema = z.object({
  accessToken: z.string().describe('访问令牌'),
  refreshToken: z.string().describe('刷新令牌'),
  expiresIn: z.number().describe('访问令牌过期秒数'),
  permissionCodes: z.array(z.string()).describe('权限码列表'),
  profile: z.object({
    id: z.string().describe('用户 ID'),
    username: z.string().describe('登录名'),
    displayName: z.string().nullable().describe('显示名'),
  }),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
