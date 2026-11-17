import {
  AuditOutlined,
  BookOutlined,
  ClusterOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  ApartmentOutlined,
  ExperimentOutlined,
  FileSearchOutlined,
  NotificationOutlined,
  PayCircleOutlined,
  ReadOutlined,
  SafetyOutlined,
  TeamOutlined,
  UserOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import type { ComponentType, ReactNode } from 'react';
import { DashboardPage } from '../pages/DashboardPage';
import { DatasetsPage } from '../pages/DatasetsPage';
import { DictionariesPage } from '../pages/DictionariesPage';
import { FieldMappingsPage } from '../pages/FieldMappingsPage';
import { IngestionJobsPage } from '../pages/IngestionJobsPage';
import { IndicatorsPage } from '../pages/IndicatorsPage';
import { SearchTestPage } from '../pages/SearchTestPage';
import { KnowledgeIndexesPage } from '../pages/KnowledgeIndexesPage';
import { KnowledgeLibraryDetailPage } from '../pages/KnowledgeLibraryDetailPage';
import { KnowledgeLibraryPage } from '../pages/KnowledgeLibraryPage';
import { KnowledgePublicReviewPage } from '../pages/KnowledgePublicReviewPage';
import { KnowledgeUserLibraryDetailPage } from '../pages/KnowledgeUserLibraryDetailPage';
import { KnowledgeUserLibraryPage } from '../pages/KnowledgeUserLibraryPage';
import { MembershipPage } from '../pages/MembershipPage';
import { AnnouncementsPage } from '../pages/AnnouncementsPage';
import { OperLogsPage } from '../pages/OperLogsPage';
import { PaymentCenterPage } from '../pages/PaymentCenterPage';
import { ProfilePage } from '../pages/ProfilePage';
import { RolesPage } from '../pages/RolesPage';
import { SystemBackupsPage } from '../pages/SystemBackupsPage';
import { UsersPage } from '../pages/UsersPage';
import { AgentsPage } from '../pages/AgentsPage';
import { SearchModelsPage } from '../pages/SearchModelsPage';

/** 管理端可缓存页签定义 */
export type AdminPageDef = {
  /** 页签短标题 */
  title: string;
  /** 顶栏副标题 */
  sub: string;
  /** 页签图标 */
  icon: ReactNode;
  /** 页面组件 */
  component: ComponentType;
  /** 是否可关闭；首页默认不可关 */
  closable?: boolean;
  /** 内容区是否贴边（无白卡片壳） */
  flush?: boolean;
};

/**
 * 路径 → 页面注册表（页签 / KeepAlive 共用）。
 */
export const ADMIN_PAGES: Record<string, AdminPageDef> = {
  '/': {
    title: '平台总览',
    sub: '平台总览',
    icon: <DashboardOutlined />,
    component: DashboardPage,
    closable: false,
    flush: true,
  },
  '/users': {
    title: '用户账号',
    sub: '账号、角色与会员分配',
    icon: <TeamOutlined />,
    component: UsersPage,
    flush: true,
  },
  '/agents': { title: '智能体维护', sub: '智能体内容、分类与上架状态管理', icon: <RobotOutlined />, component: AgentsPage, flush: true },
  '/membership': {
    title: '会员管理',
    sub: '套餐方案、缴费订单与续费提醒',
    icon: <CrownOutlined />,
    component: MembershipPage,
    flush: true,
  },
  '/payment/config': {
    title: '订单与支付配置',
    sub: '订单管理与支付渠道配置',
    icon: <PayCircleOutlined />,
    component: PaymentCenterPage,
    flush: true,
  },
  '/rbac/roles': {
    title: '角色管理',
    sub: '角色列表与菜单权限配置',
    icon: <SafetyOutlined />,
    component: RolesPage,
    flush: true,
  },
  '/oper-logs': {
    title: '操作日志',
    sub: '全部操作、登录、导出与删除记录',
    icon: <FileSearchOutlined />,
    component: OperLogsPage,
    flush: true,
  },
  '/operation/announcements': {
    title: '消息公告',
    sub: '平台公告发布与业务通知记录',
    icon: <NotificationOutlined />,
    component: AnnouncementsPage,
  },
  '/system/backups': {
    title: '数据备份',
    sub: '自动备份 PostgreSQL、业务文件与环境配置',
    icon: <CloudUploadOutlined />,
    component: SystemBackupsPage,
  },
  '/system/search-models': {
    title: '搜索模型', sub: '用户可选大模型配置', icon: <RobotOutlined />, component: SearchModelsPage, flush: true,
  },
  '/data/indicators': {
    title: '指标管理',
    sub: '标准指标库与来源映射',
    icon: <ReadOutlined />,
    component: IndicatorsPage,
  },
  '/data/dictionaries': {
    title: '字典管理',
    sub: '检索与标准化基础字典',
    icon: <BookOutlined />,
    component: DictionariesPage,
  },
  '/data/datasets': {
    title: '来源管理',
    sub: '数据来源网站/目录配置（非文件上传）',
    icon: <DatabaseOutlined />,
    component: DatasetsPage,
  },
  '/data/field-mappings': {
    title: '字段映射',
    sub: '指标与知识库结构化字段的 Semantic Layer 映射',
    icon: <ApartmentOutlined />,
    component: FieldMappingsPage,
  },
  '/data/ingestion-jobs': {
    title: '接入任务',
    sub: '验证知识库上传后的学习 / 结构化接入流水线',
    icon: <CloudUploadOutlined />,
    component: IngestionJobsPage,
  },
  '/data/search-test': {
    title: '搜索测试',
    sub: '学习完成后验证 Semantic / RAG / Text-to-SQL 检索链路',
    icon: <ExperimentOutlined />,
    component: SearchTestPage,
  },
  '/knowledge/library': {
    title: '知识库管理',
    sub: '平台知识库分组与文档沉淀',
    icon: <BookOutlined />,
    component: KnowledgeLibraryPage,
    flush: true,
  },
  '/knowledge/library-detail': {
    title: '知识库详情',
    sub: '知识文档列表、预览与下载',
    icon: <BookOutlined />,
    component: KnowledgeLibraryDetailPage,
    flush: true,
  },
  '/knowledge/user': {
    title: '用户知识库管理',
    sub: '按用户查看个人知识库与文档',
    icon: <UserOutlined />,
    component: KnowledgeUserLibraryPage,
    flush: true,
  },
  '/knowledge/user-detail': {
    title: '用户知识库详情',
    sub: '用户知识库文档在线查看',
    icon: <UserOutlined />,
    component: KnowledgeUserLibraryDetailPage,
    flush: true,
  },
  '/knowledge/public-review': {
    title: '公开数据审核',
    sub: '用户公开申请通过与驳回',
    icon: <AuditOutlined />,
    component: KnowledgePublicReviewPage,
    flush: true,
  },
  '/knowledge/indexes': {
    title: '知识索引',
    sub: '向量索引概览、重建、清空与失败排查',
    icon: <ClusterOutlined />,
    component: KnowledgeIndexesPage,
  },
  '/profile': {
    title: '个人信息',
    sub: '账号资料与密码管理',
    icon: <UserOutlined />,
    component: ProfilePage,
  },
};

/** 历史别名路径归一化 */
const PATH_ALIASES: Record<string, string> = {
  '/membership/levels': '/membership',
  '/membership/orders': '/membership',
  '/knowledge/audit': '/knowledge/public-review',
  '/knowledge/categories': '/knowledge/user',
  '/knowledge/permissions': '/knowledge/library',
};

/** 规范化路径（去尾斜杠、合并别名） */
export function normalizeAdminPath(pathname: string): string {
  let path = pathname || '/';
  if (path !== '/' && path.endsWith('/')) {
    path = path.replace(/\/+$/, '') || '/';
  }
  return PATH_ALIASES[path] ?? path;
}

/** 是否为已注册管理页 */
export function isAdminPage(pathname: string): boolean {
  return normalizeAdminPath(pathname) in ADMIN_PAGES;
}
