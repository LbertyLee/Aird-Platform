import type {
  DashboardAggregateResult,
  DashboardTrends,
  PlatformOverview,
} from '@agent/contracts';
import { http } from './http';

export type SearchModelItem = {
  id: string;
  value: string;
  label: string;
  status: 'active' | 'disabled';
  sort: number;
};
export const fetchSearchModels = async () =>
  (await http.get<SearchModelItem[]>('/admin/search-models')).data;
export const createSearchModel = async (payload: {
  value: string;
  label: string;
  sort?: number;
}) => (await http.post<SearchModelItem>('/admin/search-models', payload)).data;
export const updateSearchModel = async (
  id: string,
  payload: Partial<Omit<SearchModelItem, 'id'>>,
) =>
  (await http.put<SearchModelItem>(`/admin/search-models/${id}`, payload)).data;
export const deleteSearchModel = async (id: string) => {
  await http.delete(`/admin/search-models/${id}`);
};

export type AgentItem = {
  id: string;
  name: string;
  description: string;
  categoryCode: string;
  categoryName: string;
  author: string;
  icon?: string | null;
  iconColor?: string | null;
  usageCount: number;
  status: 'active' | 'disabled';
  sort?: number;
  isPersonal: boolean;
  owner?: {
    id: string;
    username: string;
    displayName: string | null;
  } | null;
};
export type AgentPayload = {
  name: string;
  description: string;
  categoryCode: string;
  icon?: string;
  iconColor?: string;
  status?: 'active' | 'disabled';
  sort?: number;
};
export type AgentCategoryOption = {
  code: string;
  name: string;
  sort: number;
};
export const fetchAgents = async (q?: string) =>
  (await http.get<AgentItem[]>('/admin/agents', { params: { q } })).data;
export const fetchAgentCategories = async () =>
  (await http.get<AgentCategoryOption[]>('/agents/categories')).data;
export const createAgent = async (payload: AgentPayload) =>
  (await http.post<AgentItem>('/admin/agents', payload)).data;
export const updateAgent = async (id: string, payload: Partial<AgentPayload>) =>
  (await http.put<AgentItem>(`/admin/agents/${id}`, payload)).data;
export const deleteAgent = async (id: string) => {
  await http.delete(`/admin/agents/${id}`);
};

/** 通用分页结果 */
export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type StructuredDataRecord = {
  id: string;
  namespace: 'sources' | 'remote' | 'extractions';
  fingerprint: string;
  checksum: string;
  createdAt: string;
  updatedAt: string;
};
export type StructuredDataRecordDetail = StructuredDataRecord & {
  data: unknown;
};
export async function fetchStructuredData(params: {
  page?: number;
  pageSize?: number;
  namespace?: string;
  keyword?: string;
}) {
  return (
    await http.get<PageResult<StructuredDataRecord>>('/admin/structured-data', {
      params,
    })
  ).data;
}
export async function fetchStructuredDataDetail(id: string) {
  return (
    await http.get<StructuredDataRecordDetail>(`/admin/structured-data/${id}`)
  ).data;
}

export type StructuredObservation = {
  id: string;
  namespace: 'sources' | 'remote' | 'extractions';
  indicatorEnglish: string | null;
  indicatorChinese: string | null;
  sourceOrganization: string | null;
  sourceProject: string | null;
  region: string | null;
  regionType: string | null;
  parentRegion: string | null;
  startTime: number | null;
  endTime: number | null;
  timeIndicatorType: string | null;
  dataValue: unknown;
  unit: string | null;
  sourceUrl: string | null;
  publishedAt: string | null;
  indicatorExplanation: string | null;
  inputBy: string | null;
  inputAt: string | null;
  isPublic: boolean | null;
  dataOwner: string | null;
  lastModifiedBy: string | null;
  lastModifiedAt: string | null;
  annotations: unknown;
  createdAt: string;
};
export type StructuredObservationDetail = StructuredObservation & {
  rawData: unknown;
};
export async function fetchStructuredObservations(params: {
  page?: number;
  pageSize?: number;
  namespace?: string;
  keyword?: string;
}) {
  return (
    await http.get<PageResult<StructuredObservation>>(
      '/admin/structured-data/observations',
      { params },
    )
  ).data;
}
export async function fetchStructuredObservationDetail(id: string) {
  return (
    await http.get<StructuredObservationDetail>(
      `/admin/structured-data/observations/${id}`,
    )
  ).data;
}

export type UserItem = {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
  status: string;
  displayName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  roles?: Array<{ id: string; code: string; name: string }>;
  membership?: {
    subscriptionId: string;
    levelId: string;
    levelCode: string;
    levelName: string;
    endAt: string;
  } | null;
};

export type LevelItem = {
  id: string;
  code: string;
  name: string;
  scope: string;
  price: string | number;
  durationDays: number;
  monthlyPoints?: number;
  status: string;
  description?: string | null;
  benefits?: Array<{ benefitCode: string; valueJson: Record<string, unknown> }>;
};

export type PackageItem = {
  id: string;
  levelId: string;
  packageType: string;
  name: string;
  price: string | number;
  originalPrice?: string | number | null;
  priceLabel?: string | null;
  description?: string | null;
  tag: string;
  durationDays: number;
  level?: { id: string; code: string; name: string };
};

export type OrderItem = {
  id: string;
  orderNo: string;
  buyerType: string;
  buyerId: string;
  buyerUsername?: string;
  buyerDisplayName?: string | null;
  amount: string | number;
  status: string;
  paidAt: string | null;
  createdAt?: string;
  levelTitle?: string;
  title?: string | null;
  paymentChannel?: string | null;
  channel?: string | null;
  level?: { name: string; code: string };
  package?: { name: string; packageType: string };
  refunds?: Array<{
    id: string;
    amount: string | number;
    reason?: string | null;
    tradeNo?: string | null;
    refundedAt: string;
  }>;
};

export type MembershipOverview = {
  level: {
    id: string;
    code: string;
    name: string;
    status: string;
    isPurchasable: boolean;
  } | null;
  enabled: boolean;
  purchasable: boolean;
};

export type PointAccountItem = {
  userId: string;
  username: string;
  displayName: string | null;
  levelName: string;
  levelCode: string;
  freeGrantedThisMonth: number;
  freeMonthlyLimit: number;
  membershipMonthlyPoints: number | null;
  monthlyLimit: number;
  monthlyUsed: number;
  lastConsumedAt: string | null;
  balance: number;
  status: string;
};
export type PointLedgerItem = {
  id: string;
  amount: number;
  balanceAfter: number;
  source: string;
  description: string;
  createdAt: string;
};
export type PointRules = {
  registrationPoints: number;
  monthlyFreePoints: number;
  dailyPoints: number;
  freeMonthlyLimit: number;
  minSearchPoints: number;
  yuanPerPoint: number;
  modelPricing: Array<{
    model: string;
    inputYuanPerMillionTokens: number;
    outputYuanPerMillionTokens: number;
  }>;
  levels: Array<{
    id: string;
    code: string;
    name: string;
    monthlyPoints: number;
    status: string;
  }>;
};

