import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { LoginResponse } from '@agent/contracts';

const baseURL =
  import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api/v1';

const SESSION_KEY = 'aird-user-session';
export const SESSION_UPDATED_EVENT = 'aird:session-updated';

/** 提前多少秒刷新 accessToken（避免业务请求撞上过期） */
const REFRESH_SKEW_SEC = 60;

type StoredSession = LoginResponse & {
  /** 签发/刷新时间戳，用于主动续期 */
  issuedAt?: number;
};

type RetriableConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

/** 用户端 HTTP 客户端，默认请求本地 API 服务。 */
export const http = axios.create({
  baseURL,
  timeout: 120_000,
});

let refreshInFlight: Promise<string | null> | null = null;
let proactiveTimer: number | undefined;

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeStoredSession(session: StoredSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.dispatchEvent(
    new CustomEvent(SESSION_UPDATED_EVENT, { detail: session }),
  );
}

function clearStoredSession() {
  localStorage.removeItem(SESSION_KEY);
  window.clearTimeout(proactiveTimer);
  proactiveTimer = undefined;
}

function forceLogout() {
  clearStoredSession();
  const path = window.location.pathname;
  if (!path.includes('/login') && !path.includes('/register')) {
    window.location.href = '/login';
  }
}

function isAuthBootstrapUrl(url?: string) {
  if (!url) return false;
  return /\/admin\/auth\/(login|register|phone-login|phone-register|sms\/send-code|refresh)(?:\?|$)/.test(
    url,
  );
}

/**
 * 用 refreshToken 换取新的 access/refresh；并发请求共享同一次刷新。
 */
async function refreshAccessToken(): Promise<string | null> {
  const session = readStoredSession();
  if (!session?.refreshToken) return null;

  try {
    const { data } = await axios.post<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>(
      `${baseURL}/admin/auth/refresh`,
      { refreshToken: session.refreshToken },
      { timeout: 15_000 },
    );

    const next: StoredSession = {
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      issuedAt: Date.now(),
    };
    writeStoredSession(next);
    scheduleAccessTokenRefresh(next);
    return data.accessToken;
  } catch {
    return null;
  }
}

function sharedRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = refreshAccessToken().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/**
 * 在 accessToken 过期前主动刷新；登录/刷新成功后调用。
 * 持续使用期间可把会话维持到 refreshToken 有效期（默认 7 天）。
 */
export function scheduleAccessTokenRefresh(session?: StoredSession | null) {
  window.clearTimeout(proactiveTimer);
  proactiveTimer = undefined;

  const current = session ?? readStoredSession();
  if (!current?.refreshToken || !current.accessToken) return;

  const ttlSec = Number(current.expiresIn) || 7200;
  const issuedAt = current.issuedAt ?? Date.now();
  const expireAt = issuedAt + ttlSec * 1000;
  const refreshAt = expireAt - REFRESH_SKEW_SEC * 1000;
  const delay = Math.max(refreshAt - Date.now(), 5_000);

  proactiveTimer = window.setTimeout(() => {
    void sharedRefresh().then((token) => {
      if (!token) forceLogout();
    });
  }, delay);
}

/** 取消主动刷新计时（退出登录时调用） */
export function cancelAccessTokenRefresh() {
  window.clearTimeout(proactiveTimer);
  proactiveTimer = undefined;
}

http.interceptors.request.use((config) => {
  const session = readStoredSession();
  if (session?.accessToken) {
    config.headers.Authorization = `Bearer ${session.accessToken}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status !== 401 || !config) {
      return Promise.reject(error);
    }

    // 登录/注册等本身失败，不走刷新与强制登出
    if (isAuthBootstrapUrl(config.url)) {
      return Promise.reject(error);
    }

    // 已重试过仍 401，或没有 refreshToken
    if (config._retry || !readStoredSession()?.refreshToken) {
      forceLogout();
      return Promise.reject(error);
    }

    config._retry = true;
    const token = await sharedRefresh();
    if (!token) {
      forceLogout();
      return Promise.reject(error);
    }

    config.headers.Authorization = `Bearer ${token}`;
    return http(config);
  },
);
