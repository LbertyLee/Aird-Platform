/** 系统内置角色编码 */
export const BUILTIN_ROLE_CODES = [
  'platform_admin',
  'regular_user',
] as const;

export type BuiltinRoleCode = (typeof BUILTIN_ROLE_CODES)[number];

/** 权限矩阵模块定义 */
export const PERMISSION_MATRIX_MODULES: Array<{
  key: string;
  title: string;
  /** 个人端模块无管理端权限点，仅用于矩阵展示 */
  virtual?: boolean;
  codes?: string[];
}> = [
  {
    key: 'client_portal',
    title: '个人端（检索 / 分析 / 报告 / 知识库 / 个人中心 / 支付）',
    virtual: true,
  },
  {
    key: 'admin_data',
    title: '管理端 · 数据资源 / 数据治理',
    codes: [
      'menu:data:indicator',
      'menu:data:dict',
      'menu:data:dataset',
      'menu:data:field-mapping',
      'button:data:indicator:create',
      'button:data:indicator:update',
      'button:data:indicator:delete',
      'button:data:dict:create',
      'button:data:dict:update',
      'button:data:dict:delete',
      'button:data:dataset:create',
      'button:data:dataset:update',
      'button:data:dataset:delete',
      'button:data:dataset:publish',
      'button:data:dataset:upload',
      'button:data:field-mapping:create',
      'button:data:field-mapping:update',
      'button:data:field-mapping:delete',
    ],
  },
  {
    key: 'admin_account',
    title: '管理端 · 账号管理 / 运营管理',
    codes: [
      'menu:user',
      'menu:agent',
      'menu:membership:level',
      'menu:membership:order',
      'menu:rbac:role',
      'menu:dashboard',
      'menu:oper:log',
      'menu:operation:announcement',
      'button:user:create',
      'button:user:update',
      'button:user:disable',
      'button:user:reset_password',
      'button:user:delete',
      'button:rbac:role:delete',
      'button:membership:bind_benefit',
      'button:operation:announcement:create',
      'button:operation:announcement:update',
      'button:operation:announcement:publish',
      'export:user',
    ],
  },
  {
    key: 'admin_system',
    title: '管理端 · 系统管理 / 知识库管理 / 支付中心',
    codes: [
      'menu:knowledge:library',
      'menu:knowledge:user',
      'menu:knowledge:public-review',
      'menu:knowledge:index',
      'button:knowledge:library:create',
      'button:knowledge:library:update',
      'button:knowledge:library:delete',
      'button:knowledge:item:create',
      'button:knowledge:item:update',
      'button:knowledge:item:delete',
      'button:knowledge:item:publish',
      'button:knowledge:item:upload',
      'button:knowledge:audit:approve',
      'button:knowledge:audit:reject',
      'button:knowledge:category:create',
      'button:knowledge:category:update',
      'button:knowledge:category:delete',
      'button:knowledge:tag:create',
      'button:knowledge:tag:update',
      'button:knowledge:tag:delete',
      'button:knowledge:index:rebuild',
      'button:knowledge:index:cleanup',
      'menu:system:backup',
      'menu:system:search-model',
      'button:system:search-model:create',
      'button:system:search-model:update',
      'button:system:search-model:delete',
      'button:system:backup:run',
      'button:system:backup:restore',
      'menu:payment:config',
      'button:payment:channel:create',
      'button:payment:channel:update',
      'button:payment:channel:disable',
      'button:payment:credential:update',
      'button:payment:order:close',
      'button:payment:order:refund',
      'button:payment:order:process',
      'data:all',
    ],
  },
];

/** 角色卡片展示标签 */
export const ROLE_DISPLAY_TAGS: Record<
  BuiltinRoleCode,
  { tags: string[]; tagColor: 'primary' | 'info' }
> = {
  platform_admin: {
    tags: ['用户管理', '管理端全部', '系统管理', '支付配置'],
    tagColor: 'primary',
  },
  regular_user: {
    tags: ['个人端全部', '管理端不可见'],
    tagColor: 'info',
  },
};

/** 默认权限矩阵 */
export const DEFAULT_PERMISSION_MATRIX: Record<
  string,
  Record<BuiltinRoleCode, boolean>
> = {
  client_portal: {
    platform_admin: true,
    regular_user: true,
  },
  admin_data: {
    platform_admin: true,
    regular_user: false,
  },
  admin_account: {
    platform_admin: true,
    regular_user: false,
  },
  admin_system: {
    platform_admin: true,
    regular_user: false,
  },
};

/** 根据矩阵勾选结果收集某角色应绑定的权限码 */
export function collectPermissionCodesForRole(
  roleCode: BuiltinRoleCode,
  matrix: Record<string, Record<BuiltinRoleCode, boolean>>,
): string[] {
  const codes = new Set<string>();
  for (const mod of PERMISSION_MATRIX_MODULES) {
    if (mod.virtual || !mod.codes?.length) continue;
    if (matrix[mod.key]?.[roleCode]) {
      mod.codes.forEach((c) => codes.add(c));
    }
  }
  return [...codes];
}
