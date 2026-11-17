import type { LoginRequest, LoginResponse } from '@agent/contracts';
import { http, scheduleAccessTokenRefresh, cancelAccessTokenRefresh } from './http';

export type AuthMeProfile = {
  id: string;
  username: string;
  email?: string | null;
  phone?: string | null;
  displayName?: string | null;
};

export async function login(data: LoginRequest): Promise<LoginResponse> {
  return (await http.post<LoginResponse>('/admin/auth/login', data)).data;
}

export async function register(
  data: LoginRequest & {
    displayName?: string;
    email?: string;
    phone?: string;
    code?: string;
  },
): Promise<LoginResponse> {
  return (await http.post<LoginResponse>('/admin/auth/register', data)).data;
}

export async function sendSmsCode(
  phone: string,
  scene: 'login' | 'register',
): Promise<void> {
  await http.post('/admin/auth/sms/send-code', { phone, scene });
}

export async function phoneLogin(
  phone: string,
  code: string,
): Promise<LoginResponse> {
  return (
    await http.post<LoginResponse>('/admin/auth/phone-login', { phone, code })
  ).data;
}

export async function phoneRegister(
  phone: string,
  code: string,
  displayName?: string,
): Promise<LoginResponse> {
  return (
    await http.post<LoginResponse>('/admin/auth/phone-register', {
      phone,
      code,
      displayName,
    })
  ).data;
}

export async function fetchMyProfile(): Promise<AuthMeProfile> {
  return (await http.get<AuthMeProfile>('/admin/auth/me')).data;
}

export async function updateMyProfile(input: {
  displayName?: string;
  email?: string;
  phone?: string;
}): Promise<AuthMeProfile> {
  return (await http.put<AuthMeProfile>('/admin/auth/me', input)).data;
}

export function saveUserSession(session: LoginResponse) {
  const stored = {
    ...session,
    issuedAt: Date.now(),
  };
  localStorage.setItem('aird-user-session', JSON.stringify(stored));
  scheduleAccessTokenRefresh(stored);
}

export function readUserSession(): LoginResponse | null {
  try {
    const value = localStorage.getItem('aird-user-session');
    return value ? (JSON.parse(value) as LoginResponse) : null;
  } catch {
    return null;
  }
}

export function clearUserSession() {
  cancelAccessTokenRefresh();
  localStorage.removeItem('aird-user-session');
}

/** 应用启动时：若已有会话则安排主动刷新 */
export function bootstrapUserSessionRefresh() {
  scheduleAccessTokenRefresh(readUserSession());
}
