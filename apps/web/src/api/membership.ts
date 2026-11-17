import { http } from './http';

export type MembershipPackageType =
  'monthly' | 'auto_renew_monthly' | 'quarterly' | 'yearly';

export interface MembershipCatalogPackage {
  id: string;
  name: string;
  packageType: MembershipPackageType | string;
  price: number;
  originalPrice: number | null;
  priceLabel: string | null;
  description: string | null;
  tag: string;
  durationDays: number;
  levelCode: string;
  levelName: string;
  monthlyPoints?: number;
  renewPrice?: number | null;
}

export interface MembershipCatalogEdition {
  code: string;
  name: string;
  available: boolean;
  monthlyPoints?: number;
  monthlyLimit?: number;
  scenario?: string;
  features?: string[];
  description?: string | null;
}

export interface MembershipCompareRow {
  feature: string;
  free: string;
  normal: string;
  plus: string;
  pro: string;
}

export interface MembershipCatalog {
  editions: MembershipCatalogEdition[];
  packages: MembershipCatalogPackage[];
  compareRows?: MembershipCompareRow[];
  discountTip?: string;
  todayActivatedCount: number;
}

export interface MembershipStatus {
  isMember: boolean;
  remainingTrials: number | null;
  trialQuota: number;
  canSearch: boolean;
  /** 发起智搜所需最低积分余额 */
  minSearchPoints?: number;
  pointsBalance?: number;
  levelCode: string | null;
  levelName: string | null;
  endAt: string | null;
  autoRenew: boolean;
}

export interface MembershipCheckoutResult {
  ok: boolean;
  channel: 'mock' | 'alipay' | 'wechat';
  payMode?: 'mock' | 'alipay_page' | 'alipay_qr' | 'wechat_native';
  /** 电脑网站支付：后端生成的 form HTML，前端写入并 submit */
  payForm?: string;
  /** 支付宝当面付返回的原始二维码内容，由前端绘制 QR。 */
  qrCode?: string;
  expiresAt?: string;
  message: string;
  order: {
    id: string;
    orderNo: string;
    status: string;
    amount: number | string;
    title?: string | null;
    levelTitle?: string;
    paidAt?: string | null;
  };
  membership: MembershipStatus;
}

export interface PointSummary {
  balance: number;
  totalEarned: number;
  monthlyUsed: number;
  monthlyLimit: number;
  membership: { levelName: string; endAt: string } | null;
  daily: { amount: number; claimed: boolean };
  rules?: {
    registrationPoints: number;
    monthlyFreePoints: number;
    dailyPoints: number;
    freeMonthlyLimit: number;
    searchCostPoints: number;
    minSearchPoints: number;
    yuanPerPoint: number;
    levels: Array<{ code: string; name: string; monthlyPoints: number }>;
  };
  ledgers: PointLedgerItem[];
}

export interface PointLedgerItem {
  id: string;
  amount: number;
  balanceAfter: number;
  source: string;
  description: string;
  createdAt: string;
}

export interface PointLedgerPage {
  items: PointLedgerItem[];
  total: number;
  page: number;
  pageSize: number;
}

export async function fetchMembershipCatalog(): Promise<MembershipCatalog> {
  return (await http.get<MembershipCatalog>('/membership/catalog')).data;
}

export async function fetchMembershipStatus(): Promise<MembershipStatus> {
  return (await http.get<MembershipStatus>('/membership/me')).data;
}

export async function fetchPointSummary(): Promise<PointSummary> {
  return (await http.get<PointSummary>('/membership/points')).data;
}

export async function fetchPointLedgers(params: {
  page?: number;
  pageSize?: number;
}): Promise<PointLedgerPage> {
  return (
    await http.get<PointLedgerPage>('/membership/points/ledgers', { params })
  ).data;
}

export async function claimDailyPoints(): Promise<PointSummary> {
  return (await http.post<PointSummary>('/membership/points/daily-claim')).data;
}

export async function checkoutMembership(
  packageId: string,
): Promise<MembershipCheckoutResult> {
  return (
    await http.post<MembershipCheckoutResult>('/membership/checkout', {
      packageId,
    })
  ).data;
}

export interface PendingOrderCreated {
  id: string;
  orderNo: string;
  amount: number;
  status: string;
  title: string | null;
  content: string;
  createdAt: string;
}

export async function createMembershipOrder(
  packageId: string,
): Promise<PendingOrderCreated> {
  return (
    await http.post<PendingOrderCreated>('/membership/orders', { packageId })
  ).data;
}

export async function payMembershipOrder(
  orderId: string,
  channel: 'wechat' | 'alipay' | 'mock',
  alipayMode: 'qr' | 'page' = 'page',
): Promise<MembershipCheckoutResult> {
  return (
    await http.post<MembershipCheckoutResult>(
      `/membership/orders/${orderId}/pay`,
      { channel, ...(channel === 'alipay' ? { alipayMode } : {}) },
    )
  ).data;
}

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserOrderItem {
  id: string;
  orderNo: string;
  content: string;
  amount: number;
  paymentChannel: string | null;
  status: string;
  createdAt: string;
  /** 支付截止时间，带时区的 ISO 时间。 */
  expiresAt: string;
  paidAt: string | null;
}

export interface UserPaymentItem {
  id: string;
  tradeNo: string | null;
  channel: string;
  orderNo: string;
  amount: number;
  paidAt: string;
  status: string;
}

export async function fetchMyOrders(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  timeRange?: string;
}): Promise<PageResult<UserOrderItem>> {
  return (
    await http.get<PageResult<UserOrderItem>>('/membership/orders', { params })
  ).data;
}

export async function fetchMyPayments(params?: {
  page?: number;
  pageSize?: number;
  status?: string;
  timeRange?: string;
}): Promise<PageResult<UserPaymentItem>> {
  return (
    await http.get<PageResult<UserPaymentItem>>('/membership/payments', {
      params,
    })
  ).data;
}

export function isMembershipRequiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = (error as { response?: { data?: { code?: string } } }).response
    ?.data;
  return (
    data?.code === 'MEMBERSHIP_REQUIRED' || data?.code === 'POINTS_INSUFFICIENT'
  );
}

/** 主动查单会向支付宝查询并补偿丢失的异步通知，仅可查询本人订单。 */
export async function syncMembershipOrder(
  orderNo: string,
): Promise<{ id: string; orderNo: string; status: string; amount: number }> {
  return (
    await http.post(
      `/membership/orders/by-no/${encodeURIComponent(orderNo)}/sync`,
    )
  ).data;
}

export async function cancelMembershipOrder(orderId: string): Promise<void> {
  await http.post(`/membership/orders/${encodeURIComponent(orderId)}/cancel`);
}
