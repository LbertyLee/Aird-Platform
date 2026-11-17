import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { bootstrapAccessTokenRefresh } from './api/http';
import { AdminLayout } from './layouts/AdminLayout';
import { LoginPage } from './pages/LoginPage';
import { useSessionStore } from './stores/session';
import { adminTheme } from './theme';

const queryClient = new QueryClient();

/**
 * 需登录路由守卫。
 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useSessionStore((s) => s.accessToken);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/**
 * 管理端路由根组件。
 * 业务页由 AdminLayout 内 KeepAlive + 页签渲染，此处仅挂布局。
 */
export default function App() {
  useEffect(() => {
    const start = () => bootstrapAccessTokenRefresh();
    const unsub = useSessionStore.persist.onFinishHydration(start);
    if (useSessionStore.persist.hasHydrated()) start();
    return unsub;
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider locale={zhCN} theme={adminTheme}>
        <AntApp>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AdminLayout />
                </RequireAuth>
              }
            />
          </Routes>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}