export type RenewalCandidate = {
  subscriptionId: string;
  userId: string;
  username: string;
  levelName: string;
  endAt: string;
  daysLeft: number;
  inWindow: boolean;
  remindStatus: string;
  action: string;
  desc: string;
  reminded: boolean;
};

export type RoleOverviewItem = {
  id: string;
  code: string;
  name: string;
  description: string;
  status: string;
  userCount: number;
  tags: string[];
  tagColor: 'primary' | 'info';
  builtin: boolean;
};

export type PermissionMatrixRow = {
  key: string;
  module: string;
  virtual: boolean;
  platform_admin: boolean;
  regular_user: boolean;
};

export type RoleMemberItem = {
  id: string;
  username: string;
  displayName: string | null;
  status: string;
};

export type RoleItem = {
  id: string;
  code: string;
  name: string;
  type: string;
  status?: string;
  description: string | null;
  createdAt?: string;
  dataScope?: { scopeType: string; customDeptIds?: string[] | null } | null;
  _count?: { userRoles?: number; rolePermissions?: number };
};

/** 运营看板查询参数 */
export type DashboardRangeParams = {
  startDate?: string;
  endDate?: string;
  timezone?: string;
};

/** 运营看板总览（支持时间范围 / 时区） */
export async function fetchOverview(params: DashboardRangeParams = {}) {
  const { data } = await http.get<PlatformOverview>(
    '/admin/dashboard/overview',
    {
      params,
    },
  );
  return data;
}

/** 运营看板日趋势 */
export async function fetchDashboardTrends(params: DashboardRangeParams = {}) {
  const { data } = await http.get<DashboardTrends>('/admin/dashboard/trends', {
    params,
  });
  return data;
}

/** 刷新日聚合快照 */
export async function refreshDashboardAggregate(
  params: DashboardRangeParams = {},
) {
  const { data } = await http.post<DashboardAggregateResult>(
    '/admin/dashboard/aggregate',
    params,
  );
  return data;
}

/** 用户分页 */
export async function fetchUserRoleOptions() {
  const { data } = await http.get<
    Array<Pick<RoleItem, 'id' | 'code' | 'name'>>
  >('/admin/users/role-options');
  return data;
}

/** 用户分页 */
export async function fetchUsers(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  roleId?: string;
}) {
  const { data } = await http.get<PageResult<UserItem>>('/admin/users', {
    params,
  });
  return data;
}

/** 创建用户 */
export async function createUser(payload: Record<string, unknown>) {
  const { data } = await http.post('/admin/users', payload);
  return data;
}

/** 更新用户 */
export async function updateUser(id: string, payload: Record<string, unknown>) {
  const { data } = await http.put(`/admin/users/${id}`, payload);
  return data;
}

/** 禁用/启用用户 */
export async function setUserStatus(id: string, enable: boolean) {
  await http.patch(`/admin/users/${id}/${enable ? 'enable' : 'disable'}`);
}

/** 重置密码 */
export async function resetUserPassword(id: string) {
  const { data } = await http.post<{ tempPassword: string }>(
    `/admin/users/${id}/reset-password`,
  );
  return data;
}

/** 删除用户（走批量删除接口，避免部分环境 DELETE 路由未生效） */
export async function deleteUser(id: string) {
  return batchDeleteUsers([id]);
}

/** 批量删除用户 */
export async function batchDeleteUsers(ids: string[]) {
  const { data } = await http.post<{ ok: boolean; deleted: number }>(
    '/admin/users/batch-delete',
    { ids },
  );
  return data;
}

