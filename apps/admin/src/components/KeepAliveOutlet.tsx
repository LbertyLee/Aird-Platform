import { Navigate, useLocation } from 'react-router-dom';
import { Button, Result } from 'antd';
import {
  canAccessAdminPage,
  firstAccessibleAdminPage,
} from '../routes/admin-permissions';
import { useSessionStore } from '../stores/session';
import {
  ADMIN_PAGES,
  isAdminPage,
  normalizeAdminPath,
} from '../routes/admin-pages';
import { useTabsStore } from '../stores/tabs';
import './PageTabs.css';

function stripTrailingSlash(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname.replace(/\/+$/, '') || '/';
}

/**
 * 多页签 KeepAlive：已打开页保持挂载，仅切换显示，从而保留筛选/表单状态。
 */
export function KeepAliveOutlet() {
  const location = useLocation();
  const activePath = normalizeAdminPath(location.pathname);
  const tabs = useTabsStore((s) => s.tabs);
  const permissionCodes = useSessionStore((s) => s.permissionCodes);
  const stripped = stripTrailingSlash(location.pathname);

  if (!isAdminPage(activePath)) {
    return <Navigate to="/" replace />;
  }

  if (stripped !== activePath) {
    return <Navigate to={activePath} replace />;
  }

  const activeDef = ADMIN_PAGES[activePath];
  if (!canAccessAdminPage(activePath, permissionCodes)) {
    return (
      <Result
        status="403"
        title="403"
        subTitle="您没有访问此页面的权限"
        extra={
          <Button
            type="primary"
            href={firstAccessibleAdminPage(permissionCodes)}
          >
            前往可访问页面
          </Button>
        }
      />
    );
  }

  return (
    <div
      className={`admin-keepalive-root${
        activeDef.flush ? ' admin-keepalive-root--flush' : ''
      }`}
    >
      {tabs.map((path) => {
        const page = ADMIN_PAGES[path];
        if (!page || !canAccessAdminPage(path, permissionCodes)) return null;
        const Comp = page.component;
        const active = path === activePath;
        return (
          <div
            key={path}
            className="admin-keepalive-pane"
            hidden={!active}
            aria-hidden={!active}
          >
            <Comp />
          </div>
        );
      })}
    </div>
  );
}
