import {
  PrismaClient,
  PermissionType,
  RoleType,
  UserStatus,
  MembershipScope,
  BenefitValueType,
  CommonStatus,
  DataScopeType,
  PackageType,
  PackageTag,
  OrderStatus,
  SubscriptionStatus,
  AnnouncementAudienceScope,
  AnnouncementStatus,
  BusinessNotificationStatus,
  SensitiveWordCategory,
  LocationKind,
  KnowledgeLibraryType,
  KnowledgeVisibility,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  AGENT_CATEGORY_SEEDS,
  LEGAL_DOCUMENT_SEEDS,
  KNOWLEDGE_GROUP_SEEDS,
  SOURCE_CATEGORY_SEEDS,
  SYSTEM_DICT_CODES,
  SYSTEM_DICT_TYPE_SEEDS,
} from '../src/modules/dictionary/dictionary-type.constants';
import {
  DEFAULT_PRIVACY_POLICY_HTML,
  DEFAULT_USER_AGREEMENT_HTML,
} from '../src/modules/dictionary/legal-document-defaults';
import {
  USER_SUPPLEMENT_LIBRARY_CODE,
  USER_SUPPLEMENT_LIBRARY_INTRO,
  USER_SUPPLEMENT_LIBRARY_NAME,
} from '../src/modules/knowledge/knowledge.constants';
import { upsertByFinder } from './seed-active-upsert';

/**
 * 数据库种子脚本：权限、角色、权益定义、免费档、超级管理员 netsoil。
 */
const prisma = new PrismaClient();

/** 预置权限点 */
const permissions: Array<{
  code: string;
  name: string;
  type: PermissionType;
  path?: string;
  sort: number;
  parentCode?: string;
}> = [
  {
    code: 'menu:dashboard',
    name: '运营看板',
    type: PermissionType.menu,
    path: '/',
    sort: 10,
  },
  {
    code: 'menu:user',
    name: '用户管理',
    type: PermissionType.menu,
    path: '/users',
    sort: 30,
  },
  {
    code: 'menu:agent',
    name: '智能体维护',
    type: PermissionType.menu,
    path: '/agents',
    sort: 35,
  },
  {
    code: 'menu:membership:level',
    name: '会员等级',
    type: PermissionType.menu,
    path: '/membership',
    sort: 40,
  },
  {
    code: 'menu:membership:order',
    name: '会员订单',
    type: PermissionType.menu,
    path: '/membership',
    sort: 41,
  },
  {
    code: 'menu:payment:config',
    name: '订单与支付配置',
    type: PermissionType.menu,
    path: '/payment/config',
    sort: 50,
  },
  {
    code: 'menu:rbac:role',
    name: '角色权限',
    type: PermissionType.menu,
    path: '/rbac/roles',
    sort: 60,
  },
  {
    code: 'menu:data:indicator',
    name: '指标管理',
    type: PermissionType.menu,
    path: '/data/indicators',
    sort: 70,
  },
  {
    code: 'menu:data:dict',
    name: '字典管理',
    type: PermissionType.menu,
    path: '/data/dictionaries',
    sort: 71,
  },
  {
    code: 'menu:data:dataset',
    name: '来源管理',
    type: PermissionType.menu,
    path: '/data/datasets',
    sort: 72,
  },
  {
    code: 'menu:data:structured-data',
    name: '结构化数据',
    type: PermissionType.menu,
    path: '/data/structured-data',
    sort: 72.5,
  },
  {
    code: 'menu:data:field-mapping',
    name: '字段映射',
    type: PermissionType.menu,
    path: '/data/field-mappings',
    sort: 73,
  },
  {
    code: 'menu:knowledge:library',
    name: '知识库管理',
    type: PermissionType.menu,
    path: '/knowledge/library',
    sort: 80,
  },
  {
    code: 'menu:knowledge:user',
    name: '用户知识库管理',
    type: PermissionType.menu,
    path: '/knowledge/user',
    sort: 81,
  },
  {
    code: 'menu:knowledge:public-review',
    name: '公开数据审核',
    type: PermissionType.menu,
    path: '/knowledge/public-review',
    sort: 82,
  },
  {
    code: 'menu:knowledge:index',
    name: '知识索引',
    type: PermissionType.menu,
    path: '/knowledge/indexes',
    sort: 86,
  },
  {
    code: 'menu:oper:log',
    name: '操作日志',
    type: PermissionType.menu,
    path: '/oper-logs',
    sort: 90,
  },
  {
    code: 'menu:operation:announcement',
    name: '消息公告',
    type: PermissionType.menu,
    path: '/operation/announcements',
    sort: 91,
  },
  {
    code: 'menu:system:backup',
    name: '数据备份',
    type: PermissionType.menu,
    path: '/system/backups',
    sort: 95,
  },
  {
    code: 'button:user:create',
    name: '用户新增',
    type: PermissionType.button,
    sort: 100,
  },
  {
    code: 'button:user:update',
    name: '用户编辑',
    type: PermissionType.button,
    sort: 101,
  },
  {
    code: 'button:user:disable',
    name: '用户禁用',
    type: PermissionType.button,
    sort: 102,
  },
  {
    code: 'button:user:reset_password',
    name: '重置密码',
    type: PermissionType.button,
    sort: 103,
  },
  {
    code: 'button:user:delete',
    name: '用户删除',
    type: PermissionType.button,
    sort: 104,
  },
  {
    code: 'button:rbac:role:delete',
    name: '角色删除',
    type: PermissionType.button,
    sort: 105,
  },
  {
    code: 'button:membership:bind_benefit',
    name: '配置权益',
    type: PermissionType.button,
    sort: 120,
  },
  {
    code: 'button:payment:channel:create',
    name: '支付渠道新增',
    type: PermissionType.button,
    sort: 121,
  },
  {
    code: 'button:payment:channel:update',
    name: '支付渠道编辑',
    type: PermissionType.button,
    sort: 122,
  },
  {
    code: 'button:payment:channel:disable',
    name: '支付渠道停用',
    type: PermissionType.button,
    sort: 123,
  },
  {
    code: 'button:payment:credential:update',
    name: '支付密钥更新',
    type: PermissionType.button,
    sort: 124,
  },
  {
    code: 'button:payment:order:close',
    name: '订单关闭',
    type: PermissionType.button,
    sort: 125,
  },
  {
    code: 'button:payment:order:refund',
    name: '订单退款',
    type: PermissionType.button,
    sort: 126,
  },
  {
    code: 'button:payment:order:process',
    name: '异常订单处理',
    type: PermissionType.button,
    sort: 127,
  },
  {
    code: 'button:data:indicator:create',
    name: '指标新增',
    type: PermissionType.button,
    sort: 130,
  },
  {
    code: 'button:data:indicator:update',
    name: '指标编辑',
    type: PermissionType.button,
    sort: 131,
  },
  {
    code: 'button:data:indicator:delete',
    name: '指标删除',
    type: PermissionType.button,
    sort: 132,
  },
  {
    code: 'button:data:dict:create',
    name: '字典新增',
    type: PermissionType.button,
    sort: 140,
  },
  {
    code: 'button:data:dict:update',
    name: '字典编辑',
    type: PermissionType.button,
    sort: 141,
  },
  {
    code: 'button:data:dict:delete',
    name: '字典删除',
    type: PermissionType.button,
    sort: 142,
  },
  {
    code: 'button:data:dataset:create',
    name: '来源新增',
    type: PermissionType.button,
    sort: 150,
  },
  {
    code: 'button:data:dataset:update',
    name: '来源编辑',
    type: PermissionType.button,
    sort: 151,
  },
  {
    code: 'button:data:dataset:delete',
    name: '来源删除',
    type: PermissionType.button,
    sort: 152,
  },
  {
    code: 'button:data:dataset:publish',
    name: '来源上下架',
    type: PermissionType.button,
    sort: 153,
  },
  {
    code: 'button:data:dataset:upload',
    name: '来源文件上传',
    type: PermissionType.button,
    sort: 154,
  },
  {
    code: 'button:data:field-mapping:create',
    name: '字段映射新增',
    type: PermissionType.button,
    sort: 155,
  },
  {
    code: 'button:data:field-mapping:update',
    name: '字段映射编辑',
    type: PermissionType.button,
    sort: 156,
  },
  {
    code: 'button:data:field-mapping:delete',
    name: '字段映射删除',
    type: PermissionType.button,
    sort: 157,
  },
  {
    code: 'button:knowledge:library:create',
    name: '知识库新增',
    type: PermissionType.button,
    sort: 158,
  },
  {
    code: 'button:knowledge:library:update',
    name: '知识库编辑',
    type: PermissionType.button,
    sort: 159,
  },
  {
    code: 'button:knowledge:library:delete',
    name: '知识库删除',
    type: PermissionType.button,
    sort: 160,
  },
  {
    code: 'button:knowledge:item:create',
    name: '知识条目新增',
    type: PermissionType.button,
    sort: 161,
  },
  {
    code: 'button:knowledge:item:update',
    name: '知识条目编辑',
    type: PermissionType.button,
    sort: 162,
  },
  {
    code: 'button:knowledge:item:delete',
    name: '知识条目删除',
    type: PermissionType.button,
    sort: 163,
  },
  {
    code: 'button:knowledge:item:publish',
    name: '知识条目上下架',
    type: PermissionType.button,
    sort: 164,
  },
  {
    code: 'button:knowledge:item:upload',
    name: '知识条目上传',
    type: PermissionType.button,
    sort: 165,
  },
  {
    code: 'button:knowledge:audit:approve',
    name: '知识审核通过',
    type: PermissionType.button,
    sort: 166,
  },
  {
    code: 'button:knowledge:audit:reject',
    name: '知识审核驳回',
    type: PermissionType.button,
    sort: 167,
  },
  {
    code: 'button:knowledge:category:create',
    name: '知识分类新增',
    type: PermissionType.button,
    sort: 170,
  },
  {
    code: 'button:knowledge:category:update',
    name: '知识分类编辑',
    type: PermissionType.button,
    sort: 171,
  },
  {
    code: 'button:knowledge:category:delete',
    name: '知识分类删除',
    type: PermissionType.button,
    sort: 172,
  },
  {
    code: 'button:knowledge:tag:create',
    name: '知识标签新增',
    type: PermissionType.button,
    sort: 173,
  },
  {
    code: 'button:knowledge:tag:update',
    name: '知识标签编辑',
    type: PermissionType.button,
    sort: 174,
  },
  {
    code: 'button:knowledge:tag:delete',
    name: '知识标签删除',
    type: PermissionType.button,
    sort: 175,
  },
  {
    code: 'button:knowledge:index:rebuild',
    name: '知识索引重建',
    type: PermissionType.button,
    sort: 180,
  },
  {
    code: 'button:knowledge:index:cleanup',
    name: '知识索引清理',
    type: PermissionType.button,
    sort: 181,
  },
  {
    code: 'button:operation:announcement:create',
    name: '公告新增',
    type: PermissionType.button,
    sort: 190,
  },
  {
    code: 'button:operation:announcement:update',
    name: '公告编辑',
    type: PermissionType.button,
    sort: 191,
  },
  {
    code: 'button:operation:announcement:publish',
    name: '公告发布撤回',
    type: PermissionType.button,
    sort: 192,
  },
  {
    code: 'button:system:backup:run',
    name: '手动触发备份',
    type: PermissionType.button,
    sort: 195,
  },
  {
    code: 'button:system:backup:restore',
    name: '一键恢复备份',
    type: PermissionType.button,
    sort: 196,
  },
  {
    code: 'export:user',
    name: '导出用户',
    type: PermissionType.export,
    sort: 200,
  },
  { code: 'data:all', name: '全部数据', type: PermissionType.data, sort: 300 },
];

