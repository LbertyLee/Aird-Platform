import type { ThemeConfig } from 'antd';

/**
 * AI 智库数据智能分析平台 —— 管理端主题。
 * 浅色工作台 + 蓝色主色（与登录页一致）。
 */
export const brandName = 'AI智库数据智能分析平台';
export const brandNameShort = 'AI智库';

/** 设计色板（内容区浅色 + 侧栏深色） */
export const palette = {
  primary: '#2563EB',
  primaryHover: '#3B82F6',
  primaryActive: '#1D4ED8',
  primarySoft: '#EFF6FF',
  sidebarBg: '#001529',
  sidebarBorder: 'rgba(255, 255, 255, 0.08)',
  sidebarText: 'rgba(255, 255, 255, 0.65)',
  sidebarTextActive: '#ffffff',
  pageBg: '#F5F7FA',
  cardBg: '#FFFFFF',
  border: '#E6EBF0',
  text: '#1E293B',
  textSecondary: '#64748B',
  success: '#52C41A',
} as const;

/** Ant Design ConfigProvider 主题 */
export const adminTheme: ThemeConfig = {
  token: {
    colorPrimary: palette.primary,
    colorInfo: palette.primary,
    colorSuccess: palette.success,
    colorLink: palette.primary,
    colorBgLayout: palette.pageBg,
    colorBgContainer: palette.cardBg,
    colorBorder: palette.border,
    colorBorderSecondary: '#EEF2F6',
    colorText: palette.text,
    colorTextSecondary: palette.textSecondary,
    colorTextTertiary: '#94A3B8',
    colorBgTextHover: palette.primarySoft,
    controlItemBgHover: '#F0F5FF',
    controlItemBgActive: palette.primarySoft,
    controlItemBgActiveHover: '#DBEAFE',
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 6,
    fontSize: 14,
    fontSizeHeading5: 16,
    lineHeight: 1.65,
    fontFamily:
      '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif',
    controlHeight: 36,
    controlHeightLG: 40,
    motionDurationMid: '0.2s',
    boxShadow:
      '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.03)',
    boxShadowSecondary:
      '0 4px 16px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
  },
  components: {
    Layout: {
      siderBg: palette.sidebarBg,
      headerBg: palette.cardBg,
      bodyBg: palette.pageBg,
      triggerBg: palette.primary,
    },
    Typography: {
      titleMarginBottom: '0.35em',
      titleMarginTop: '0.6em',
      fontWeightStrong: 600,
    },
    Menu: {
      darkItemBg: 'transparent',
      darkSubMenuItemBg: '#000c17',
      darkItemColor: palette.sidebarText,
      darkItemHoverColor: palette.sidebarTextActive,
      darkItemHoverBg: 'rgba(255, 255, 255, 0.08)',
      darkItemSelectedColor: palette.sidebarTextActive,
      darkItemSelectedBg: palette.primary,
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemColor: '#4B5563',
      itemHoverColor: palette.primaryActive,
      itemHoverBg: palette.primarySoft,
      itemSelectedColor: palette.primaryActive,
      itemSelectedBg: palette.primarySoft,
      itemActiveBg: palette.primarySoft,
      iconSize: 16,
      itemBorderRadius: 8,
      itemMarginInline: 10,
      itemMarginBlock: 4,
      itemHeight: 40,
      activeBarBorderWidth: 0,
    },
    Button: {
      primaryShadow: 'none',
      defaultShadow: 'none',
      dangerShadow: 'none',
      borderRadius: 8,
      borderRadiusLG: 10,
      borderRadiusSM: 6,
      fontWeight: 500,
      paddingInline: 16,
      colorPrimary: palette.primary,
      colorPrimaryHover: palette.primaryHover,
      colorPrimaryActive: palette.primaryActive,
      contentFontSizeSM: 13,
    },
    Card: {
      borderRadiusLG: 10,
      paddingLG: 22,
      headerFontSize: 15,
    },
    Table: {
      headerBg: '#F8FAFC',
      headerColor: '#475569',
      headerSplitColor: 'transparent',
      borderColor: '#EEF2F6',
      rowHoverBg: '#F8FBFF',
      cellPaddingBlock: 14,
      cellPaddingInline: 16,
      headerBorderRadius: 0,
      fontWeightStrong: 500,
    },
    Tree: {
      directoryNodeSelectedBg: palette.primarySoft,
      directoryNodeSelectedColor: palette.primaryActive,
      nodeSelectedBg: palette.primarySoft,
      nodeHoverBg: '#F0F5FF',
    },
    Tag: {
      defaultBg: '#F1F5F9',
      defaultColor: '#475569',
      borderRadiusSM: 6,
    },
    Tabs: {
      itemSelectedColor: palette.primaryActive,
      inkBarColor: palette.primary,
      itemHoverColor: palette.primaryHover,
      titleFontSize: 14,
    },
    Input: {
      borderRadius: 8,
      paddingBlock: 7,
      activeShadow: '0 0 0 3px rgba(37, 99, 235, 0.12)',
      errorActiveShadow: '0 0 0 3px rgba(255, 77, 79, 0.12)',
    },
    Select: {
      borderRadius: 8,
      optionSelectedBg: palette.primarySoft,
      optionActiveBg: '#F8FBFF',
    },
    Modal: {
      borderRadiusLG: 12,
      titleFontSize: 16,
    },
    Pagination: {
      itemActiveBg: palette.primarySoft,
      borderRadius: 6,
    },
    Form: {
      labelColor: '#334155',
      labelFontSize: 13,
      itemMarginBottom: 18,
      verticalLabelPadding: '0 0 6px',
    },
    Dropdown: {
      borderRadiusLG: 10,
      paddingBlock: 6,
      controlItemBgHover: '#F8FBFF',
    },
    Message: {
      contentBg: '#FFFFFF',
      borderRadiusLG: 10,
    },
  },
};
