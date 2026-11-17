import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * 会话状态：令牌、权限码、当前用户。
 */
interface SessionState {
  /** 访问令牌 */
  accessToken: string | null;
  /** 刷新令牌 */
  refreshToken: string | null;
  /** 访问令牌有效秒数 */
  expiresIn: number | null;
  /** 签发/刷新时间戳 */
  issuedAt: number | null;
  /** 权限码 */
  permissionCodes: string[];
  /** 用户资料 */
  profile: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
  /**
   * 写入登录结果
   */
  setSession: (payload: {
    accessToken: string;
    refreshToken: string;
    expiresIn?: number;
    permissionCodes: string[];
    profile: SessionState['profile'];
  }) => void;
  /** 仅轮换令牌（自动刷新时） */
  rotateTokens: (payload: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }) => void;
  /** 刷新权限与资料（不换令牌） */
  patchProfile: (payload: {
    permissionCodes?: string[];
    profile?: SessionState['profile'];
  }) => void;
  /** 清空会话 */
  clear: () => void;
  /** 是否拥有权限 */
  hasPermission: (code: string) => boolean;
}

/**
 * 管理端会话 Store。
 */
export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      expiresIn: null,
      issuedAt: null,
      permissionCodes: [],
      profile: null,
      setSession: (payload) => {
        const issuedAt = Date.now();
        const expiresIn = payload.expiresIn ?? 7200;
        localStorage.setItem('accessToken', payload.accessToken);
        localStorage.setItem('refreshToken', payload.refreshToken);
        set({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          expiresIn,
          issuedAt,
          permissionCodes: payload.permissionCodes,
          profile: payload.profile,
        });
      },
      rotateTokens: (payload) => {
        const issuedAt = Date.now();
        localStorage.setItem('accessToken', payload.accessToken);
        localStorage.setItem('refreshToken', payload.refreshToken);
        set({
          accessToken: payload.accessToken,
          refreshToken: payload.refreshToken,
          expiresIn: payload.expiresIn,
          issuedAt,
        });
      },
      patchProfile: (payload) => {
        set((state) => ({
          permissionCodes: payload.permissionCodes ?? state.permissionCodes,
          profile: payload.profile ?? state.profile,
        }));
      },
      clear: () => {
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        set({
          accessToken: null,
          refreshToken: null,
          expiresIn: null,
          issuedAt: null,
          permissionCodes: [],
          profile: null,
        });
      },
      hasPermission: (code) => get().permissionCodes.includes(code),
    }),
    {
      name: 'aird-admin-session',
      onRehydrateStorage: () => (state) => {
        if (state?.accessToken) {
          localStorage.setItem('accessToken', state.accessToken);
        }
        if (state?.refreshToken) {
          localStorage.setItem('refreshToken', state.refreshToken);
        }
      },
    },
  ),
);