/** 导出用户 CSV（按当前筛选；可传 ids 仅导出勾选） */
export async function exportUsers(params?: {
  keyword?: string;
  status?: string;
  roleId?: string;
  ids?: string[];
}) {
  const response = await http.get<Blob>('/admin/users/export', {
    params: {
      roleId: params?.roleId || undefined,
      keyword: params?.keyword || undefined,
      status: params?.status || undefined,
      ids: params?.ids?.length ? params.ids.join(',') : undefined,
    },
    responseType: 'blob',
  });
  const blob = response.data;
  // 鉴权/业务失败时后端返回 JSON，需识别避免下载错误文件
  if (blob.type.includes('application/json')) {
    const text = await blob.text();
    let msg = '导出失败';
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      msg = Array.isArray(parsed.message)
        ? parsed.message.join('; ')
        : parsed.message || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 会员管理总览 */
export async function fetchMembershipOverview() {
  const { data } = await http.get<MembershipOverview>(
    '/admin/membership/overview',
  );
  return data;
}
export async function fetchPointAccounts(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  return (
    await http.get<PageResult<PointAccountItem>>(
      '/admin/membership/points/accounts',
      { params },
    )
  ).data;
}
export async function fetchPointLedgers(userId: string) {
  return (
    await http.get<PointLedgerItem[]>(
      `/admin/membership/points/accounts/${userId}/ledgers`,
    )
  ).data;
}
export async function fetchPointRules() {
  return (await http.get<PointRules>('/admin/membership/points/rules')).data;
}
export async function updatePointRules(payload: {
  registrationPoints: number;
  monthlyFreePoints: number;
  dailyPoints: number;
  freeMonthlyLimit: number;
  minSearchPoints: number;
  yuanPerPoint: number;
  modelPricing: Array<{
    model: string;
    inputYuanPerMillionTokens: number;
    outputYuanPerMillionTokens: number;
  }>;
  levelMonthlyPoints?: Array<{ levelId: string; monthlyPoints: number }>;
}) {
  return (await http.put<PointRules>('/admin/membership/points/rules', payload))
    .data;
}

/** 会员套餐 */
export async function fetchPackages(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  const { data } = await http.get<PageResult<PackageItem>>(
    '/admin/membership/packages',
    { params },
  );
  return data;
}
export async function createPackage(payload: Record<string, unknown>) {
  const { data } = await http.post('/admin/membership/packages', payload);
  return data;
}
export async function updatePackage(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put(`/admin/membership/packages/${id}`, payload);
  return data;
}
export async function offShelfPackage(id: string) {
  const { data } = await http.patch(
    `/admin/membership/packages/${id}/off-shelf`,
  );
  return data;
}
export async function onShelfPackage(id: string) {
  const { data } = await http.patch(
    `/admin/membership/packages/${id}/on-shelf`,
  );
  return data;
}

/** 会员等级 */
export async function fetchLevels(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  const { data } = await http.get<PageResult<LevelItem>>(
    '/admin/membership/levels',
    { params },
  );
  return data;
}
export async function createLevel(payload: Record<string, unknown>) {
  const { data } = await http.post('/admin/membership/levels', payload);
  return data;
}
export async function updateLevel(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put(`/admin/membership/levels/${id}`, payload);
  return data;
}
export async function disableLevel(id: string) {
  await http.patch(`/admin/membership/levels/${id}/disable`);
}
export async function bindLevelBenefits(
  id: string,
  items: Array<{ benefitCode: string; valueJson: Record<string, unknown> }>,
) {
  const { data } = await http.put(`/admin/membership/levels/${id}/benefits`, {
    items,
  });
  return data;
}
export async function fetchBenefitDefs() {
  const { data } = await http.get('/admin/membership/benefits');
  return data as Array<{
    code: string;
    name: string;
    valueType: string;
    unit: string | null;
  }>;
}

/** 订单 / 支付 / 发票 / 续费 */
export async function fetchOrders(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  paymentChannel?: string;
}) {
  const { data } = await http.get<PageResult<OrderItem>>(
    '/admin/membership/orders',
    { params },
  );
  return data;
}
export async function createOrder(payload: Record<string, unknown>) {
  const { data } = await http.post('/admin/membership/orders', payload);
  return data;
}
export async function cancelOrder(id: string) {
  await http.patch(`/admin/membership/orders/${id}/cancel`);
}
export async function refundOrder(id: string, reason?: string) {
  const { data } = await http.post(`/admin/membership/orders/${id}/refund`, {
    reason,
  });
  return data;
}
export async function reconcileOrder(id: string) {
  const { data } = await http.post(`/admin/membership/orders/${id}/reconcile`);
  return data;
}
export async function fetchOrderDetail(id: string) {
  const { data } = await http.get<OrderItem>(`/admin/membership/orders/${id}`);
  return data;
}
export async function fetchOrderRefunds(id: string) {
  const { data } = await http.get<
    Array<{
      id: string;
      amount: string | number;
      reason?: string | null;
      tradeNo?: string | null;
      refundedAt: string;
    }>
  >(`/admin/membership/orders/${id}/refunds`);
  return data;
}
export async function mockPay(orderNo: string) {
  const { data } = await http.post('/admin/membership/payments/callback', {
    orderNo,
  });
  return data;
}
export async function fetchPayments(params?: {
  page?: number;
  pageSize?: number;
}) {
  const { data } = await http.get('/admin/membership/payments', { params });
  return data as PageResult<Record<string, unknown>>;
}
export async function fetchInvoices(params?: {
  page?: number;
  pageSize?: number;
}) {
  const { data } = await http.get('/admin/membership/invoices', { params });
  return data as PageResult<Record<string, unknown>>;
}
export async function applyInvoice(payload: {
  orderId: string;
  title: string;
  taxNo?: string;
}) {
  const { data } = await http.post('/admin/membership/invoices', payload);
  return data;
}
export async function issueInvoice(id: string) {
  await http.patch(`/admin/membership/invoices/${id}/issue`);
}
export async function fetchReminders(params?: {
  page?: number;
  pageSize?: number;
}) {
  const { data } = await http.get('/admin/membership/reminders', { params });
  return data as PageResult<Record<string, unknown>>;
}
export async function fetchRenewalCandidates() {
  const { data } = await http.get<RenewalCandidate[]>(
    '/admin/membership/reminders/candidates',
  );
  return data;
}
export async function sendRenewalReminder(subscriptionId: string) {
  const { data } = await http.post(
    `/admin/membership/reminders/${subscriptionId}/send`,
  );
  return data;
}
export async function batchSendReminders() {
  const { data } = await http.post<{ sent: number }>(
    '/admin/membership/reminders/batch-send',
  );
  return data;
}
export async function scheduleReminders() {
  const { data } = await http.post('/admin/membership/reminders/schedule');
  return data as { created: number };
}

/** 角色权限 */
export async function fetchRbacOverview() {
  const { data } = await http.get<{
    roles: RoleOverviewItem[];
    matrix: PermissionMatrixRow[];
  }>('/admin/rbac/overview');
  return data;
}
export async function savePermissionMatrix(rows: PermissionMatrixRow[]) {
  const { data } = await http.put<{
    roles: RoleOverviewItem[];
    matrix: PermissionMatrixRow[];
  }>('/admin/rbac/permission-matrix', {
    rows: rows.map((row) => ({
      key: row.key,
      platform_admin: row.platform_admin,
      regular_user: row.regular_user,
    })),
  });
  return data;
}
export async function resetPermissionMatrix() {
  const { data } = await http.post<{
    roles: RoleOverviewItem[];
    matrix: PermissionMatrixRow[];
  }>('/admin/rbac/permission-matrix/reset');
  return data;
}
export async function fetchRoleMembers(roleId: string) {
  const { data } = await http.get<RoleMemberItem[]>(
    `/admin/roles/${roleId}/members`,
  );
  return data;
}
export async function fetchRoles(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  const { data } = await http.get<PageResult<RoleItem>>('/admin/roles', {
    params,
  });
  return data;
}
export async function fetchRoleDetail(id: string) {
  const { data } = await http.get(`/admin/roles/${id}`);
  return data as RoleItem & {
    permissionIds: string[];
    permissions: Array<{
      id: string;
      code: string;
      name: string;
      type: string;
    }>;
  };
}
export async function createRole(payload: Record<string, unknown>) {
  const { data } = await http.post('/admin/roles', payload);
  return data;
}
export async function updateRole(id: string, payload: Record<string, unknown>) {
  const { data } = await http.put(`/admin/roles/${id}`, payload);
  return data;
}

/** 删除角色 */
export async function deleteRole(id: string) {
  const { data } = await http.delete<{ ok: boolean; deleted: number }>(
    `/admin/roles/${id}`,
  );
  return data;
}

/** 批量删除角色 */
export async function batchDeleteRoles(ids: string[]) {
  const { data } = await http.post<{
    ok: boolean;
    deleted: number;
  }>('/admin/roles/batch-delete', { ids });
  return data;
}

export async function replaceRolePermissions(
  id: string,
  permissionIds: string[],
) {
  await http.put(`/admin/roles/${id}/permissions`, { permissionIds });
}
export async function setRoleDataScope(
  id: string,
  payload: { scopeType: string; customDeptIds?: string[] },
) {
  await http.put(`/admin/roles/${id}/data-scope`, payload);
}
export async function updateRoleStatus(
  id: string,
  status: 'active' | 'disabled',
) {
  const { data } = await http.patch(`/admin/roles/${id}/status`, { status });
  return data;
}

export async function fetchPermissionTree() {
  const { data } = await http.get('/admin/permissions/tree');
  return data as Array<{
    id: string;
    code: string;
    name: string;
    type: string;
    children?: Array<{
      id: string;
      code: string;
      name: string;
      type: string;
      children?: unknown[];
    }>;
  }>;
}
export async function assignUserRoles(
  userId: string,
  bindings: Array<{ roleId: string }>,
) {
  await http.put(`/admin/users/${userId}/roles`, { bindings });
}

/** 查询用户已分配角色 */
export async function fetchUserRoles(userId: string) {
  const { data } = await http.get(`/admin/users/${userId}/roles`);
  return data as Array<{
    id: string;
    roleId: string;
    role: { id: string; code: string; name: string; type: string };
  }>;
}

/** 查询用户个人会员订阅 */
export async function fetchUserSubscription(userId: string) {
  const { data } = await http.get(
    `/admin/membership/subscriptions/user/${userId}`,
  );
  return data as {
    active: {
      id: string;
      levelId: string;
      status: string;
      startAt: string;
      endAt: string;
      level: { id: string; code: string; name: string };
    } | null;
    items: Array<{
      id: string;
      levelId: string;
      status: string;
      startAt: string;
      endAt: string;
      level: { id: string; code: string; name: string };
    }>;
  };
}

/** 可分配会员等级 */
export async function fetchAssignableLevels() {
  try {
    const { data } = await http.get<
      Array<{
        id: string;
        code: string;
        name: string;
        durationDays: number;
        packages?: Array<{ id: string; name: string; durationDays: number }>;
      }>
    >('/admin/membership/levels/assignable');
    return data;
  } catch {
    const page = await fetchLevels({ page: 1, pageSize: 100 });
    return (page.items ?? [])
      .filter((l) => l.status === 'active' && l.code === 'pro')
      .map((l) => ({
        id: l.id,
        code: l.code,
        name: l.name,
        durationDays: l.durationDays,
        packages: [],
      }));
  }
}

/** 管理员直赋用户会员等级 */
export async function grantUserMembership(payload: {
  userId: string;
  levelId: string;
  packageId?: string;
  durationDays?: number;
}) {
  const { data } = await http.post(
    '/admin/membership/subscriptions/user',
    payload,
  );
  return data;
}

// =========================
// 数据资源：指标 / 字典 / 数据集
// =========================

export type IndicatorSourceMappingItem = {
  id: string;
  indicatorId: string;
  dataSource: string;
  sourceField: string;
  transform: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type IndicatorItem = {
  id: string;
  name: string;
  code: string;
  definition: string;
  unit: string;
  category: string;
  source: string;
  status: string;
  mappingCount: number;
  sourceMappings?: IndicatorSourceMappingItem[];
  updatedAt: string;
};

export type DictionaryItem = {
  id: string;
  type: string;
  locationKind?: 'country' | 'region' | null;
  code: string;
  name: string;
  aliases: string[];
  description?: string | null;
  sort: number;
  status: string;
  vectorStatus: string;
  vectorError?: string | null;
  updatedAt: string;
  score?: number;
};

export type DictionaryTypeItem = {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  sort: number;
  status: string;
  isSystem: boolean;
  updatedAt: string;
};

export type DatasetItem = {
  id: string;
  name: string;
  nameEn?: string | null;
  code: string;
  categoryCode?: string | null;
  regionLevel?: string | null;
  websiteUrl?: string | null;
  externalSearchEligible: boolean;
  externalSearchIneligibleReason?: string | null;
  remark?: string | null;
  status: string;
  description?: string | null;
  visibility: string;
  publishStatus: string;
  fileKey?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  createdBy?: string | null;
  uploader?: {
    id: string;
    username: string;
    displayName?: string | null;
  } | null;
  indicators?: Array<{
    id: string;
    name: string;
    code: string;
    category: string;
    source?: 'auto' | 'manual';
  }>;
  dictionaries?: Array<{
    id: string;
    type: string;
    code: string;
    name: string;
    source?: 'auto' | 'manual';
  }>;
  updatedAt: string;
  score?: number;
  snippet?: string;
};

export type DatasetStats = {
  total: number;
  activeCount: number;
  byCategory: Array<{ categoryCode: string; count: number }>;
};

export type DatasetFilePreview =
  | {
      kind: 'pdf';
      fileName: string;
      mimeType: 'application/pdf';
    }
  | {
      kind: 'document';
      fileName: string;
      text: string;
      truncated: boolean;
    }
  | {
      kind: 'html';
      fileName: string;
      html: string;
      truncated: boolean;
    }
  | {
      kind: 'spreadsheet';
      fileName: string;
      sheetName: string;
      rows: string[][];
      totalRows: number;
      totalColumns: number;
      truncated: boolean;
    };

/** 指标分页 */
export async function fetchIndicators(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: string;
  status?: string;
}) {
  const { data } = await http.get<PageResult<IndicatorItem>>(
    '/admin/indicators',
    { params },
  );
  return data;
}

export async function createIndicator(payload: Record<string, unknown>) {
  const { data } = await http.post<IndicatorItem>('/admin/indicators', payload);
  return data;
}

export async function updateIndicator(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<IndicatorItem>(
    `/admin/indicators/${id}`,
    payload,
  );
  return data;
}

export async function deleteIndicator(id: string) {
  return batchDeleteIndicators([id]);
}

export async function batchDeleteIndicators(ids: string[]) {
  const { data } = await http.post<{ ok: boolean; deleted: number }>(
    '/admin/indicators/batch-delete',
    { ids },
  );
  return data;
}

export async function fetchIndicatorDetail(id: string) {
  const { data } = await http.get<IndicatorItem>(`/admin/indicators/${id}`);
  return data;
}

export async function fetchIndicatorSourceMappings(indicatorId: string) {
  const { data } = await http.get<IndicatorSourceMappingItem[]>(
    `/admin/indicators/${indicatorId}/source-mappings`,
  );
  return data;
}

export async function createIndicatorSourceMapping(
  indicatorId: string,
  payload: {
    dataSource: string;
    sourceField: string;
    transform?: string;
    status?: string;
  },
) {
  const { data } = await http.post<IndicatorSourceMappingItem>(
    `/admin/indicators/${indicatorId}/source-mappings`,
    payload,
  );
  return data;
}

export async function updateIndicatorSourceMapping(
  indicatorId: string,
  mappingId: string,
  payload: {
    dataSource?: string;
    sourceField?: string;
    transform?: string;
    status?: string;
  },
) {
  const { data } = await http.put<IndicatorSourceMappingItem>(
    `/admin/indicators/${indicatorId}/source-mappings/${mappingId}`,
    payload,
  );
  return data;
}

export async function deleteIndicatorSourceMapping(
  indicatorId: string,
  mappingId: string,
) {
  await http.delete(
    `/admin/indicators/${indicatorId}/source-mappings/${mappingId}`,
  );
}

// =========================
// 字段映射（指标 ↔ 数据集字段）
// =========================

export type FieldMappingItem = {
  id: string;
  indicatorId: string;
  datasetFieldId: string;
  aggregation: string;
  formula?: string | null;
  condition?: string | null;
  priority: number;
  status: string;
  source: 'manual' | 'auto' | 'auto_pending';
  confidence?: number | null;
  matchTerm?: string | null;
  indicator: {
    id: string;
    code: string;
    name: string;
    unit: string;
  };
  datasetField: {
    id: string;
    fieldName: string;
    displayName?: string | null;
    dataType: string;
    semanticType?: string | null;
    dataset?: {
      id: string;
      code: string;
      name: string;
    };
  };
  createdAt: string;
  updatedAt: string;
};

export type DatasetFieldOption = {
  id: string;
  fieldName: string;
  displayName?: string | null;
  dataType: string;
  semanticType?: string | null;
  datasetId: string;
  datasetCode: string;
  datasetName: string;
  datasetVersionId: string;
  version: number;
  label: string;
};

/** 知识库结构化文件（学习完成 READY），非来源管理目录 */
export type KnowledgeStructuredDatasetOption = {
  id: string;
  code: string;
  name: string;
  fileName?: string | null;
  version: number;
  label: string;
};

export async function fetchFieldMappings(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  indicatorId?: string;
  datasetId?: string;
  status?: string;
  source?: string;
}) {
  const { data } = await http.get<PageResult<FieldMappingItem>>(
    '/admin/field-mappings',
    { params },
  );
  return data;
}

