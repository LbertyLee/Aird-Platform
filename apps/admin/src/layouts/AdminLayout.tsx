import {
  AuditOutlined,
  BookOutlined,
  CloudUploadOutlined,
  ClusterOutlined,
  CrownOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  NotificationOutlined,
  PayCircleOutlined,
  ReadOutlined,
  SafetyOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Grid, Layout, Menu, Typography, Button, theme } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { logoutApi, meApi } from '../api/auth';
import { cancelAccessTokenRefresh } from '../api/http';
import { KeepAliveOutlet } from '../components/KeepAliveOutlet';
import { PageTabs } from '../components/PageTabs';
import {
  ADMIN_PAGES,
  normalizeAdminPath,
} from '../routes/admin-pages';
import { canAccessAdminPage } from '../routes/admin-permissions';
import { useSessionStore } from '../stores/session';
import { useTabsStore } from '../stores/tabs';
import logoAi from '../assets/imgs/logo-ai.svg';
import { brandNameShort } from '../theme';
import './AdminLayout.css';

const APP_TITLE = 'AI数智研究平台管理端';

const { Header, Sider, Content } = Layout;

/** 侧栏子菜单项 */
type SubMenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  code: string;
};

/**
 * 管理端主布局：侧栏 + 多页签 + KeepAlive 内容区。
 */
