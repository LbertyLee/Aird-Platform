import { CloseOutlined } from '@ant-design/icons';
import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ADMIN_PAGES,
  isAdminPage,
  normalizeAdminPath,
} from '../routes/admin-pages';
import { useTabsStore } from '../stores/tabs';
import { canAccessAdminPage } from '../routes/admin-permissions';
import { useSessionStore } from '../stores/session';
import './PageTabs.css';

/**
 * 顶部多页签：点击切换路由；关闭时卸载对应 KeepAlive 页。
 */
export function PageTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const activePath = normalizeAdminPath(location.pathname);
  const tabs = useTabsStore((s) => s.tabs);
  const permissionCodes = useSessionStore((s) => s.permissionCodes);
  const openTab = useTabsStore((s) => s.openTab);
  const closeTab = useTabsStore((s) => s.closeTab);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const hrefFor = useTabsStore((s) => s.hrefFor);

  useEffect(() => {
    if (!isAdminPage(activePath)) return;
    openTab(activePath, location.search);
  }, [activePath, location.search, openTab]);

  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-tab-path="${CSS.escape(activePath)}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }, [activePath, tabs]);

  const onClose = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = closeTab(path, activePath);
    if (next) navigate(next);
  };

  return (
    <div className="admin-page-tabs">
      <div className="admin-page-tabs-scroll" ref={scrollerRef}>
        {tabs.map((path) => {
          const page = ADMIN_PAGES[path];
          if (!page || !canAccessAdminPage(path, permissionCodes)) return null;
          const active = path === activePath;
          const closable = page.closable !== false;
          return (
            <button
              key={path}
              type="button"
              data-tab-path={path}
              className={`admin-page-tab${active ? ' admin-page-tab--active' : ''}`}
              onClick={() => {
                if (!active) navigate(hrefFor(path));
              }}
            >
              <span className="admin-page-tab-icon">{page.icon}</span>
              <span className="admin-page-tab-label">{page.title}</span>
              {closable ? (
                <span
                  className="admin-page-tab-close"
                  role="button"
                  tabIndex={0}
                  aria-label={`关闭 ${page.title}`}
                  onClick={(e) => onClose(path, e)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onClose(path, e as unknown as React.MouseEvent);
                    }
                  }}
                >
                  <CloseOutlined />
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