async function main() {
  // 权限
  const permissionMap = new Map<string, string>();
  for (const item of permissions) {
    const row = await upsertByFinder(
      () => prisma.permission.findFirst({ where: { code: item.code } }),
      (id) =>
        prisma.permission.update({
          where: { id },
          data: {
            name: item.name,
            type: item.type,
            path: item.path,
            sort: item.sort,
            deletedAt: null,
          },
        }),
      () =>
        prisma.permission.create({
          data: {
            code: item.code,
            name: item.name,
            type: item.type,
            path: item.path,
            sort: item.sort,
          },
        }),
    );
    permissionMap.set(item.code, row.id);
  }

  // 下线废弃权限：旧菜单兼容码、用户批量导入、组织管理等
  for (const code of [
    'menu:knowledge:audit',
    'menu:knowledge:category',
    'menu:knowledge:permission',
    'button:user:import',
    'menu:org',
    'button:org:create',
    'menu:operation:search',
    'button:operation:search:sensitive',
    'button:operation:search:quick',
    'export:operation:search',
  ]) {
    const obsolete = await prisma.permission.findFirst({ where: { code } });
    if (obsolete) {
      await prisma.rolePermission.deleteMany({
        where: { permissionId: obsolete.id },
      });
      await prisma.permission.delete({ where: { id: obsolete.id } });
    }
  }

  // 预置内置角色（系统内置不可删除）
  await prisma.role.updateMany({
    where: { code: 'visitor', deletedAt: null },
    data: { deletedAt: new Date(), status: CommonStatus.disabled },
  });

  const roles: Array<{
    code: string;
    name: string;
    description: string;
    status: CommonStatus;
  }> = [
    {
      code: 'platform_admin',
      name: '平台管理员',
      description: '拥有管理端全部功能权限及个人用户数据管理权限。',
      status: CommonStatus.active,
    },
    {
      code: 'regular_user',
      name: '普通用户',
      description: '拥有个人端全部功能权限，不开放管理端。',
      status: CommonStatus.active,
    },
  ];

  const roleMap = new Map<string, string>();
  for (const role of roles) {
    const row = await upsertByFinder(
      () => prisma.role.findFirst({ where: { code: role.code } }),
      (id) =>
        prisma.role.update({
          where: { id },
          data: {
            name: role.name,
            description: role.description,
            type: RoleType.system,
            status: role.status,
            deletedAt: null,
          },
        }),
      () =>
        prisma.role.create({
          data: {
            code: role.code,
            name: role.name,
            description: role.description,
            type: RoleType.system,
            status: role.status,
          },
        }),
    );
    roleMap.set(role.code, row.id);
  }

  // 下线历史及多余的自定义角色，保留系统内置两类
  const regularUserRoleId = roleMap.get('regular_user')!;
  const orphanRoles = await prisma.role.findMany({
    where: {
      code: { notIn: ['platform_admin', 'regular_user'] },
      deletedAt: null,
    },
    select: { id: true },
  });
  for (const orphan of orphanRoles) {
    const bindings = await prisma.userRole.findMany({
      where: { roleId: orphan.id },
      select: { userId: true },
    });
    for (const { userId } of bindings) {
      await prisma.userRole.upsert({
        where: {
          userId_roleId: { userId, roleId: regularUserRoleId },
        },
        update: {},
        create: { userId, roleId: regularUserRoleId },
      });
    }
    await prisma.userRole.deleteMany({ where: { roleId: orphan.id } });
  }
  if (orphanRoles.length > 0) {
    await prisma.role.updateMany({
      where: { id: { in: orphanRoles.map((r) => r.id) } },
      data: { deletedAt: new Date(), status: CommonStatus.disabled },
    });
  }

  // 平台管理员绑定全部权限 + 全量数据范围
  const platformAdminId = roleMap.get('platform_admin')!;
  for (const permissionId of permissionMap.values()) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: platformAdminId, permissionId },
      },
      update: {},
      create: { roleId: platformAdminId, permissionId },
    });
  }
  if ((await prisma.agent.count()) === 0) {
    await prisma.agent.createMany({
      data: [
        {
          name: '学习搭子',
          description: '好好学习，搭桥向上！',
          categoryCode: 'learning',
          author: '智谱清言',
          icon: '🧠',
          iconColor: '#d9f99d',
          usageCount: 65100,
          sort: 1,
        },
        {
          name: '高情商杨老师',
          description: '话术大师帮你出招—语言的艺术，人格的魅力',
          categoryCode: 'workplace',
          author: '呆老师DAI-Lord',
          icon: '💬',
          iconColor: '#4f46e5',
          usageCount: 181000,
          sort: 2,
        },
        {
          name: 'AI画图',
          description: '打开你的脑洞，所想即所画！',
          categoryCode: 'ai_tools',
          author: '智谱清言',
          icon: '✦',
          iconColor: '#e9b7f7',
          usageCount: 13430000,
          sort: 3,
        },
      ],
    });
  }
  await prisma.dataScope.upsert({
    where: { roleId: platformAdminId },
    update: { scopeType: DataScopeType.all },
    create: { roleId: platformAdminId, scopeType: DataScopeType.all },
  });

  // 普通用户：无管理端权限
  for (const code of ['regular_user'] as const) {
    const roleId = roleMap.get(code)!;
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.dataScope.upsert({
      where: { roleId },
      update: { scopeType: DataScopeType.self },
      create: { roleId, scopeType: DataScopeType.self },
    });
  }

  // 权益定义
  const benefits = [
    {
      code: 'search_quota',
      name: '搜索次数',
      valueType: BenefitValueType.int,
      unit: '次/周期',
    },
    {
      code: 'export_quota',
      name: '导出次数',
      valueType: BenefitValueType.int,
      unit: '次/周期',
    },
    {
      code: 'max_agents',
      name: 'Agent 数量',
      valueType: BenefitValueType.int,
      unit: '个',
    },
    {
      code: 'storage_bytes',
      name: '存储容量',
      valueType: BenefitValueType.bytes,
      unit: '字节',
    },
  ];
  for (const b of benefits) {
    await prisma.benefitDefinition.upsert({
      where: { code: b.code },
      update: { name: b.name, valueType: b.valueType, unit: b.unit },
      create: b,
    });
  }

  // 下线「免费版」等级：默认权益改由 EntitlementResolver 内置，不再占用会员等级
  await prisma.membershipLevel.updateMany({
    where: { code: 'free', deletedAt: null },
    data: { deletedAt: new Date(), status: CommonStatus.disabled },
  });

  await prisma.pointRuleConfig.upsert({
    where: { id: 'default' },
    update: {
      registrationPoints: 500,
      monthlyFreePoints: 500,
      dailyPoints: 50,
      freeMonthlyLimit: 2_000,
      searchCostPoints: 1,
      minSearchPoints: 20,
      yuanPerPoint: 0.003,
    },
    create: {
      id: 'default',
      registrationPoints: 500,
      monthlyFreePoints: 500,
      dailyPoints: 50,
      freeMonthlyLimit: 2_000,
      searchCostPoints: 1,
      minSearchPoints: 20,
      yuanPerPoint: 0.003,
    },
  });

  type SeedLevelDef = {
    code: string;
    name: string;
    sort: number;
    monthlyPoints: number;
    description: string;
    monthlyPrice: number;
    scenario: string;
    benefits: Array<{ benefitCode: string; valueJson: object }>;
  };

  const levelDefs: SeedLevelDef[] = [
    {
      code: 'normal',
      name: '普通版',
      sort: 10,
      monthlyPoints: 5_000,
      description: '日常轻度研究 · 单文件问答与单主题分析',
      monthlyPrice: 49,
      scenario: '日常轻度研究',
      benefits: [
        { benefitCode: 'search_quota', valueJson: { n: 100 } },
        { benefitCode: 'export_quota', valueJson: { n: 20 } },
        { benefitCode: 'max_agents', valueJson: { n: 3 } },
        { benefitCode: 'storage_bytes', valueJson: { bytes: 2_147_483_648 } },
      ],
    },
    {
      code: 'plus',
      name: 'Plus',
      sort: 20,
      monthlyPoints: 12_000,
      description: '持续研究 · 多文件联合问答与深度分析',
      monthlyPrice: 99,
      scenario: '持续研究',
      benefits: [
        { benefitCode: 'search_quota', valueJson: { n: 300 } },
        { benefitCode: 'export_quota', valueJson: { n: 50 } },
        { benefitCode: 'max_agents', valueJson: { n: 6 } },
        { benefitCode: 'storage_bytes', valueJson: { bytes: 5_368_709_120 } },
      ],
    },
    {
      code: 'pro',
      name: 'Pro',
      sort: 30,
      monthlyPoints: 26_000,
      description: '高频深度研究 · 批量多主题分析与长篇报告导出',
      monthlyPrice: 199,
      scenario: '高频深度研究',
      benefits: [
        { benefitCode: 'search_quota', valueJson: { n: 500 } },
        { benefitCode: 'export_quota', valueJson: { n: 100 } },
        { benefitCode: 'max_agents', valueJson: { n: 10 } },
        { benefitCode: 'storage_bytes', valueJson: { bytes: 10_737_418_240 } },
      ],
    },
  ];

  const seededLevels: Record<
    string,
    { id: string; monthlyPrice: number; scenario: string }
  > = {};
  for (const def of levelDefs) {
    const level = await upsertByFinder(
      () => prisma.membershipLevel.findFirst({ where: { code: def.code } }),
      (id) =>
        prisma.membershipLevel.update({
          where: { id },
          data: {
            name: def.name,
            scope: MembershipScope.user,
            price: def.monthlyPrice,
            durationDays: 30,
            monthlyPoints: def.monthlyPoints,
            status: CommonStatus.active,
            isPurchasable: true,
            sort: def.sort,
            description: def.description,
            deletedAt: null,
          },
        }),
      () =>
        prisma.membershipLevel.create({
          data: {
            code: def.code,
            name: def.name,
            scope: MembershipScope.user,
            price: def.monthlyPrice,
            durationDays: 30,
            monthlyPoints: def.monthlyPoints,
            status: CommonStatus.active,
            isPurchasable: true,
            sort: def.sort,
            description: def.description,
          },
        }),
    );
    seededLevels[def.code] = {
      id: level.id,
      monthlyPrice: def.monthlyPrice,
      scenario: def.scenario,
    };
    for (const pb of def.benefits) {
      await prisma.levelBenefit.upsert({
        where: {
          levelId_benefitCode: {
            levelId: level.id,
            benefitCode: pb.benefitCode,
          },
        },
        update: { valueJson: pb.valueJson },
        create: {
          levelId: level.id,
          benefitCode: pb.benefitCode,
          valueJson: pb.valueJson,
        },
      });
    }
  }

  const proLevel = { id: seededLevels.pro.id };
  const keepLevelCodes = levelDefs.map((item) => item.code);
  const orphanLevels = await prisma.membershipLevel.findMany({
    where: { code: { notIn: keepLevelCodes }, deletedAt: null },
    select: { id: true },
  });
  if (orphanLevels.length > 0) {
    const orphanIds = orphanLevels.map((l) => l.id);
    await prisma.userSubscription.updateMany({
      where: { levelId: { in: orphanIds }, status: SubscriptionStatus.active },
      data: { status: SubscriptionStatus.cancelled },
    });
    await prisma.membershipLevel.updateMany({
      where: { id: { in: orphanIds } },
      data: { deletedAt: new Date(), status: CommonStatus.disabled },
    });
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const upsertPackage = async (
    levelId: string,
    packageType: PackageType,
    data: {
      name: string;
      price: number;
      originalPrice?: number | null;
      priceLabel: string;
      description: string;
      tag: PackageTag;
      durationDays: number;
      sort: number;
    },
  ) =>
    upsertByFinder(
      () =>
        prisma.membershipPackage.findFirst({
          where: { levelId, packageType },
        }),
      (id) =>
        prisma.membershipPackage.update({
          where: { id },
          data: {
            ...data,
            originalPrice: data.originalPrice ?? null,
            status: CommonStatus.active,
            deletedAt: null,
          },
        }),
      () =>
        prisma.membershipPackage.create({
          data: {
            levelId,
            packageType,
            ...data,
            originalPrice: data.originalPrice ?? null,
          },
        }),
    );

  const packagesByLevel: Record<
    string,
    {
      monthly: { id: string };
      autoRenew: { id: string };
      quarterly: { id: string };
      yearly: { id: string };
    }
  > = {};

  for (const def of levelDefs) {
    const levelMeta = seededLevels[def.code];
    const monthly = def.monthlyPrice;
    const firstMonth = round2(monthly * 0.7);
    const quarterly = round2(monthly * 3 * 0.7);
    const quarterlyOrigin = round2(monthly * 3);
    const yearly = round2(monthly * 12 * 0.6);
    const yearlyOrigin = round2(monthly * 12);

    const monthlyPkg = await upsertPackage(levelMeta.id, PackageType.monthly, {
      name: '单月',
      price: monthly,
      priceLabel: `¥${monthly.toFixed(2)} / 月`,
      description: '单次购买，随用随付',
      tag: PackageTag.on_sale,
      durationDays: 30,
      sort: 1,
    });
    const autoRenewPkg = await upsertPackage(
      levelMeta.id,
      PackageType.auto_renew_monthly,
      {
        name: '连续包月',
        price: firstMonth,
        originalPrice: monthly,
        priceLabel: `¥${firstMonth.toFixed(2)} / 首月`,
        description: `首月优惠，后续按 ¥${monthly.toFixed(2)}/月自动续费，可随时取消`,
        tag: PackageTag.on_sale,
        durationDays: 30,
        sort: 2,
      },
    );
    const quarterlyPkg = await upsertPackage(
      levelMeta.id,
      PackageType.quarterly,
      {
        name: '季付',
        price: quarterly,
        originalPrice: quarterlyOrigin,
        priceLabel: `¥${quarterly.toFixed(2)} / 季`,
        description: `约 ¥${firstMonth.toFixed(2)}/月 · 一次付 3 个月，到期手动续费`,
        tag: PackageTag.on_sale,
        durationDays: 90,
        sort: 3,
      },
    );
    const yearlyPkg = await upsertPackage(levelMeta.id, PackageType.yearly, {
      name: '年付',
      price: yearly,
      originalPrice: yearlyOrigin,
      priceLabel: `¥${yearly.toFixed(2)} / 年`,
      description: `约 ¥${round2(yearly / 12).toFixed(2)}/月 · 一次付 12 个月，到期手动续费`,
      tag: PackageTag.recommended,
      durationDays: 365,
      sort: 4,
    });
    packagesByLevel[def.code] = {
      monthly: monthlyPkg,
      autoRenew: autoRenewPkg,
      quarterly: quarterlyPkg,
      yearly: yearlyPkg,
    };
  }

  const monthlyPkg = packagesByLevel.pro.monthly;
  const autoRenewPkg = packagesByLevel.pro.autoRenew;
  const yearlyPkg = packagesByLevel.pro.yearly;

  const demoUsers = [
    { username: 'li_research', displayName: '李研究' },
    { username: 'chen_data', displayName: '陈数据' },
    { username: 'sun_user', displayName: '孙用户' },
    { username: 'zhao_member', displayName: '赵会员' },
  ];
  const demoUserIds: Record<string, string> = {};
  for (const du of demoUsers) {
    const u = await upsertByFinder(
      () => prisma.user.findFirst({ where: { username: du.username } }),
      (id) =>
        prisma.user.update({
          where: { id },
          data: { status: UserStatus.active, deletedAt: null },
        }),
      async () =>
        prisma.user.create({
          data: {
            username: du.username,
            email: `${du.username}@aird.local`,
            passwordHash: await bcrypt.hash('123456', 10),
            status: UserStatus.active,
            profile: { create: { displayName: du.displayName } },
          },
        }),
    );
    demoUserIds[du.username] = u.id;
  }

  for (const userId of Object.values(demoUserIds)) {
    await prisma.userRole.upsert({
      where: {
        userId_roleId: { userId, roleId: regularUserRoleId },
      },
      update: {},
      create: { userId, roleId: regularUserRoleId },
    });
  }

  const now = new Date();
  const daysFromNow = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return d;
  };

  /** 写入演示订阅前，取消该用户其它 active 订阅，避免与用户列表到期时间不一致 */
  const upsertDemoSubscription = async (
    id: string,
    userId: string,
    data: {
      levelId: string;
      packageId: string;
      status: SubscriptionStatus;
      startAt: Date;
      endAt: Date;
      autoRenew: boolean;
    },
  ) => {
    await prisma.userSubscription.updateMany({
      where: {
        userId,
        status: SubscriptionStatus.active,
        deletedAt: null,
        id: { not: id },
      },
      data: { status: SubscriptionStatus.cancelled },
    });
    return prisma.userSubscription.upsert({
      where: { id },
      update: { userId, ...data },
      create: { id, userId, ...data },
    });
  };

  const liSub = await upsertDemoSubscription(
    'seed-li-sub',
    demoUserIds.li_research,
    {
      levelId: proLevel.id,
      packageId: autoRenewPkg.id,
      status: SubscriptionStatus.active,
      startAt: daysFromNow(-24),
      endAt: daysFromNow(6),
      autoRenew: true,
    },
  );

  await upsertDemoSubscription('seed-zhao-sub', demoUserIds.zhao_member, {
    levelId: proLevel.id,
    packageId: monthlyPkg.id,
    status: SubscriptionStatus.active,
    startAt: daysFromNow(-23),
    endAt: daysFromNow(7),
    autoRenew: false,
  });

  await upsertDemoSubscription('seed-sun-sub', demoUserIds.sun_user, {
    levelId: proLevel.id,
    packageId: yearlyPkg.id,
    status: SubscriptionStatus.active,
    startAt: daysFromNow(-345),
    endAt: daysFromNow(20),
    autoRenew: false,
  });

  const seedOrders = [
    {
      id: 'seed-order-pending',
      orderNo: 'ORD202608100001',
      buyerId: demoUserIds.li_research,
      packageId: monthlyPkg.id,
      title: '会员缴费 · Pro 单月',
      amount: 199,
      status: OrderStatus.pending,
      paymentChannel: null as string | null,
      createdAt: new Date('2026-08-10T02:00:00.000Z'),
    },
    {
      id: 'seed-order-paid',
      orderNo: 'ORD202607150008',
      buyerId: demoUserIds.li_research,
      packageId: autoRenewPkg.id,
      title: '会员缴费 · Pro 连续包月',
      amount: 139.3,
      status: OrderStatus.paid,
      paymentChannel: 'wechat',
      paidAt: new Date('2026-07-15T01:20:00.000Z'),
      createdAt: new Date('2026-07-15T01:20:00.000Z'),
    },
    {
      id: 'seed-order-failed',
      orderNo: 'ORD202606300021',
      buyerId: demoUserIds.chen_data,
      packageId: yearlyPkg.id,
      title: '会员缴费 · Pro 年付',
      amount: 1432.8,
      status: OrderStatus.failed,
      paymentChannel: 'alipay',
      createdAt: new Date('2026-06-30T06:02:00.000Z'),
    },
    {
      id: 'seed-order-refunded',
      orderNo: 'ORD202605200016',
      buyerId: demoUserIds.sun_user,
      packageId: yearlyPkg.id,
      title: '会员缴费 · Pro 年付',
      amount: 1432.8,
      status: OrderStatus.refunded,
      paymentChannel: 'wechat',
      paidAt: new Date('2026-05-20T03:12:00.000Z'),
      refundedAt: new Date('2026-05-21T03:12:00.000Z'),
      createdAt: new Date('2026-05-20T03:12:00.000Z'),
    },
  ];

  for (const o of seedOrders) {
    await prisma.membershipOrder.upsert({
      where: { orderNo: o.orderNo },
      update: {
        buyerType: 'user',
        buyerId: o.buyerId,
        levelId: proLevel.id,
        packageId: o.packageId,
        title: o.title,
        amount: o.amount,
        status: o.status,
        paymentChannel: o.paymentChannel,
        paidAt: o.paidAt ?? null,
        refundedAt: o.refundedAt ?? null,
        deletedAt: null,
      },
      create: {
        id: o.id,
        orderNo: o.orderNo,
        buyerType: 'user',
        buyerId: o.buyerId,
        levelId: proLevel.id,
        packageId: o.packageId,
        title: o.title,
        amount: o.amount,
        status: o.status,
        paymentChannel: o.paymentChannel,
        paidAt: o.paidAt ?? null,
        refundedAt: o.refundedAt ?? null,
        createdAt: o.createdAt,
      },
    });
  }

  await prisma.refundRecord.upsert({
    where: { id: 'seed-refund-1' },
    update: {
      orderId: 'seed-order-refunded',
      amount: 499,
      reason: '用户申请退款',
      tradeNo: 'RF202605210001',
    },
    create: {
      id: 'seed-refund-1',
      orderId: 'seed-order-refunded',
      amount: 499,
      reason: '用户申请退款',
      tradeNo: 'RF202605210001',
      refundedAt: new Date('2026-05-21T03:12:00.000Z'),
    },
  });

  /** 支付渠道与密钥占位（ciphertext 为占位密文，非真实密钥） */
  const seedChannels = [
    {
      id: 'seed-pay-channel-wechat',
      code: 'wechat',
      name: '微信支付',
      merchantId: 'wx_merchant_88231',
      callbackUrl: 'https://research.example.com/pay/callback/wx',
      sort: 10,
      credentialId: 'seed-pay-cred-wechat',
      lastRotatedAt: new Date('2024-06-01T00:00:00.000Z'),
    },
    {
      id: 'seed-pay-channel-alipay',
      code: 'alipay',
      name: '支付宝',
      merchantId: 'ali_merchant_55201',
      callbackUrl: 'https://research.example.com/pay/callback/ali',
      sort: 20,
      credentialId: 'seed-pay-cred-alipay',
      lastRotatedAt: new Date('2024-06-01T00:00:00.000Z'),
    },
  ];

  for (const ch of seedChannels) {
    await prisma.paymentChannel.upsert({
      where: { code: ch.code },
      update: {
        name: ch.name,
        merchantId: ch.merchantId,
        callbackUrl: ch.callbackUrl,
        status: CommonStatus.active,
        sort: ch.sort,
        deletedAt: null,
      },
      create: {
        id: ch.id,
        code: ch.code,
        name: ch.name,
        merchantId: ch.merchantId,
        callbackUrl: ch.callbackUrl,
        status: CommonStatus.active,
        sort: ch.sort,
      },
    });

    const channel = await prisma.paymentChannel.findUniqueOrThrow({
      where: { code: ch.code },
    });

    await prisma.paymentChannelCredential.upsert({
      where: { channelId: channel.id },
      update: {
        ciphertext: `enc:placeholder:${ch.code}:v1`,
        version: 1,
        status: 'configured',
        lastRotatedAt: ch.lastRotatedAt,
        updatedBy: 'seed',
      },
      create: {
        id: ch.credentialId,
        channelId: channel.id,
        ciphertext: `enc:placeholder:${ch.code}:v1`,
        version: 1,
        status: 'configured',
        lastRotatedAt: ch.lastRotatedAt,
        updatedBy: 'seed',
      },
    });
  }

  const liRemindAt = daysFromNow(-1);
  await prisma.renewalReminder.upsert({
    where: {
      subscriptionType_subscriptionId_remindAt_channel: {
        subscriptionType: 'user',
        subscriptionId: liSub.id,
        remindAt: liRemindAt,
        channel: 'inbox',
      },
    },
    update: { sentAt: daysFromNow(-1) },
    create: {
      subscriptionType: 'user',
      subscriptionId: liSub.id,
      remindAt: liRemindAt,
      channel: 'inbox',
      sentAt: daysFromNow(-1),
    },
  });

  // 超级管理员 netsoil / 123456
  const passwordHash = await bcrypt.hash('123456', 10);
  const admin = await upsertByFinder(
    () => prisma.user.findFirst({ where: { username: 'netsoil' } }),
    (id) =>
      prisma.user.update({
        where: { id },
        data: {
          passwordHash,
          status: UserStatus.active,
          email: 'netsoil@aird.local',
          deletedAt: null,
        },
      }),
    () =>
      prisma.user.create({
        data: {
          username: 'netsoil',
          email: 'netsoil@aird.local',
          passwordHash,
          status: UserStatus.active,
          profile: {
            create: {
              displayName: '超级管理员',
              remark: '系统内置超级管理员账号',
            },
          },
        },
      }),
  );

  await prisma.userProfile.upsert({
    where: { userId: admin.id },
    update: { displayName: '超级管理员' },
    create: {
      userId: admin.id,
      displayName: '超级管理员',
      remark: '系统内置超级管理员账号',
    },
  });

  const existingBinding = await prisma.userRole.findFirst({
    where: { userId: admin.id, roleId: platformAdminId },
  });
  if (!existingBinding) {
    await prisma.userRole.create({
      data: { userId: admin.id, roleId: platformAdminId },
    });
  }

  // 今日看板占位（按 Asia/Shanghai 日历日存 Date，避免时区漂移）
  const shanghaiToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const today = new Date(`${shanghaiToday}T00:00:00.000Z`);
  await prisma.dashboardDailyStat.upsert({
    where: { statDate: today },
    update: { userTotal: 1, timezone: 'Asia/Shanghai' },
    create: {
      statDate: today,
      userTotal: 1,
      searchCount: 0,
      dataVolume: BigInt(0),
      agentTaskCount: 0,
      timezone: 'Asia/Shanghai',
      metrics: {
        newUserCount: 0,
        searchSource: 'ResearchRun',
        userSource: 'users',
      },
    },
  });

  /** 内置字典类型 */
  for (const item of SYSTEM_DICT_TYPE_SEEDS) {
    await upsertByFinder(
      () => prisma.dictionaryType.findFirst({ where: { code: item.code } }),
      (id) =>
        prisma.dictionaryType.update({
          where: { id },
          data: {
            name: item.name,
            description: item.description,
            sort: item.sort,
            status: CommonStatus.active,
            isSystem: true,
            deletedAt: null,
          },
        }),
      () =>
        prisma.dictionaryType.create({
          data: {
            code: item.code,
            name: item.name,
            description: item.description,
            sort: item.sort,
            status: CommonStatus.active,
            isSystem: true,
          },
        }),
    );
  }

  /** 来源分类预置项 */
  for (const item of SOURCE_CATEGORY_SEEDS) {
    await upsertByFinder(
      () =>
        prisma.dictionaryItem.findFirst({
          where: {
            type: SYSTEM_DICT_CODES.source_category,
            code: item.code,
          },
        }),
      (id) =>
        prisma.dictionaryItem.update({
          where: { id },
          data: {
            name: item.name,
            sort: item.sort,
            status: CommonStatus.active,
            deletedAt: null,
            description: '来源分类',
          },
        }),
      () =>
        prisma.dictionaryItem.create({
          data: {
            type: SYSTEM_DICT_CODES.source_category,
            code: item.code,
            name: item.name,
            sort: item.sort,
            status: CommonStatus.active,
            description: '来源分类',
          },
        }),
    );
  }

  /** 智能体分类预置项 */
  for (const item of AGENT_CATEGORY_SEEDS) {
    await upsertByFinder(
      () =>
        prisma.dictionaryItem.findFirst({
          where: {
            type: SYSTEM_DICT_CODES.agent_category,
            code: item.code,
          },
        }),
      (id) =>
        prisma.dictionaryItem.update({
          where: { id },
          data: {
            name: item.name,
            sort: item.sort,
            status: CommonStatus.active,
            deletedAt: null,
            description: '智能体分类',
          },
        }),
      () =>
        prisma.dictionaryItem.create({
          data: {
            type: SYSTEM_DICT_CODES.agent_category,
            code: item.code,
            name: item.name,
            sort: item.sort,
            status: CommonStatus.active,
            description: '智能体分类',
          },
        }),
    );
  }

  /** 国家/地区预置（语义解析依赖；可重复 seed） */
  const countrySeeds: Array<{
    code: string;
    name: string;
    aliases: string[];
    sort: number;
  }> = [
    {
      code: 'CN',
      name: '中国',
      aliases: ['中华人民共和国', 'China', 'PRC'],
      sort: 10,
    },
    { code: 'US', name: '美国', aliases: ['USA', 'United States'], sort: 20 },
    { code: 'JP', name: '日本', aliases: ['Japan'], sort: 30 },
    { code: 'IN', name: '印度', aliases: ['India'], sort: 40 },
    { code: 'DE', name: '德国', aliases: ['Germany', 'Deutschland'], sort: 50 },
    { code: 'GB', name: '英国', aliases: ['UK', 'United Kingdom'], sort: 60 },
    { code: 'BR', name: '巴西', aliases: ['Brazil'], sort: 70 },
    { code: 'ZA', name: '南非', aliases: ['South Africa'], sort: 80 },
    { code: 'ASEAN', name: '东盟', aliases: ['东南亚国家联盟'], sort: 90 },
    { code: 'EU', name: '欧盟', aliases: ['European Union'], sort: 100 },
  ];
  for (const item of countrySeeds) {
    await upsertByFinder(
      () =>
        prisma.dictionaryItem.findFirst({
          where: {
            type: SYSTEM_DICT_CODES.country_region,
            code: item.code,
          },
        }),
      (id) =>
        prisma.dictionaryItem.update({
          where: { id },
          data: {
            name: item.name,
            aliases: item.aliases,
            locationKind: LocationKind.country,
            sort: item.sort,
            status: CommonStatus.active,
            deletedAt: null,
            description: '国家/地区',
          },
        }),
      () =>
        prisma.dictionaryItem.create({
          data: {
            type: SYSTEM_DICT_CODES.country_region,
            code: item.code,
            name: item.name,
            aliases: item.aliases,
            locationKind: LocationKind.country,
            sort: item.sort,
            status: CommonStatus.active,
            description: '国家/地区',
          },
        }),
    );
  }

  /** 知识分组预置项 */
  for (const item of KNOWLEDGE_GROUP_SEEDS) {
    await upsertByFinder(
      () =>
        prisma.dictionaryItem.findFirst({
          where: {
            type: SYSTEM_DICT_CODES.knowledge_group,
            code: item.code,
          },
        }),
      (id) =>
        prisma.dictionaryItem.update({
          where: { id },
          data: {
            name: item.name,
            aliases: item.nameEn ? [item.nameEn] : [],
            sort: item.sort,
            status: CommonStatus.active,
            deletedAt: null,
            description: '知识分组',
          },
        }),
      () =>
        prisma.dictionaryItem.create({
          data: {
            type: SYSTEM_DICT_CODES.knowledge_group,
            code: item.code,
            name: item.name,
            aliases: item.nameEn ? [item.nameEn] : [],
            sort: item.sort,
            status: CommonStatus.active,
            description: '知识分组',
          },
        }),
    );
  }

  /** User agreement defaults are preserved after initial setup so admins can edit them. */
  for (const item of LEGAL_DOCUMENT_SEEDS) {
    const defaultValue =
      item.code === 'user_agreement_content'
        ? DEFAULT_USER_AGREEMENT_HTML
        : item.code === 'privacy_policy_content'
          ? DEFAULT_PRIVACY_POLICY_HTML
          : item.defaultValue;
    await upsertByFinder(
      () =>
        prisma.dictionaryItem.findFirst({
          where: {
            type: SYSTEM_DICT_CODES.legal_documents,
            code: item.code,
          },
        }),
      async (id) => {
        const current = await prisma.dictionaryItem.findUniqueOrThrow({
          where: { id },
          select: { name: true },
        });
        const initialContent =
          item.code === 'user_agreement_content'
            ? DEFAULT_USER_AGREEMENT_HTML
            : item.code === 'privacy_policy_content'
              ? DEFAULT_PRIVACY_POLICY_HTML
              : null;
        return prisma.dictionaryItem.update({
          where: { id },
          data: {
            name:
              !current.name || current.name === initialContent
                ? defaultValue
                : current.name,
            sort: item.sort,
            status: CommonStatus.active,
            deletedAt: null,
            description: item.description,
            vectorStatus: 'ready',
          },
        });
      },
      () =>
        prisma.dictionaryItem.create({
          data: {
            type: SYSTEM_DICT_CODES.legal_documents,
            code: item.code,
            name: defaultValue,
            aliases: [],
            description: item.description,
            sort: item.sort,
            status: CommonStatus.active,
            vectorStatus: 'ready',
          },
        }),
    );
  }

  /** 系统内置：用户补充数据知识库（私有免审，搜索上传默认入库） */
  await upsertByFinder(
    () =>
      prisma.knowledgeLibrary.findFirst({
        where: { code: USER_SUPPLEMENT_LIBRARY_CODE },
      }),
    (id) =>
      prisma.knowledgeLibrary.update({
        where: { id },
        data: {
          name: USER_SUPPLEMENT_LIBRARY_NAME,
          type: KnowledgeLibraryType.normal,
          visibility: KnowledgeVisibility.private,
          intro: USER_SUPPLEMENT_LIBRARY_INTRO,
          icon: '📎',
          color: '#e8f5e9',
          status: CommonStatus.active,
          deletedAt: null,
          updatedBy: admin.id,
        },
      }),
    () =>
      prisma.knowledgeLibrary.create({
        data: {
          name: USER_SUPPLEMENT_LIBRARY_NAME,
          code: USER_SUPPLEMENT_LIBRARY_CODE,
          type: KnowledgeLibraryType.normal,
          visibility: KnowledgeVisibility.private,
          intro: USER_SUPPLEMENT_LIBRARY_INTRO,
          icon: '📎',
          color: '#e8f5e9',
          status: CommonStatus.active,
          createdBy: admin.id,
          updatedBy: admin.id,
        },
      }),
  );

  /** 指标分类字典：从现有指标 category 同步，并补齐标准分类 */
  const defaultIndicatorCategories: Array<{
    code: string;
    name: string;
    sort: number;
  }> = [
    { code: 'population', name: '人口', sort: 10 },
    { code: 'macro_economy', name: '宏观经济', sort: 20 },
    { code: 'finance', name: '金融', sort: 30 },
    { code: 'trade', name: '贸易', sort: 40 },
    { code: 'balance_of_payments', name: '国际收支', sort: 50 },
    { code: 'foreign_trade', name: '对外贸易', sort: 60 },
    { code: 'industry_data', name: '行业数据', sort: 70 },
    { code: 'energy', name: '能源', sort: 80 },
  ];
  const usedCategories = await prisma.indicator.findMany({
    where: { deletedAt: null },
    select: { category: true },
    distinct: ['category'],
  });
  const categoryNameToCode = new Map(
    defaultIndicatorCategories.map((item) => [item.name, item.code]),
  );
  const slugify = (name: string) => {
    const mapped = categoryNameToCode.get(name);
    if (mapped) return mapped;
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^\w\u4e00-\u9fa5]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 64);
    return slug || `cat_${Date.now()}`;
  };

  const categoryNames = new Set<string>([
    ...defaultIndicatorCategories.map((item) => item.name),
    ...usedCategories.map((item) => item.category).filter(Boolean),
  ]);
  let categorySort = 90;
  for (const name of categoryNames) {
    const preset = defaultIndicatorCategories.find(
      (item) => item.name === name,
    );
    const code = preset?.code ?? slugify(name);
    const sort = preset?.sort ?? categorySort;
    categorySort += 10;
    await upsertByFinder(
      () =>
        prisma.dictionaryItem.findFirst({
          where: {
            type: SYSTEM_DICT_CODES.indicator_category,
            code,
          },
        }),
      (id) =>
        prisma.dictionaryItem.update({
          where: { id },
          data: {
            name,
            sort,
            status: CommonStatus.active,
            deletedAt: null,
            description: '标准指标分类',
          },
        }),
      () =>
        prisma.dictionaryItem.create({
          data: {
            type: SYSTEM_DICT_CODES.indicator_category,
            code,
            name,
            sort,
            status: CommonStatus.active,
            description: '标准指标分类',
          },
        }),
    );
  }

  /** 标准指标库（可重复 seed） */
  const indicatorSeeds: Array<{
    code: string;
    name: string;
    definition: string;
    unit: string;
    category: string;
    source: string;
  }> = [
    {
      code: 'world_population',
      name: '世界人口总数',
      definition: '全球常住人口总量，通常按年中估算',
      unit: '人',
      category: '人口',
      source: '联合国人口司 (UN DESA)',
    },
    {
      code: 'crude_birth_rate',
      name: '出生率',
      definition: '每千人中的活产数',
      unit: '‰',
      category: '人口',
      source: '世界银行 WDI',
    },
    {
      code: 'tfr',
      name: '总和生育率',
      definition: '一名妇女在育龄期内平均生育子女数',
      unit: '人',
      category: '人口',
      source: '联合国人口展望',
    },
    {
      code: 'pop_natural_growth',
      name: '人口自然增长率',
      definition: '出生率减去死亡率，反映人口自然变动',
      unit: '‰',
      category: '人口',
      source: '世界银行 WDI',
    },
    {
      code: 'crude_death_rate',
      name: '死亡率',
      definition: '每千人中的死亡数',
      unit: '‰',
      category: '人口',
      source: '世界银行 WDI',
    },
    {
      code: 'urbanization_rate',
      name: '城镇化率',
      definition: '城镇人口占总人口比重',
      unit: '%',
      category: '人口',
      source: '联合国人居署',
    },
    {
      code: 'life_expectancy',
      name: '预期寿命',
      definition: '出生时预期寿命',
      unit: '岁',
      category: '人口',
      source: 'WHO / UN DESA',
    },
    {
      code: 'working_age_share',
      name: '劳动年龄人口占比',
      definition: '15-64岁人口占总人口比重',
      unit: '%',
      category: '人口',
      source: '世界银行 WDI',
    },
    {
      code: 'gdp_current_usd',
      name: '国内生产总值(现价美元)',
      definition: '按现价美元计的国内生产总值',
      unit: '万亿美元',
      category: '宏观经济',
      source: '世界银行 WDI',
    },
    {
      code: 'gdp_real_growth',
      name: 'GDP实际增速',
      definition: '不变价GDP同比增速',
      unit: '%',
      category: '宏观经济',
      source: 'IMF WEO',
    },
    {
      code: 'gdp_per_capita',
      name: '人均GDP',
      definition: 'GDP除以年中人口',
      unit: '美元/人',
      category: '宏观经济',
      source: '世界银行 WDI',
    },
    {
      code: 'cpi_inflation',
      name: '通货膨胀率(CPI)',
      definition: '居民消费价格指数同比涨幅',
      unit: '%',
      category: '宏观经济',
      source: 'IMF / 各国统计局',
    },
    {
      code: 'goods_exports',
      name: '货物出口额',
      definition: '按现价美元计的货物出口总额',
      unit: '万亿美元',
      category: '贸易',
      source: 'WTO / UN Comtrade',
    },
    {
      code: 'goods_imports',
      name: '货物进口额',
      definition: '按现价美元计的货物进口总额',
      unit: '万亿美元',
      category: '贸易',
      source: 'WTO / UN Comtrade',
    },
    {
      code: 'cab_gdp',
      name: '经常账户余额占GDP比重',
      definition: '经常账户差额占GDP百分比',
      unit: '%',
      category: '国际收支',
      source: 'IMF BOP',
    },
    {
      code: 'fx_reserves',
      name: '外汇储备',
      definition: '官方外汇储备（不含黄金或含黄金视口径）',
      unit: '万亿美元',
      category: '金融',
      source: 'IMF IFS',
    },
    {
      code: 'm2_growth',
      name: '广义货币增速',
      definition: '广义货币供应量同比增速',
      unit: '%',
      category: '金融',
      source: '各国央行 / IMF',
    },
  ];
  for (const item of indicatorSeeds) {
    await upsertByFinder(
      () => prisma.indicator.findFirst({ where: { code: item.code } }),
      (id) =>
        prisma.indicator.update({
          where: { id },
          data: {
            name: item.name,
            definition: item.definition,
            unit: item.unit,
            category: item.category,
            source: item.source,
            status: CommonStatus.active,
            deletedAt: null,
          },
        }),
      () =>
        prisma.indicator.create({
          data: {
            ...item,
            status: CommonStatus.active,
          },
        }),
    );
  }

  /** 指标常用别名（语义解析命中） */
  const indicatorAliasSeeds: Array<{ indicatorCode: string; alias: string }> = [
    { indicatorCode: 'gdp_per_capita', alias: '人均国内生产总值' },
    { indicatorCode: 'gdp_per_capita', alias: 'GDP per capita' },
    { indicatorCode: 'gdp_per_capita', alias: '人均国内生产总值(现价美元)' },
    { indicatorCode: 'gdp_current_usd', alias: 'GDP' },
    { indicatorCode: 'gdp_current_usd', alias: '国内生产总值' },
  ];
  for (const item of indicatorAliasSeeds) {
    const indicator = await prisma.indicator.findFirst({
      where: { code: item.indicatorCode, deletedAt: null },
    });
    if (!indicator) continue;
    const existing = await prisma.indicatorAlias.findFirst({
      where: { indicatorId: indicator.id, alias: item.alias },
    });
    if (!existing) {
      await prisma.indicatorAlias.create({
        data: { indicatorId: indicator.id, alias: item.alias },
      });
    }
  }

  /** 运营管理演示：公告 / 业务通知 / 敏感词 */
  const announcementSeeds: Array<{
    title: string;
    content: string;
    audienceScope: AnnouncementAudienceScope;
    status: AnnouncementStatus;
    publishedAt?: Date;
    recalledAt?: Date;
  }> = [
    {
      title: '平台功能更新通知（2026-08）',
      content: '本期上线运营看板与知识库索引增强，欢迎体验并反馈问题。',
      audienceScope: AnnouncementAudienceScope.all_users,
      status: AnnouncementStatus.published,
      publishedAt: daysFromNow(-20),
    },
    {
      title: '数据库维护公告',
      content: '计划于周末凌晨进行例行维护，预计 30 分钟服务不可用。',
      audienceScope: AnnouncementAudienceScope.all_users,
      status: AnnouncementStatus.recalled,
      publishedAt: daysFromNow(-15),
      recalledAt: daysFromNow(-14),
    },
    {
      title: '会员续费优惠说明',
      content: '专业版年付套餐限时优惠，详情见支付中心。',
      audienceScope: AnnouncementAudienceScope.pro_members,
      status: AnnouncementStatus.draft,
    },
  ];
  const existingAnnouncements = await prisma.announcement.count();
  if (existingAnnouncements === 0) {
    for (const item of announcementSeeds) {
      await prisma.announcement.create({
        data: {
          title: item.title,
          content: item.content,
          audienceScope: item.audienceScope,
          status: item.status,
          publishedAt: item.publishedAt ?? null,
          recalledAt: item.recalledAt ?? null,
          createdBy: admin.id,
        },
      });
    }
  }

  const existingNotifications = await prisma.businessNotification.count();
  if (existingNotifications === 0) {
    const receiverA = demoUserIds.li_research ?? admin.id;
    const receiverB = demoUserIds.zhao_member ?? admin.id;
    await prisma.businessNotification.createMany({
      data: [
        {
          content:
            '《中美GDP增长率对比分析报告》已生成，可在历史记录与成果中查看。',
          receiverId: receiverA,
          status: BusinessNotificationStatus.unread,
          bizType: 'report_ready',
          sentAt: daysFromNow(0),
        },
        {
          content: '生产经营数据已通过审核并入库。',
          receiverId: receiverA,
          status: BusinessNotificationStatus.read,
          bizType: 'import',
          sentAt: daysFromNow(-1),
        },
        {
          content: '专业版会员将于 2027-08-10 到期，请及时续费。',
          receiverId: receiverB,
          status: BusinessNotificationStatus.unread,
          bizType: 'renewal',
          sentAt: daysFromNow(-2),
        },
        {
          content: '知识库已完成索引更新（+328 条），检索更准确。',
          receiverId: receiverA,
          status: BusinessNotificationStatus.unread,
          bizType: 'knowledge_index',
          sentAt: daysFromNow(-3),
        },
        {
          content: '订单 ORDDEMO001 已支付成功，金额 ¥49.00（微信支付）。',
          receiverId: receiverB,
          status: BusinessNotificationStatus.unread,
          bizType: 'payment_success',
          sentAt: daysFromNow(-4),
        },
        {
          content: '专业版会员已开通，有效期至 2026-10-04。',
          receiverId: receiverB,
          status: BusinessNotificationStatus.unread,
          bizType: 'membership_activated',
          sentAt: daysFromNow(-4),
        },
        {
          content: '订单 ORDDEMO002 已退款 ¥59.00，原因：用户申请退款。',
          receiverId: receiverA,
          status: BusinessNotificationStatus.read,
          bizType: 'refund',
          sentAt: daysFromNow(-5),
        },
        {
          content: '文件「行业景气度月报.pdf」学习完成，已可检索。',
          receiverId: receiverA,
          status: BusinessNotificationStatus.unread,
          bizType: 'file_learned',
          sentAt: daysFromNow(-6),
        },
      ],
    });
  }

  const sensitiveSeeds: Array<{
    word: string;
    category: SensitiveWordCategory;
    hitCount: number;
    status: CommonStatus;
  }> = [
    {
      word: '词A',
      category: SensitiveWordCategory.political,
      hitCount: 3,
      status: CommonStatus.active,
    },
    {
      word: '词B',
      category: SensitiveWordCategory.porn,
      hitCount: 0,
      status: CommonStatus.disabled,
    },
    {
      word: '词C',
      category: SensitiveWordCategory.ad,
      hitCount: 1,
      status: CommonStatus.active,
    },
  ];
  for (const item of sensitiveSeeds) {
    await upsertByFinder(
      () => prisma.sensitiveWord.findFirst({ where: { word: item.word } }),
      (id) =>
        prisma.sensitiveWord.update({
          where: { id },
          data: {
            category: item.category,
            hitCount: item.hitCount,
            status: item.status,
            deletedAt: null,
          },
        }),
      () => prisma.sensitiveWord.create({ data: item }),
    );
  }

  console.log('Seed completed. Super admin: netsoil / 123456');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