export async function fetchFieldMappingDatasetOptions(keyword?: string) {
  const { data } = await http.get<KnowledgeStructuredDatasetOption[]>(
    '/admin/field-mappings/dataset-options',
    { params: keyword ? { keyword } : undefined },
  );
  return data;
}

export async function fetchDatasetFieldOptions(params?: {
  datasetId?: string;
  keyword?: string;
}) {
  const { data } = await http.get<DatasetFieldOption[]>(
    '/admin/field-mappings/field-options',
    { params },
  );
  return data;
}

export async function createFieldMapping(payload: {
  indicatorId: string;
  datasetFieldId: string;
  aggregation?: string;
  formula?: string;
  condition?: string;
  priority?: number;
  status?: string;
}) {
  const { data } = await http.post<FieldMappingItem>(
    '/admin/field-mappings',
    payload,
  );
  return data;
}

export async function updateFieldMapping(
  id: string,
  payload: {
    indicatorId?: string;
    datasetFieldId?: string;
    aggregation?: string;
    formula?: string;
    condition?: string;
    priority?: number;
    status?: string;
  },
) {
  const { data } = await http.put<FieldMappingItem>(
    `/admin/field-mappings/${id}`,
    payload,
  );
  return data;
}

export async function deleteFieldMapping(id: string) {
  return batchDeleteFieldMappings([id]);
}

