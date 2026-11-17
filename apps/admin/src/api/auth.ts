import type { LoginRequest, LoginResponse } from '@agent/contracts';
import { http } from './http';

/**
 * 管理端登录。
 */
export async function loginApi(data: LoginRequest): Promise<LoginResponse> {
  const { data: result } = await http.post<LoginResponse>(
    '/admin/auth/login',
    data,
  );
  return result;
}

export async function sendSmsCodeApi(
  phone: string,
  scene: 'login' | 'register',
): Promise<void> {
  await http.post('/admin/auth/sms/send-code', { phone, scene });
}

export async function phoneLoginApi(
  phone: string,
  code: string,
): Promise<LoginResponse> {
  const { data: result } = await http.post<LoginResponse>(
    '/admin/auth/phone-login',
    { phone, code },
  );
  return result;
}

export type MyProfile = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  status: string;
  lastLoginAt: string | null;
  displayName: string | null;
  permissionCodes: string[];
  roles: Array<{ id: string; code: string; name: string }>;
};

/**
 * 当前用户资料。
 */
export async function meApi() {
  const { data } = await http.get('/admin/auth/me');
  return data as MyProfile;
}

/**
 * 更新当前用户资料。
 */
export async function updateMyProfileApi(payload: {
  displayName?: string;
  email?: string;
  phone?: string;
}) {
  const { data } = await http.put('/admin/auth/me', payload);
  return data as MyProfile;
}

/**
 * 修改当前用户密码。
 */
export async function changeMyPasswordApi(payload: {
  oldPassword: string;
  newPassword: string;
}) {
  const { data } = await http.post('/admin/auth/me/password', payload);
  return data as { ok: boolean };
}

/**
 * 退出登录。
 */
export async function logoutApi(refreshToken: string) {
  await http.post('/admin/auth/logout', { refreshToken });
}