export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const activePath = normalizeAdminPath(location.pathname);
  const { profile, permissionCodes, refreshToken, clear, patchProfile } =
    useSessionStore();
  const clearTabs = useTabsStore((s) => s.clearTabs);
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  useEffect(() => {
    let cancelled = false;
    void meApi()
      .then((me) => {
        if (cancelled) return;
        patchProfile({
          permissionCodes: me.permissionCodes ?? [],
          profile: {
            id: me.id,
            username: me.username,
            displayName: me.displayName,
          },
        });
      })
      .catch(() => {
        // 令牌失效时由 http 拦截器处理跳转
      });
    return () => {
      cancelled = true;
    };
  }, [patchProfile]);

  const userChildren: SubMenuItem[] = useMemo(
    () =>
      [
        {
          key: '/users',
          icon: <TeamOutlined />,
          label: '用户账号',
          code: 'menu:user',
        },
        {
          key: '/membership',
          icon: <CrownOutlined />,
          label: '会员管理',
          code: 'menu:membership:level',
        },
        {
          key: '/rbac/roles',
          icon: <SafetyOutlined />,
          label: '角色权限',
          code: 'menu:rbac:role',
        },
      ].filter((m) => canAccessAdminPage(m.key, permissionCodes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionCodes],
  );

  const dataResourceChildren: SubMenuItem[] = useMemo(
    () =>
      [
        {
          key: '/data/indicators',
          icon: <ReadOutlined />,
          label: '指标管理',
          code: 'menu:data:indicator',
        },
        {
          key: '/data/dictionaries',
          icon: <BookOutlined />,
          label: '字典管理',
          code: 'menu:data:dict',
        },
        {
          key: '/data/datasets',
          icon: <DatabaseOutlined />,
          label: '来源管理',
          code: 'menu:data:dataset',
        },
      ].filter((m) => canAccessAdminPage(m.key, permissionCodes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionCodes],
  );

  const knowledgeChildren: SubMenuItem[] = useMemo(
    () =>
      [
        {
          key: '/knowledge/library',
          icon: <BookOutlined />,
          label: '知识库管理',
          code: 'menu:knowledge:library',
        },
        {
          key: '/knowledge/user',
          icon: <UserOutlined />,
          label: '用户知识库管理',
          code: 'menu:knowledge:user',
        },
        {
          key: '/knowledge/public-review',
          icon: <AuditOutlined />,
          label: '公开数据审核',
          code: 'menu:knowledge:public-review',
        },
        {
          key: '/knowledge/indexes',
          icon: <ClusterOutlined />,
          label: '知识索引',
          code: 'menu:knowledge:index',
        },
      ].filter((m) => canAccessAdminPage(m.key, permissionCodes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionCodes],
  );

  const operationChildren: SubMenuItem[] = useMemo(
    () =>
      [
        {
          key: '/operation/announcements',
          icon: <NotificationOutlined />,
          label: '消息公告',
          code: 'menu:operation:announcement',
        },
      ].filter((m) => canAccessAdminPage(m.key, permissionCodes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionCodes],
  );

  const systemChildren: SubMenuItem[] = useMemo(
    () =>
      [
        {
          key: '/oper-logs',
          icon: <FileSearchOutlined />,
          label: '操作日志',
          code: 'menu:oper:log',
        },
        {
          key: '/system/backups',
          icon: <CloudUploadOutlined />,
          label: '数据备份',
          code: 'menu:system:backup',
        },
        {
          key: '/system/search-models',
          icon: <RobotOutlined />,
          label: '搜索模型',
          code: 'menu:system:search-model',
        },
      ].filter((m) => canAccessAdminPage(m.key, permissionCodes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionCodes],
  );

  const paymentChildren: SubMenuItem[] = useMemo(
    () =>
      [
        {
          key: '/payment/config',
          icon: <PayCircleOutlined />,
          label: '订单与支付配置',
          code: 'menu:payment:config',
        },
      ].filter((m) => canAccessAdminPage(m.key, permissionCodes)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [permissionCodes],
  );

  const showDashboard = canAccessAdminPage('/', permissionCodes);
  const showUserGroup = userChildren.length > 0;
  const agentMenu = { key: '/agents', icon: <RobotOutlined />, label: '智能体管理', code: 'menu:agent' };
  const showAgent = canAccessAdminPage(agentMenu.key, permissionCodes);
  const showDataResource = dataResourceChildren.length > 0;
  const showKnowledge = knowledgeChildren.length > 0;
  const showOperation = operationChildren.length > 0;
  const showSystem = systemChildren.length > 0;
  const showPayment = paymentChildren.length > 0;

  const menuItems: MenuProps['items'] = useMemo(() => {
    const items: MenuProps['items'] = [];
    if (showDashboard) {
      items.push({
        key: '/',
        icon: <DashboardOutlined />,
        label: '平台总览',
      });
    }
    if (showUserGroup) {
      items.push({
        key: 'user-group',
        icon: <ClusterOutlined />,
        label: '账号管理',
        children: userChildren.map((m) => ({
          key: m.key,
          icon: m.icon,
          label: m.label,
        })),
      });
    }
    if (showAgent) {
      items.push({
        key: agentMenu.key,
        icon: agentMenu.icon,
        label: agentMenu.label,
      });
    }
    if (showDataResource) {
      items.push({
        key: 'data-resource',
        icon: <DatabaseOutlined />,
        label: '数据资源',
        children: dataResourceChildren.map((m) => ({
          key: m.key,
          icon: m.icon,
          label: m.label,
        })),
      });
    }
    if (showOperation) {
      items.push({
        key: 'operation',
        icon: <NotificationOutlined />,
        label: '运营管理',
        children: operationChildren.map((m) => ({
          key: m.key,
          icon: m.icon,
          label: m.label,
        })),
      });
    }
    if (showKnowledge) {
      items.push({
        key: 'knowledge',
        icon: <BookOutlined />,
        label: '知识库管理',
        children: knowledgeChildren.map((m) => ({
          key: m.key,
          icon: m.icon,
          label: m.label,
        })),
      });
    }
    if (showPayment) {
      items.push({
        key: 'payment',
        icon: <PayCircleOutlined />,
        label: '支付中心',
        children: paymentChildren.map((m) => ({
          key: m.key,
          icon: m.icon,
          label: m.label,
        })),
      });
    }
    if (showSystem) {
      items.push({
        key: 'system',
        icon: <SettingOutlined />,
        label: '系统管理',
        children: systemChildren.map((m) => ({
          key: m.key,
          icon: m.icon,
          label: m.label,
        })),
      });
    }
    return items;
  }, [
    showDashboard,
    showUserGroup,
    showAgent,
    showDataResource,
    showOperation,
    showKnowledge,
    showPayment,
    showSystem,
    userChildren,
    dataResourceChildren,
    operationChildren,
    knowledgeChildren,
    paymentChildren,
    systemChildren,
  ]);

  const underUserGroup = [
    '/users',
    '/membership',
    '/rbac/roles',
  ].includes(activePath);

  const underDataResource = [
    '/data/indicators',
    '/data/dictionaries',
    '/data/datasets',
    '/data/field-mappings',
    '/data/ingestion-jobs',
    '/data/search-test',
  ].includes(activePath);

  const underKnowledge = activePath.startsWith('/knowledge/');
  const underOperation = activePath.startsWith('/operation/');
  const underPayment = activePath.startsWith('/payment/');
  const underSystem =
    activePath.startsWith('/system/') || activePath === '/oper-logs';

  const screens = Grid.useBreakpoint();
  const isNarrow = screens.lg === false;
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < 992,
  );

  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const keys: string[] = [];
    if (underUserGroup || showUserGroup) keys.push('user-group');
    if (underDataResource || showDataResource) keys.push('data-resource');
    if (underOperation || showOperation) keys.push('operation');
    if (underKnowledge || showKnowledge) keys.push('knowledge');
    if (underPayment || showPayment) keys.push('payment');
    if (underSystem || showSystem) keys.push('system');
    return keys;
  });

  useEffect(() => {
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (showUserGroup) next.add('user-group');
      if (showDataResource) next.add('data-resource');
      if (showOperation) next.add('operation');
      if (showKnowledge) next.add('knowledge');
      if (showPayment) next.add('payment');
      if (showSystem) next.add('system');
      return [...next];
    });
  }, [
    showUserGroup,
    showDataResource,
    showOperation,
    showKnowledge,
    showPayment,
    showSystem,
  ]);

  const pageMeta = ADMIN_PAGES[activePath] ?? {
    title: brandNameShort,
    sub: APP_TITLE,
  };
  const isFlush = Boolean(ADMIN_PAGES[activePath]?.flush);

  const onLogout = async () => {
    try {
      if (refreshToken) await logoutApi(refreshToken);
    } catch {
      // ignore
    }
    cancelAccessTokenRefresh();
    clearTabs();
    clear();
    navigate('/login', { replace: true });
  };

  const onMenuClick: MenuProps['onClick'] = ({ key }) => {
    if (
      key === 'user-group' ||
      key === 'data-resource' ||
      key === 'knowledge' ||
      key === 'operation' ||
      key === 'payment' ||
      key === 'system'
    ) {
      return;
    }
    navigate(key);
  };

  return (
    <Layout className="admin-layout">
      {isNarrow && !collapsed ? (
        <button
          type="button"
          className="admin-sider-mask"
          aria-label="关闭侧栏"
          onClick={() => setCollapsed(true)}
        />
      ) : null}
      <Sider
        className="admin-sider"
        width={248}
        collapsible
        collapsed={collapsed}
        collapsedWidth={isNarrow ? 0 : 72}
        breakpoint="lg"
        trigger={null}
        onBreakpoint={(broken) => setCollapsed(broken)}
        onCollapse={setCollapsed}
      >
        <div className="admin-brand">
          <img alt="AID" className="admin-brand-logo" src={logoAi} />
          <div className="admin-brand-text">
            <p className="admin-brand-title">{APP_TITLE}</p>
          </div>
        </div>
        <Menu
          className="admin-menu"
          theme="dark"
          mode="inline"
          selectedKeys={[
            activePath === '/knowledge/library-detail'
              ? '/knowledge/library'
              : activePath === '/knowledge/user-detail'
                ? '/knowledge/user'
                : activePath,
          ]}
          {...(collapsed
            ? {}
            : { openKeys, onOpenChange: setOpenKeys })}
          items={menuItems}
          onClick={(info) => {
            onMenuClick(info);
            if (isNarrow) setCollapsed(true);
          }}
        />
      </Sider>
      <Layout className="admin-main">
        <Header className="admin-header">
          <div className="admin-header-left">
            <Button
              type="text"
              className="admin-sider-toggle"
              aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <div className="admin-header-titles">
              <h1 className="admin-header-title">{pageMeta.title}</h1>
              <p className="admin-header-sub">{pageMeta.sub}</p>
            </div>
          </div>
          <div className="admin-header-right">
            <button
              type="button"
              className="admin-user-chip admin-user-chip--clickable"
              onClick={() => navigate('/profile')}
              title="个人信息"
            >
              <UserOutlined />
              <Typography.Text>
                {profile?.displayName || profile?.username || '管理员'}
              </Typography.Text>
            </button>
            <Button type="text" icon={<LogoutOutlined />} onClick={onLogout}>
              退出
            </Button>
          </div>
        </Header>
        <PageTabs />
        <Content
          className={`admin-content${isFlush ? ' admin-content--flush' : ''}`}
        >
          <div
            className={`admin-content-inner ${
              isFlush ? 'admin-content-inner--flush' : 'admin-content-shell'
            }`}
            style={
              isFlush
                ? undefined
                : {
                    padding: 24,
                    background: colorBgContainer,
                    borderRadius: borderRadiusLG,
                  }
            }
          >
            <KeepAliveOutlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