export async function batchDeleteFieldMappings(ids: string[]) {
  const { data } = await http.post<{ ok: boolean; deleted: number }>(
    '/admin/field-mappings/batch-delete',
    { ids },
  );
  return data;
}

export async function batchAcceptFieldMappings(ids: string[]) {
  const { data } = await http.post<{
    ok: boolean;
    accepted: number;
    aliasesAdded: number;
  }>('/admin/field-mappings/batch-accept', { ids });
  return data;
}

export async function batchDismissFieldMappings(ids: string[]) {
  const { data } = await http.post<{ ok: boolean; deleted: number }>(
    '/admin/field-mappings/batch-dismiss',
    { ids },
  );
  return data;
}

export async function reapplyAutoFieldMappings(datasetId?: string) {
  const { data } = await http.post<{
    datasets: number;
    results: Array<{
      datasetVersionId: string;
      created: number;
      updated: number;
      skippedManual: number;
      active: number;
      pending: number;
    }>;
  }>('/admin/field-mappings/reapply-auto', {
    datasetId: datasetId || undefined,
  });
  return data;
}

/** 字典分页 */
export async function fetchDictionaries(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  type?: string;
  status?: string;
}) {
  const { data } = await http.get<PageResult<DictionaryItem>>(
    '/admin/dictionaries',
    { params },
  );
  return data;
}

/** 字典类型列表 */
export async function fetchDictionaryTypes(params?: { activeOnly?: boolean }) {
  const { data } = await http.get<DictionaryTypeItem[]>(
    '/admin/dictionaries/types',
    { params },
  );
  return data;
}

export async function createDictionaryType(payload: Record<string, unknown>) {
  const { data } = await http.post<DictionaryTypeItem>(
    '/admin/dictionaries/types',
    payload,
  );
  return data;
}

export async function updateDictionaryType(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<DictionaryTypeItem>(
    `/admin/dictionaries/types/${id}`,
    payload,
  );
  return data;
}

export async function deleteDictionaryType(id: string) {
  const { data } = await http.delete<{ ok: boolean }>(
    `/admin/dictionaries/types/${id}`,
  );
  return data;
}

export async function createDictionary(payload: Record<string, unknown>) {
  const { data } = await http.post<DictionaryItem>(
    '/admin/dictionaries',
    payload,
  );
  return data;
}

export async function updateDictionary(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<DictionaryItem>(
    `/admin/dictionaries/${id}`,
    payload,
  );
  return data;
}

export async function deleteDictionary(id: string) {
  return batchDeleteDictionaries([id]);
}

export async function batchDeleteDictionaries(ids: string[]) {
  const { data } = await http.post<{ ok: boolean; deleted: number }>(
    '/admin/dictionaries/batch-delete',
    { ids },
  );
  return data;
}

export async function reindexDictionary(id: string) {
  const { data } = await http.post(`/admin/dictionaries/${id}/reindex`);
  return data;
}

export async function searchDictionaries(payload: {
  query: string;
  type?: string;
  topK?: number;
}) {
  const { data } = await http.post<DictionaryItem[]>(
    '/admin/dictionaries/search',
    payload,
  );
  return data;
}

/** 来源 / 数据集分页 */
export async function fetchDatasets(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  visibility?: string;
  publishStatus?: string;
  status?: string;
  categoryCode?: string;
  regionLevel?: string;
}) {
  const { data } = await http.get<PageResult<DatasetItem>>('/admin/datasets', {
    params,
  });
  return data;
}

export async function fetchDatasetStats() {
  const { data } = await http.get<DatasetStats>('/admin/datasets/stats');
  return data;
}

export async function createDataset(payload: Record<string, unknown>) {
  const { data } = await http.post<DatasetItem>('/admin/datasets', payload);
  return data;
}

export async function updateDataset(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<DatasetItem>(
    `/admin/datasets/${id}`,
    payload,
  );
  return data;
}

export async function deleteDataset(id: string) {
  return batchDeleteDatasets([id]);
}

export async function batchDeleteDatasets(ids: string[]) {
  const { data } = await http.post<{ ok: boolean; deleted: number }>(
    '/admin/datasets/batch-delete',
    { ids },
  );
  return data;
}

export async function publishDataset(id: string) {
  const { data } = await http.patch<DatasetItem>(
    `/admin/datasets/${id}/publish`,
  );
  return data;
}

export async function unpublishDataset(id: string) {
  const { data } = await http.patch<DatasetItem>(
    `/admin/datasets/${id}/unpublish`,
  );
  return data;
}

export async function uploadDatasetFile(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  // 不要手动设 Content-Type：需由浏览器带上 multipart boundary，否则服务端收不到文件
  const { data } = await http.post<DatasetItem>(
    `/admin/datasets/${id}/upload`,
    form,
  );
  return data;
}

export async function fetchDatasetFilePreview(id: string) {
  const { data } = await http.get<DatasetFilePreview>(
    `/admin/datasets/${id}/preview`,
  );
  return data;
}

