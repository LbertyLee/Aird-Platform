import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';
import { useSessionStore } from '../stores/session';

const baseURL = import.meta.env.VITE_API_BASE_URL || '/api/v1';

/** 提前多少秒刷新 accessToken */
const REFRESH_SKEW_SEC = 60;

type RetriableConfig = InternalAxiosRequestConfig & {
  _retry?: boolean;
};

/**
 * 管理端 HTTP 客户端，自动附带 Bearer Token，并支持自动刷新。
 */
export const http = axios.create({
  baseURL,
  timeout: 30000,
});

let refreshInFlight: Promise<string | null> | null = null;
let proactiveTimer: number | undefined;

function applyApiErrorMessage(
  error: { message?: string },
  data: { message?: string | string[] } | null | undefined,
) {
  if (!data || data.message === undefined || data.message === null) return;
  if (typeof data.message === 'object') {
    const msg = data.message;
    error.message = Array.isArray(msg) ? msg.join('; ') : String(msg);
  } else if (typeof data.message === 'string') {
    error.message = data.message;
  }
}

function isAuthBootstrapUrl(url?: string) {
  if (!url) return false;
  return /\/admin\/auth\/(login|register|phone-login|phone-register|sms\/send-code|refresh)(?:\?|$)/.test(
    url,
  );
}

function forceLogout() {
  cancelAccessTokenRefresh();
  useSessionStore.getState().clear();
  if (!window.location.pathname.includes('/login')) {
    window.location.href = '/login';
  }
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = useSessionStore.getState().refreshToken;
  if (!refreshToken) return null;

  try {
    const { data } = await axios.post<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>(
      `${baseURL}/admin/auth/refresh`,
      { refreshToken },
      { timeout: 15_000 },
    );

    useSessionStore.getState().rotateTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
    });
    scheduleAccessTokenRefresh();
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
 * 在 accessToken 过期前主动刷新。
 * 持续使用期间可把会话维持到 refreshToken 有效期（默认 7 天）。
 */
export function scheduleAccessTokenRefresh() {
  window.clearTimeout(proactiveTimer);
  proactiveTimer = undefined;

  const { accessToken, refreshToken, expiresIn, issuedAt } =
    useSessionStore.getState();
  if (!accessToken || !refreshToken) return;

  const ttlSec = Number(expiresIn) || 7200;
  const start = issuedAt ?? Date.now();
  const expireAt = start + ttlSec * 1000;
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

/** 应用启动 / 登录成功后安排主动刷新 */
export function bootstrapAccessTokenRefresh() {
  scheduleAccessTokenRefresh();
}

http.interceptors.request.use((config) => {
  const token =
    useSessionStore.getState().accessToken ||
    localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const data = error.response?.data;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      try {
        const parsed = JSON.parse(await data.text()) as {
          message?: string | string[];
        };
        applyApiErrorMessage(error, parsed);
      } catch {
        // 非 JSON 的 blob 错误体保持原 message
      }
    } else {
      applyApiErrorMessage(error, data as { message?: string | string[] });
    }

    const config = error.config as RetriableConfig | undefined;
    const status = error.response?.status;

    if (status !== 401 || !config) {
      return Promise.reject(error);
    }

    if (isAuthBootstrapUrl(config.url)) {
      return Promise.reject(error);
    }

    if (config._retry || !useSessionStore.getState().refreshToken) {
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
