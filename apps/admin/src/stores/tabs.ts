import { create } from 'zustand';
import { ADMIN_PAGES, normalizeAdminPath } from '../routes/admin-pages';

interface TabsState {
  /** 已打开页签路径（顺序即展示顺序） */
  tabs: string[];
  /** 各页签最近一次 query（如知识库详情的 ?id=），切回时恢复 */
  tabSearch: Record<string, string>;
  /** 打开或激活页签；可附带 search 以便详情页保留 id */
  openTab: (path: string, search?: string) => void;
  /** 读取页签应跳转的完整路径（含 query） */
  hrefFor: (path: string) => string;
  /** 关闭页签；返回关闭后应跳转的路径（若关的是当前页） */
  closeTab: (path: string, activePath: string) => string | null;
  /** 关闭其他页签 */
  closeOthers: (path: string) => void;
  /** 清空（退出登录） */
  clearTabs: () => void;
}

const HOME = '/';

function pruneTabs(tabs: string[]): string[] {
  const next = tabs.filter((t) => t in ADMIN_PAGES);
  return next.length > 0 ? next : [HOME];
}

function normalizeSearch(search?: string): string {
  if (!search) return '';
  return search.startsWith('?') ? search : `?${search}`;
}

/**
 * 管理端多页签状态（会话内 KeepAlive，刷新后仅保留路径需重新挂载）。
 */
export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [HOME],
  tabSearch: {},

  openTab: (rawPath, search) => {
    const path = normalizeAdminPath(rawPath);
    if (!(path in ADMIN_PAGES)) return;
    const nextSearch = normalizeSearch(search);
    set((state) => {
      const tabs = pruneTabs(state.tabs);
      const tabSearch = { ...state.tabSearch };
      if (nextSearch) {
        tabSearch[path] = nextSearch;
      }
      if (tabs.includes(path)) {
        return { tabs, tabSearch };
      }
      return { tabs: [...tabs, path], tabSearch };
    });
  },

  hrefFor: (rawPath) => {
    const path = normalizeAdminPath(rawPath);
    const search = get().tabSearch[path] || '';
    return `${path}${search}`;
  },

  closeTab: (rawPath, rawActive) => {
    const path = normalizeAdminPath(rawPath);
    const activePath = normalizeAdminPath(rawActive);
    const state = get();
    const tabs = pruneTabs(state.tabs);
    if (path === HOME) return null;
    if (!tabs.includes(path)) {
      set({ tabs });
      return null;
    }

    const next = tabs.filter((t) => t !== path);
    const tabSearch = { ...state.tabSearch };
    delete tabSearch[path];
    set({ tabs: next.length > 0 ? next : [HOME], tabSearch });

    if (path !== activePath) return null;
    const idx = tabs.indexOf(path);
    const fallback = next[Math.max(0, idx - 1)] ?? HOME;
    return get().hrefFor(fallback);
  },

  closeOthers: (rawPath) => {
    const path = normalizeAdminPath(rawPath);
    if (!(path in ADMIN_PAGES)) {
      set({ tabs: [HOME], tabSearch: {} });
      return;
    }
    set((state) => {
      const keep =
        path === HOME
          ? [HOME]
          : [HOME, path].filter((v, i, arr) => arr.indexOf(v) === i);
      const tabSearch: Record<string, string> = {};
      keep.forEach((p) => {
        if (state.tabSearch[p]) tabSearch[p] = state.tabSearch[p];
      });
      return { tabs: keep, tabSearch };
    });
  },

  clearTabs: () => set({ tabs: [HOME], tabSearch: {} }),
}));