export async function fetchDatasetFile(id: string) {
  const { data } = await http.get<Blob>(`/admin/datasets/${id}/file`, {
    responseType: 'blob',
  });
  // 少数网关把业务错误伪装成 200 + JSON blob，需识别避免塞进 PDF iframe
  if (data.type.includes('application/json')) {
    const text = await data.text();
    let msg = '文件读取失败';
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      msg = Array.isArray(parsed.message)
        ? parsed.message.join('; ')
        : parsed.message || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return data;
}

export async function autoLinkDataset(id: string) {
  const { data } = await http.post<
    DatasetItem & {
      autoLink?: {
        addedIndicators: number;
        addedDictionaries: number;
        removedAutoIndicators: number;
        removedAutoDictionaries: number;
      };
    }
  >(`/admin/datasets/${id}/auto-link`);
  return data;
}

/** 知识库 */
export type KnowledgeTagItem = {
  id: string;
  name: string;
  code: string;
  status?: string;
};

export type KnowledgeLibraryItem = {
  id: string;
  name: string;
  code: string;
  type: 'normal' | 'qa' | string;
  visibility?: 'public' | 'private' | string;
  intro?: string | null;
  groupCode?: string | null;
  icon: string;
  color: string;
  fileTotal: number;
  fileSize: number;
  status: string;
  creatorName?: string | null;
  updaterName?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeCategoryNode = {
  id: string;
  name: string;
  code: string;
  parentId?: string | null;
  sort: number;
  status: string;
  description?: string | null;
  children: KnowledgeCategoryNode[];
};

export type KnowledgeItem = {
  id: string;
  title: string;
  code: string;
  summary?: string | null;
  content?: string | null;
  visibility: string;
  auditStatus: string;
  publishStatus: string;
  categoryId?: string | null;
  category?: { id: string; name: string; code: string } | null;
  libraryId?: string | null;
  groupCode?: string | null;
  sourceType: string;
  sourceMeta?: Record<string, unknown> | null;
  fileName?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  chunkCount: number;
  hitCount?: number;
  vectorStatus: string;
  vectorError?: string | null;
  vectorSyncedAt?: string | null;
  rejectReason?: string | null;
  auditedAt?: string | null;
  submitter?: {
    id: string;
    username: string;
    displayName?: string | null;
  } | null;
  auditor?: {
    id: string;
    username: string;
    displayName?: string | null;
  } | null;
  tags: KnowledgeTagItem[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeAuditDetail = KnowledgeItem & {
  auditHistory: Array<{
    id: string;
    action: string;
    remark?: string | null;
    snapshot?: Record<string, unknown> | null;
    actor?: {
      id: string;
      username: string;
      displayName?: string | null;
    } | null;
    createdAt: string;
  }>;
};

export type KnowledgeIndexOverview = {
  total: number;
  approved: number;
  published: number;
  pending: number;
  processing: number;
  ready: number;
  failed: number;
  dirtyCandidates: number;
};

export async function fetchKnowledgeLibraries(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  groupCode?: string;
  type?: string;
  visibility?: string;
  status?: string;
}) {
  const { data } = await http.get<PageResult<KnowledgeLibraryItem>>(
    '/admin/knowledge/libraries',
    { params },
  );
  return data;
}

export type KnowledgeLibraryBucket = Pick<
  KnowledgeLibraryItem,
  'groupCode' | 'type' | 'visibility'
> & { count: number };

export async function fetchKnowledgeLibraryStatistics(
  params?: Parameters<typeof fetchKnowledgeLibraries>[0],
) {
  const { data } = await http.get<KnowledgeLibraryBucket[]>(
    '/admin/knowledge/libraries/statistics',
    { params },
  );
  return data;
}

export async function fetchKnowledgeLibraryDetail(id: string) {
  const { data } = await http.get<KnowledgeLibraryItem>(
    `/admin/knowledge/libraries/${id}`,
  );
  return data;
}

export async function createKnowledgeLibrary(payload: Record<string, unknown>) {
  const { data } = await http.post<KnowledgeLibraryItem>(
    '/admin/knowledge/libraries',
    payload,
  );
  return data;
}

export async function updateKnowledgeLibrary(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<KnowledgeLibraryItem>(
    `/admin/knowledge/libraries/${id}`,
    payload,
  );
  return data;
}

export async function deleteKnowledgeLibrary(id: string) {
  await http.delete(`/admin/knowledge/libraries/${id}`);
}

export type UserKnowledgeLibraryOverview = {
  user: {
    id: string;
    username: string;
    displayName?: string | null;
    membershipLevelName?: string | null;
  };
  libraryCount: number;
  documentCount: number;
  totalSize: number;
  libraries: Array<
    KnowledgeLibraryItem & {
      items: KnowledgeItem[];
      virtual?: boolean;
    }
  >;
};

export async function fetchUserKnowledgeLibraries(userId: string) {
  const { data } = await http.get<UserKnowledgeLibraryOverview>(
    `/admin/knowledge/user-libraries/${userId}`,
  );
  return data;
}

export async function fetchKnowledgeCategoryTree() {
  const { data } = await http.get<KnowledgeCategoryNode[]>(
    '/admin/knowledge/categories/tree',
  );
  return data;
}

export async function createKnowledgeCategory(
  payload: Record<string, unknown>,
) {
  const { data } = await http.post('/admin/knowledge/categories', payload);
  return data;
}

export async function updateKnowledgeCategory(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put(`/admin/knowledge/categories/${id}`, payload);
  return data;
}

export async function deleteKnowledgeCategory(id: string) {
  await http.delete(`/admin/knowledge/categories/${id}`);
}

export async function fetchKnowledgeTags(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}) {
  const { data } = await http.get<PageResult<KnowledgeTagItem>>(
    '/admin/knowledge/tags',
    { params },
  );
  return data;
}

export async function createKnowledgeTag(payload: Record<string, unknown>) {
  const { data } = await http.post<KnowledgeTagItem>(
    '/admin/knowledge/tags',
    payload,
  );
  return data;
}

export async function updateKnowledgeTag(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<KnowledgeTagItem>(
    `/admin/knowledge/tags/${id}`,
    payload,
  );
  return data;
}

export async function deleteKnowledgeTag(id: string) {
  await http.delete(`/admin/knowledge/tags/${id}`);
}

export async function fetchKnowledgeItems(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  visibility?: string;
  auditStatus?: string;
  publishStatus?: string;
  categoryId?: string;
  libraryId?: string;
  groupCode?: string;
}) {
  const { data } = await http.get<PageResult<KnowledgeItem>>(
    '/admin/knowledge/items',
    { params },
  );
  return data;
}

export type KnowledgeItemBucket = Pick<
  KnowledgeItem,
  'groupCode' | 'auditStatus' | 'vectorStatus' | 'publishStatus'
> & { count: number };

export async function fetchKnowledgeItemStatistics(
  params?: Parameters<typeof fetchKnowledgeItems>[0],
) {
  const { data } = await http.get<KnowledgeItemBucket[]>(
    '/admin/knowledge/items/statistics',
    { params },
  );
  return data;
}

export type KnowledgeChunk = {
  id: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  pageNumber?: number | null;
  section?: string | null;
  sheetName?: string | null;
  tableName?: string | null;
};

export async function fetchKnowledgeItemChunks(id: string) {
  const { data } = await http.get<{
    version: { id: string; version: number; status: string } | null;
    chunks: KnowledgeChunk[];
  }>(`/admin/knowledge/items/${id}/chunks`);
  return data;
}

export async function createKnowledgeItem(payload: Record<string, unknown>) {
  const { data } = await http.post<KnowledgeItem>(
    '/admin/knowledge/items',
    payload,
  );
  return data;
}

export async function updateKnowledgeItem(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<KnowledgeItem>(
    `/admin/knowledge/items/${id}`,
    payload,
  );
  return data;
}

export async function deleteKnowledgeItem(id: string) {
  await http.delete(`/admin/knowledge/items/${id}`);
}

export async function publishKnowledgeItem(id: string) {
  const { data } = await http.patch<KnowledgeItem>(
    `/admin/knowledge/items/${id}/publish`,
  );
  return data;
}

export async function relearnKnowledgeItem(id: string) {
  const { data } = await http.post<KnowledgeItem>(
    `/admin/knowledge/items/${id}/relearn`,
  );
  return data;
}

export async function unpublishKnowledgeItem(id: string) {
  const { data } = await http.patch<KnowledgeItem>(
    `/admin/knowledge/items/${id}/unpublish`,
  );
  return data;
}

export type IngestionJobItem = {
  id: string;
  targetType: string;
  targetId: string;
  datasetVersionId?: string | null;
  knowledgeVersionId?: string | null;
  jobType: string;
  status: string;
  currentStep?: string | null;
  progress: number;
  retryCount: number;
  errorMessage?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function fetchIngestionJobs(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  targetType?: string;
  status?: string;
  targetId?: string;
}) {
  const { data } = await http.get<PageResult<IngestionJobItem>>(
    '/admin/ingestion-jobs',
    { params },
  );
  return data;
}

/** 搜索测试能力状态 */
export type SearchTestStatus = {
  vectorSearch: boolean;
  externalSearch: boolean;
};

/** 搜索测试结果（与研究端 ResearchSearchResponse 对齐） */
export type SearchTestResult = {
  runId: string;
  query: string;
  mode: 'mixed' | 'exa' | 'knowledge';
  matchedLocally: boolean;
  usedExa: boolean;
  exaConfigured: boolean;
  cacheHit: boolean;
  cachedAt: string | null;
  plan: {
    countries: string[];
    regions: string[];
    entities: string[];
    indicators: string[];
    timeRanges: string[];
    sources: string[];
    intent: string;
    confidence: number;
    explanation: string;
  };
  sources: Array<{
    id: string;
    title: string;
    origin: string;
    storageType: string;
    sourceUrl?: string | null;
    mimeType?: string | null;
    excerpt?: string | null;
    recordCount?: number | null;
    structuredData?: unknown;
    score?: number;
    createdAt: string;
  }>;
  stages: Array<{
    key: string;
    label: string;
    status: string;
    detail?: string;
  }>;
  answer?: string;
  aiQueryId?: string;
};

export async function fetchSearchTestStatus() {
  const { data } = await http.get<SearchTestStatus>(
    '/admin/search-test/status',
  );
  return data;
}

export async function runSearchTest(body: {
  query: string;
  mode?: 'mixed' | 'exa' | 'knowledge';
}) {
  const { data } = await http.post<SearchTestResult>(
    '/admin/search-test',
    body,
  );
  return data;
}

export async function uploadKnowledgeFile(id: string, file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await http.post<KnowledgeItem>(
    `/admin/knowledge/items/${id}/upload`,
    form,
  );
  return data;
}

export async function fetchKnowledgeItemPreview(id: string) {
  const { data } = await http.get<DatasetFilePreview>(
    `/admin/knowledge/items/${id}/preview`,
  );
  return data;
}

export async function fetchKnowledgeItemFile(id: string) {
  const { data } = await http.get<Blob>(`/admin/knowledge/items/${id}/file`, {
    responseType: 'blob',
  });
  if (data.type.includes('application/json')) {
    const text = await data.text();
    let msg = '文件读取失败';
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      msg = Array.isArray(parsed.message)
        ? parsed.message.join('; ')
        : parsed.message || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return data;
}

export async function fetchKnowledgeAudits(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  auditStatus?: string;
  visibility?: string;
  libraryVisibility?: string;
}) {
  const { data } = await http.get<PageResult<KnowledgeItem>>(
    '/admin/knowledge/audits',
    { params },
  );
  return data;
}

export async function fetchKnowledgeAuditDetail(id: string) {
  const { data } = await http.get<KnowledgeAuditDetail>(
    `/admin/knowledge/audits/${id}`,
  );
  return data;
}

export async function fetchKnowledgeAuditPreview(id: string) {
  const { data } = await http.get<DatasetFilePreview>(
    `/admin/knowledge/audits/${id}/preview`,
  );
  return data;
}

export async function fetchKnowledgeAuditFile(id: string) {
  const { data } = await http.get<Blob>(`/admin/knowledge/audits/${id}/file`, {
    responseType: 'blob',
  });
  if (data.type.includes('application/json')) {
    const text = await data.text();
    let msg = '文件读取失败';
    try {
      const parsed = JSON.parse(text) as { message?: string | string[] };
      msg = Array.isArray(parsed.message)
        ? parsed.message.join('; ')
        : parsed.message || msg;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  return data;
}

export async function approveKnowledgeItem(
  id: string,
  payload?: { remark?: string },
) {
  const { data } = await http.post<KnowledgeItem>(
    `/admin/knowledge/audits/${id}/approve`,
    payload ?? {},
  );
  return data;
}

export async function rejectKnowledgeItem(id: string, reason: string) {
  const { data } = await http.post<KnowledgeItem>(
    `/admin/knowledge/audits/${id}/reject`,
    { reason },
  );
  return data;
}

export async function fetchKnowledgeIndexOverview() {
  const { data } = await http.get<KnowledgeIndexOverview>(
    '/admin/knowledge/indexes/overview',
  );
  return data;
}

export async function fetchKnowledgeIndexFailed(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  const { data } = await http.get<PageResult<KnowledgeItem>>(
    '/admin/knowledge/indexes/failed',
    { params },
  );
  return data;
}

export async function rebuildKnowledgeIndex(payload?: {
  ids?: string[];
  limit?: number;
}) {
  const { data } = await http.post<{ ok: boolean; count: number }>(
    '/admin/knowledge/indexes/rebuild',
    payload ?? {},
  );
  return data;
}

export async function incrementalKnowledgeIndex(payload?: {
  ids?: string[];
  limit?: number;
}) {
  const { data } = await http.post<{ ok: boolean; count: number }>(
    '/admin/knowledge/indexes/incremental',
    payload ?? {},
  );
  return data;
}

export async function cleanupKnowledgeIndex(payload?: {
  ids?: string[];
  limit?: number;
}) {
  const { data } = await http.post<{ ok: boolean; count: number }>(
    '/admin/knowledge/indexes/cleanup',
    payload ?? {},
  );
  return data;
}

/** 清空全部向量（Milvus + DB），可选立即重跑 */
export async function purgeAllKnowledgeVectors(payload?: {
  reindex?: boolean;
  reindexLimit?: number;
}) {
  const { data } = await http.post<{
    ok: boolean;
    deletedChunks: number;
    knowledgeReset: number;
    knowledgeRequeued: number;
  }>('/admin/knowledge/indexes/purge-all', payload ?? {});
  return data;
}

/** 操作日志条目 */
export type OperLogItem = {
  id: string;
  title: string;
  businessType: number;
  method: string;
  requestMethod: string;
  operName: string;
  deptName: string;
  operUrl: string;
  operIp: string;
  operLocation: string;
  operParam: string;
  jsonResult: string;
  status: number;
  errorMsg: string;
  operTime: string;
  costTime: number;
};

/** 操作日志分页查询 */
export async function fetchOperLogs(params: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  title?: string;
  operName?: string;
  businessType?: number;
  category?: 'login' | 'export' | 'delete';
  status?: number;
  requestMethod?: string;
  beginTime?: string;
  endTime?: string;
}) {
  const { data } = await http.get<PageResult<OperLogItem>>('/admin/oper-logs', {
    params,
  });
  return data;
}

/** 操作日志详情 */
export async function fetchOperLogDetail(id: string) {
  const { data } = await http.get<OperLogItem>(`/admin/oper-logs/${id}`);
  return data;
}

// =========================
// 运营管理
// =========================

export type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  audienceScope: 'all_users' | 'specified_roles' | 'pro_members';
  audienceRoleIds: string[] | null;
  status: 'draft' | 'published' | 'recalled';
  publishedAt: string | null;
  recalledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AnnouncementListResult = PageResult<AnnouncementItem> & {
  draftCount: number;
  publishedCount: number;
  recalledCount: number;
};

export type BusinessNotificationItem = {
  id: string;
  content: string;
  receiverId: string;
  receiverName: string;
  status: 'unread' | 'read';
  bizType: string;
  sentAt: string;
};

export type HotWordItem = {
  rank: number;
  keyword: string;
  frequency: number;
  trendPercent: number;
  isQuickSearch: boolean;
};

export type NoResultWordItem = {
  keyword: string;
  lastSearchedAt: string;
  frequency: number;
  handled: boolean;
};

export type SensitiveWordItem = {
  id: string;
  word: string;
  category: 'political' | 'porn' | 'ad';
  hitCount: number;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchAnnouncements(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
}) {
  const { data } = await http.get<AnnouncementListResult>(
    '/admin/operation/announcements',
    { params },
  );
  return data;
}

export async function createAnnouncement(payload: Record<string, unknown>) {
  const { data } = await http.post<AnnouncementItem>(
    '/admin/operation/announcements',
    payload,
  );
  return data;
}

export async function updateAnnouncement(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<AnnouncementItem>(
    `/admin/operation/announcements/${id}`,
    payload,
  );
  return data;
}

export async function publishAnnouncement(id: string) {
  const { data } = await http.post<AnnouncementItem>(
    `/admin/operation/announcements/${id}/publish`,
  );
  return data;
}

export async function recallAnnouncement(id: string) {
  const { data } = await http.post<AnnouncementItem>(
    `/admin/operation/announcements/${id}/recall`,
  );
  return data;
}

export async function republishAnnouncement(id: string) {
  const { data } = await http.post<AnnouncementItem>(
    `/admin/operation/announcements/${id}/republish`,
  );
  return data;
}

export async function fetchBusinessNotifications(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  bizType?: string;
  timeRange?: string;
  receiver?: string;
}) {
  const { data } = await http.get<PageResult<BusinessNotificationItem>>(
    '/admin/operation/notifications',
    { params },
  );
  return data;
}

export async function markNotificationRead(id: string) {
  const { data } = await http.post<BusinessNotificationItem>(
    `/admin/operation/notifications/${id}/read`,
  );
  return data;
}

export async function resendNotification(id: string) {
  const { data } = await http.post<BusinessNotificationItem>(
    `/admin/operation/notifications/${id}/resend`,
  );
  return data;
}

export async function fetchHotWords(params?: {
  range?: '7d' | '30d';
  page?: number;
  pageSize?: number;
}) {
  const { data } = await http.get<PageResult<HotWordItem>>(
    '/admin/operation/search-ops/hot-words',
    { params },
  );
  return data;
}

export async function exportHotWords(range: '7d' | '30d' = '7d') {
  const { data } = await http.get<Blob>(
    '/admin/operation/search-ops/hot-words/export',
    { params: { range }, responseType: 'blob' },
  );
  return data;
}

export async function setQuickSearch(keyword: string) {
  const { data } = await http.post<{
    ok: boolean;
    id: string;
    keyword: string;
  }>('/admin/operation/search-ops/quick-search', { keyword });
  return data;
}

export async function fetchNoResultWords(params?: {
  range?: '7d' | '30d';
  page?: number;
  pageSize?: number;
}) {
  const { data } = await http.get<PageResult<NoResultWordItem>>(
    '/admin/operation/search-ops/no-result-words',
    { params },
  );
  return data;
}

export async function markNoResultWord(keyword: string, note?: string) {
  const { data } = await http.post<{
    ok: boolean;
    keyword: string;
    handled: boolean;
  }>('/admin/operation/search-ops/no-result-words/mark', { keyword, note });
  return data;
}

export async function fetchSensitiveWords(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  category?: string;
}) {
  const { data } = await http.get<PageResult<SensitiveWordItem>>(
    '/admin/operation/search-ops/sensitive-words',
    { params },
  );
  return data;
}

export async function createSensitiveWord(payload: Record<string, unknown>) {
  const { data } = await http.post<SensitiveWordItem>(
    '/admin/operation/search-ops/sensitive-words',
    payload,
  );
  return data;
}

export async function updateSensitiveWord(
  id: string,
  payload: Record<string, unknown>,
) {
  const { data } = await http.put<SensitiveWordItem>(
    `/admin/operation/search-ops/sensitive-words/${id}`,
    payload,
  );
  return data;
}

export async function enableSensitiveWord(id: string) {
  const { data } = await http.post<SensitiveWordItem>(
    `/admin/operation/search-ops/sensitive-words/${id}/enable`,
  );
  return data;
}

export async function disableSensitiveWord(id: string) {
  const { data } = await http.post<SensitiveWordItem>(
    `/admin/operation/search-ops/sensitive-words/${id}/disable`,
  );
  return data;
}

export type BackupJobItem = {
  id: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  trigger: 'scheduled' | 'manual';
  prefix: string;
  startedAt: string | null;
  finishedAt: string | null;
  dbSizeBytes: string | null;
  filesCount: number;
  filesSizeBytes: string;
  envIncluded: boolean;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BackupStatus = {
  enabled: boolean;
  cron: string;
  retentionDays: number;
  prefix: string;
  localDir: string;
  confirmText: string;
  isRunning: boolean;
  isRestoring: boolean;
  latest: BackupJobItem | null;
  restore: RestoreStatus | null;
};

export type RestoreStatus = {
  restoreId: string;
  backupId: string;
  prefix: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  phase: 'queued' | 'files' | 'database' | 'env' | 'done';
  filesRestored: number;
  dbRestored: boolean;
  envFilePath: string | null;
  restartRequired: boolean;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  message: string;
};

export async function fetchBackupStatus() {
  const { data } = await http.get<BackupStatus>('/admin/system/backups/status');
  return data;
}

export async function fetchBackupJobs(params?: {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) {
  const { data } = await http.get<PageResult<BackupJobItem>>(
    '/admin/system/backups',
    { params },
  );
  return data;
}

export async function runSystemBackup() {
  const { data } = await http.post<BackupJobItem>('/admin/system/backups/run');
  return data;
}

export async function updateBackupSchedule(enabled: boolean) {
  const { data } = await http.put<BackupStatus>(
    '/admin/system/backups/schedule',
    {
      enabled,
    },
  );
  return data;
}

export async function restoreSystemBackup(id: string, confirmText: string) {
  const { data } = await http.post<{
    restoreId: string;
    backupId: string;
    prefix: string;
    message: string;
  }>(`/admin/system/backups/${id}/restore`, { confirmText });
  return data;
}
