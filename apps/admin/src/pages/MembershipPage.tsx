import './MembershipPage.css';
import {
  CreditCardOutlined,
  InfoCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  Button,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  batchSendReminders,
  cancelOrder,
  createLevel,
  createPackage,
  disableLevel,
  fetchLevels,
  fetchMembershipOverview,
  fetchPointAccounts,
  fetchPointLedgers,
  fetchPointRules,
  fetchOrderDetail,
  fetchOrderRefunds,
  fetchOrders,
  fetchPackages,
  fetchRenewalCandidates,
  offShelfPackage,
  onShelfPackage,
  reconcileOrder,
  refundOrder as refundOrderApi,
  sendRenewalReminder,
  updateLevel,
  updatePackage,
  updatePointRules,
  type LevelItem,
  type MembershipOverview,
  type OrderItem,
  type PackageItem,
  type PointAccountItem,
  type PointLedgerItem,
  type PointRules,
  type RenewalCandidate,
} from '../api/admin';
import { FORM_MODAL_WIDTH, withFormModal } from '../components/form-modal';

const PACKAGE_TYPE_OPTIONS = [
  { value: 'monthly', label: '单月' },
  { value: 'auto_renew_monthly', label: '连续包月' },
  { value: 'quarterly', label: '季付' },
  { value: 'yearly', label: '年付' },
];

const PACKAGE_TYPE_LABEL: Record<string, string> = {
  monthly: '单月',
  auto_renew_monthly: '连续包月',
  quarterly: '季付',
  yearly: '年付',
};

const PACKAGE_DURATION_DEFAULT: Record<string, number> = {
  monthly: 30,
  auto_renew_monthly: 30,
  quarterly: 90,
  yearly: 365,
};

const TAG_OPTIONS = [
  { value: 'on_sale', label: '在售' },
  { value: 'recommended', label: '最推荐' },
  { value: 'off_shelf', label: '已下架' },
];

const TAG_META: Record<string, { label: string; color: string }> = {
  on_sale: { label: '在售', color: 'success' },
  recommended: { label: '最推荐', color: 'error' },
  off_shelf: { label: '已下架', color: 'default' },
};

const ORDER_STATUS_META: Record<
  string,
  { label: string; color: 'warning' | 'success' | 'error' | 'default' | 'processing' }
> = {
  pending: { label: '待支付', color: 'warning' },
  paid: { label: '已支付', color: 'success' },
  cancelled: { label: '已关闭', color: 'default' },
  refunded: { label: '已退款', color: 'processing' },
  failed: { label: '回调异常', color: 'error' },
};

function formatAmount(value: string | number) {
  const n = Number(value);
  return Number.isFinite(n) ? `¥${n.toFixed(2)}` : String(value);
}

function formatOriginalPrice(value?: string | number | null) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? `¥${Math.round(n)}` : String(value);
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 会员与缴费管理：会员版本、套餐方案、缴费订单、续费提醒。
 */
export function MembershipPage() {
  const [overview, setOverview] = useState<MembershipOverview | null>(null);
  const [levels, setLevels] = useState<LevelItem[]>([]);
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [orderPage, setOrderPage] = useState(1);
  const [orderTotal, setOrderTotal] = useState(0);
  const [orderPageSize] = useState(10);
  const [renewals, setRenewals] = useState<RenewalCandidate[]>([]);
  const [pointAccounts, setPointAccounts] = useState<PointAccountItem[]>([]);
  const [pointTotal, setPointTotal] = useState(0);
  const [pointLedgers, setPointLedgers] = useState<PointLedgerItem[]>([]);
  const [pointLedgerOpen, setPointLedgerOpen] = useState(false);
  const [pointLedgerTitle, setPointLedgerTitle] = useState('');
  const [pointRules, setPointRules] = useState<PointRules | null>(null);
  const [rulesEditing, setRulesEditing] = useState(false);
  const [rulesSaving, setRulesSaving] = useState(false);
  const rulesEditingRef = useRef(false);
  const [loading, setLoading] = useState(false);

  const [levelOpen, setLevelOpen] = useState(false);
  const [editingLevel, setEditingLevel] = useState<LevelItem | null>(null);
  const [levelForm] = Form.useForm();
  const [rulesForm] = Form.useForm();

  const [planOpen, setPlanOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<PackageItem | null>(null);
  const [planForm] = Form.useForm();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderItem | null>(null);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundOrder, setRefundOrder] = useState<OrderItem | null>(null);
  const [refundForm] = Form.useForm();

  const loadOrders = useCallback(async (page = 1) => {
    const orderRes = await fetchOrders({ page, pageSize: orderPageSize });
    setOrders(orderRes.items);
    setOrderPage(orderRes.page);
    setOrderTotal(orderRes.total);
  }, [orderPageSize]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ov, levelPage, pkgPage, orderRes, candidates, pointPage, rules] = await Promise.all([
        fetchMembershipOverview(),
        fetchLevels({ page: 1, pageSize: 100 }),
        fetchPackages({ page: 1, pageSize: 50 }),
        fetchOrders({ page: 1, pageSize: orderPageSize }),
        fetchRenewalCandidates(),
        fetchPointAccounts({ page: 1, pageSize: 10 }),
        fetchPointRules(),
      ]);
      setOverview(ov);
      setLevels(levelPage.items);
      setPackages(pkgPage.items);
      setOrders(orderRes.items);
      setOrderPage(orderRes.page);
      setOrderTotal(orderRes.total);
      setRenewals(candidates);
      setPointAccounts(pointPage.items);
      setPointTotal(pointPage.total);
      setPointRules(rules);
      if (!rulesEditingRef.current) {
        rulesForm.setFieldsValue({
          registrationPoints: rules.registrationPoints,
          monthlyFreePoints: rules.monthlyFreePoints,
          dailyPoints: rules.dailyPoints,
          freeMonthlyLimit: rules.freeMonthlyLimit,
          minSearchPoints: rules.minSearchPoints,
          yuanPerPoint: rules.yuanPerPoint,
          modelPricing: rules.modelPricing,
          levelMonthlyPoints: Object.fromEntries(
            rules.levels.map((item) => [item.id, item.monthlyPoints]),
          ),
        });
      }
      setSelectedLevelId((prev) => {
        if (prev && levelPage.items.some((item) => item.id === prev)) return prev;
        return (
          levelPage.items.find((item) => item.code === 'pro')?.id ??
          ov.level?.id ??
          levelPage.items[0]?.id ??
          null
        );
      });
    } catch {
      message.error('加载会员数据失败');
    } finally {
      setLoading(false);
    }
  }, [orderPageSize, rulesForm]);

  async function openPointLedgers(row: PointAccountItem) {
    try {
      setPointLedgerTitle(`${row.displayName || row.username} 的积分流水`);
      setPointLedgerOpen(true);
      setPointLedgers(await fetchPointLedgers(row.userId));
    } catch {
      message.error('加载积分流水失败');
    }
  }

  const pointAccountColumns: ColumnsType<PointAccountItem> = [
    { title: '用户账号', dataIndex: 'username', width: 130 },
    { title: '姓名', dataIndex: 'displayName', width: 110, render: (value) => value || '—' },
    { title: '套餐', dataIndex: 'levelName', width: 100, render: (value, row) => <Tag color={row.levelCode === 'free' ? 'default' : row.levelCode === 'pro' ? 'red' : 'green'}>{value}</Tag> },
    {
      title: '本月免费赠分',
      width: 140,
      render: (_, row) =>
        `${(row.freeGrantedThisMonth ?? 0).toLocaleString()} / ${(row.freeMonthlyLimit ?? 0).toLocaleString()}`,
    },
    { title: '会员月赠积分', dataIndex: 'membershipMonthlyPoints', width: 130, render: (value) => value?.toLocaleString() ?? '—' },
    { title: '月度最高积分', dataIndex: 'monthlyLimit', width: 120, render: (value) => value.toLocaleString() },
    { title: '本月消耗', dataIndex: 'monthlyUsed', width: 100, render: (value) => <span className="membership-points-consumed">{value.toLocaleString()}</span> },
    { title: '最近消耗时间', dataIndex: 'lastConsumedAt', width: 165, render: (value) => value || '—' },
    { title: '状态', dataIndex: 'status', width: 80, render: (value) => <Tag color={value === 'active' ? 'success' : 'default'}>{value === 'active' ? '正常' : value}</Tag> },
    { title: '操作', fixed: 'right', width: 100, render: (_, row) => <Button type="link" size="small" onClick={() => void openPointLedgers(row)}>查看流水</Button> },
  ];

  const beginEditRules = () => {
    if (!pointRules) return;
    rulesForm.setFieldsValue({
      registrationPoints: pointRules.registrationPoints,
      monthlyFreePoints: pointRules.monthlyFreePoints,
      dailyPoints: pointRules.dailyPoints,
      freeMonthlyLimit: pointRules.freeMonthlyLimit,
      minSearchPoints: pointRules.minSearchPoints,
      yuanPerPoint: pointRules.yuanPerPoint,
      modelPricing: pointRules.modelPricing,
      levelMonthlyPoints: Object.fromEntries(
        pointRules.levels.map((item) => [item.id, item.monthlyPoints]),
      ),
    });
    rulesEditingRef.current = true;
    setRulesEditing(true);
  };

  const cancelEditRules = () => {
    rulesEditingRef.current = false;
    setRulesEditing(false);
    if (!pointRules) return;
    rulesForm.setFieldsValue({
      registrationPoints: pointRules.registrationPoints,
      monthlyFreePoints: pointRules.monthlyFreePoints,
      dailyPoints: pointRules.dailyPoints,
      freeMonthlyLimit: pointRules.freeMonthlyLimit,
      minSearchPoints: pointRules.minSearchPoints,
      yuanPerPoint: pointRules.yuanPerPoint,
      modelPricing: pointRules.modelPricing,
      levelMonthlyPoints: Object.fromEntries(
        pointRules.levels.map((item) => [item.id, item.monthlyPoints]),
      ),
    });
  };

  const submitPointRules = async () => {
    try {
      const values = await rulesForm.validateFields();
      const levelMonthlyMap = (values.levelMonthlyPoints ?? {}) as Record<string, number>;
      setRulesSaving(true);
      const next = await updatePointRules({
        registrationPoints: Number(values.registrationPoints),
        monthlyFreePoints: Number(values.monthlyFreePoints),
        dailyPoints: Number(values.dailyPoints),
        freeMonthlyLimit: Number(values.freeMonthlyLimit),
        minSearchPoints: Number(values.minSearchPoints),
        yuanPerPoint: Number(values.yuanPerPoint),
        modelPricing: (values.modelPricing ?? []).map((item: {
          model: string;
          inputYuanPerMillionTokens: number;
          outputYuanPerMillionTokens: number;
        }) => ({
          model: item.model.trim(),
          inputYuanPerMillionTokens: Number(item.inputYuanPerMillionTokens),
          outputYuanPerMillionTokens: Number(item.outputYuanPerMillionTokens),
        })),
        levelMonthlyPoints: Object.entries(levelMonthlyMap).map(([levelId, monthlyPoints]) => ({
          levelId,
          monthlyPoints: Number(monthlyPoints) || 0,
        })),
      });
      setPointRules(next);
      setLevels((prev) =>
        prev.map((level) => {
          const matched = next.levels.find((item) => item.id === level.id);
          return matched ? { ...level, monthlyPoints: matched.monthlyPoints } : level;
        }),
      );
      rulesEditingRef.current = false;
      setRulesEditing(false);
      message.success('积分规则已保存');
    } catch {
      // 表单校验或请求失败
    } finally {
      setRulesSaving(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const selectedLevel = useMemo(
    () => levels.find((item) => item.id === selectedLevelId) ?? null,
    [levels, selectedLevelId],
  );

  const visiblePackages = useMemo(
    () =>
      selectedLevelId
        ? packages.filter((item) => item.levelId === selectedLevelId)
        : packages,
    [packages, selectedLevelId],
  );

  const levelOptions = useMemo(
    () =>
      levels.map((item) => ({
        value: item.id,
        label: item.name,
      })),
    [levels],
  );

  const openCreateLevel = () => {
    setEditingLevel(null);
    levelForm.resetFields();
    levelForm.setFieldsValue({
      scope: 'user',
      price: 0,
      monthlyPoints: 0,
      sort: (levels.length + 1) * 10,
    });
    setLevelOpen(true);
  };

  const openEditLevel = (row: LevelItem) => {
    setEditingLevel(row);
    levelForm.setFieldsValue({
      name: row.name,
      scope: row.scope || 'user',
      price: Number(row.price),
      monthlyPoints: row.monthlyPoints ?? 0,
      description: row.description ?? '',
    });
    setLevelOpen(true);
  };

  const submitLevel = async () => {
    try {
      const values = await levelForm.validateFields();
      if (editingLevel) {
        await updateLevel(editingLevel.id, {
          name: values.name,
          scope: values.scope,
          price: Number(values.price),
          monthlyPoints: Number(values.monthlyPoints ?? 0),
          description: values.description?.trim() || undefined,
        });
        message.success('版本已更新');
      } else {
        const created = await createLevel({
          code: String(values.code).trim(),
          name: values.name.trim(),
          scope: values.scope || 'user',
          price: Number(values.price),
          monthlyPoints: Number(values.monthlyPoints ?? 0),
          sort: Number(values.sort ?? 0),
          description: values.description?.trim() || undefined,
        });
        message.success('版本已创建');
        setSelectedLevelId(created.id);
      }
      setLevelOpen(false);
      void loadAll();
    } catch {
      // 表单校验或请求失败
    }
  };

  const handleDisableLevel = (row: LevelItem) => {
    Modal.confirm({
      title: `确认停用「${row.name}」？`,
      content: '停用后前台将不可再购买该版本，已有订阅不受影响。',
      onOk: async () => {
        await disableLevel(row.id);
        message.success('版本已停用');
        void loadAll();
      },
    });
  };

  const openCreatePlan = () => {
    if (!selectedLevelId) {
      message.warning('请先新增或选择一个会员版本');
      return;
    }
    setEditingPlan(null);
    planForm.setFieldsValue({
      levelId: selectedLevelId,
      packageType: 'monthly',
      name: '单月',
      tag: 'on_sale',
    });
    setPlanOpen(true);
  };

  const openEditPlan = (row: PackageItem) => {
    setEditingPlan(row);
    planForm.setFieldsValue({
      levelId: row.levelId,
      packageType: row.packageType,
      name: row.name,
      priceLabel: row.priceLabel ?? '',
      description: row.description ?? '',
      originalPrice: row.originalPrice ?? undefined,
      tag: row.tag,
      price: Number(row.price),
    });
    setPlanOpen(true);
  };

  const submitPlan = async () => {
    try {
      const values = await planForm.validateFields();
      const durationDays =
        PACKAGE_DURATION_DEFAULT[values.packageType as string] ?? 30;
      const shared = {
        name: values.name,
        price: values.price,
        originalPrice: values.originalPrice || undefined,
        priceLabel: values.priceLabel?.trim() || undefined,
        description: values.description || undefined,
        tag: values.tag,
        durationDays,
      };
      if (editingPlan) {
        // UpdatePackageDto 不允许 levelId / packageType，forbidNonWhitelisted 会 400
        await updatePackage(editingPlan.id, shared);
        message.success('套餐已更新');
      } else {
        await createPackage({
          ...shared,
          levelId: values.levelId,
          packageType: values.packageType,
        });
        message.success('套餐已创建');
      }
      setPlanOpen(false);
      void loadAll();
    } catch {
      // 表单校验或请求失败
    }
  };

  const handleOffShelf = (row: PackageItem) => {
    Modal.confirm({
      title: '确认下架该套餐？',
      onOk: async () => {
        await offShelfPackage(row.id);
        message.success('已下架');
        void loadAll();
      },
    });
  };

  const handleOnShelf = async (row: PackageItem) => {
    await onShelfPackage(row.id);
    message.success('已上架');
    void loadAll();
  };

  const showOrderDetail = async (row: OrderItem) => {
    const detail = await fetchOrderDetail(row.id);
    setDetailOrder(detail);
    setDetailOpen(true);
  };

  const handleCloseOrder = (row: OrderItem) => {
    Modal.confirm({
      title: '确认关闭该待支付订单？',
      onOk: async () => {
        await cancelOrder(row.id);
        message.success('订单已关闭');
        void loadAll();
      },
    });
  };

  const handleRefund = (row: OrderItem) => {
    setRefundOrder(row);
    refundForm.resetFields();
    setRefundOpen(true);
  };

  const submitRefund = async () => {
    if (!refundOrder) return;
    const values = await refundForm.validateFields();
    await refundOrderAction(refundOrder.id, values.reason);
    setRefundOpen(false);
    void loadAll();
  };

  const refundOrderAction = async (id: string, reason?: string) => {
    await refundOrderApi(id, reason);
    message.success('退款成功');
  };

  const handleReconcile = (row: OrderItem) => {
    Modal.confirm({
      title: '确认重新处理该回调异常订单？',
      onOk: async () => {
        await reconcileOrder(row.id);
        message.success('订单已处理');
        void loadAll();
      },
    });
  };

  const showRefundFlow = async (row: OrderItem) => {
    const refunds = await fetchOrderRefunds(row.id);
    Modal.info({
      title: '退款流水',
      width: 520,
      content: (
        <div className="membership-refund-list">
          {refunds.length === 0 ? (
            <Typography.Text type="secondary">暂无退款记录</Typography.Text>
          ) : (
            refunds.map((r) => (
              <div key={r.id} className="membership-refund-item">
                <div>{formatAmount(r.amount)}</div>
                <div className="membership-refund-meta">
                  {r.tradeNo ? `流水号 ${r.tradeNo}` : ''}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
                <div className="membership-refund-meta">{formatTime(r.refundedAt)}</div>
              </div>
            ))
          )}
        </div>
      ),
    });
  };

  const handleSendReminder = async (item: RenewalCandidate) => {
    await sendRenewalReminder(item.subscriptionId);
    message.success('提醒已发送');
    void loadAll();
  };

  const handleBatchRemind = async () => {
    const res = await batchSendReminders();
    message.success(`已发送 ${res.sent} 条提醒`);
    void loadAll();
  };

  const packageColumns: ColumnsType<PackageItem> = useMemo(
    () => [
      {
        title: '等级',
        dataIndex: ['level', 'name'],
        width: 90,
        render: (_, row) => row.level?.name ?? '—',
      },
      { title: '套餐', dataIndex: 'name', width: 100 },
      {
        title: '价格',
        dataIndex: 'priceLabel',
        width: 110,
        render: (_, row) =>
          row.priceLabel ?? formatAmount(row.price),
      },
      {
        title: '说明',
        dataIndex: 'description',
        ellipsis: true,
        render: (v) => v ?? '—',
      },
      {
        title: '原价',
        width: 80,
        render: (_, row) => {
          const origin = formatOriginalPrice(row.originalPrice);
          return origin ? (
            <span className="membership-origin-price">{origin}</span>
          ) : (
            '—'
          );
        },
      },
      {
        title: '标签',
        dataIndex: 'tag',
        width: 90,
        render: (tag: string) => {
          const meta = TAG_META[tag] ?? { label: tag, color: 'default' };
          return <Tag color={meta.color}>{meta.label}</Tag>;
        },
      },
      {
        title: '操作',
        width: 120,
        render: (_, row) => (
          <Space size={0} split={<span className="membership-action-split">|</span>}>
            <Button type="link" size="small" onClick={() => openEditPlan(row)}>
              编辑
            </Button>
            {row.tag !== 'off_shelf' ? (
              <Button
                type="link"
                size="small"
                className="membership-link-warning"
                onClick={() => handleOffShelf(row)}
              >
                下架
              </Button>
            ) : (
              <Button type="link" size="small" onClick={() => handleOnShelf(row)}>
                上架
              </Button>
            )}
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const orderColumns: ColumnsType<OrderItem> = useMemo(
    () => [
      { title: '订单号', dataIndex: 'orderNo', width: 150, ellipsis: true },
      {
        title: '用户',
        dataIndex: 'buyerUsername',
        width: 100,
        render: (v) => v ?? '—',
      },
      {
        title: '等级',
        dataIndex: 'levelTitle',
        width: 130,
        ellipsis: true,
        render: (v, row) => v ?? row.title ?? '—',
      },
      {
        title: '金额',
        dataIndex: 'amount',
        width: 90,
        render: (v) => formatAmount(v),
      },
      {
        title: '状态',
        dataIndex: 'status',
        width: 90,
        render: (status: string) => {
          const meta = ORDER_STATUS_META[status] ?? {
            label: status,
            color: 'default' as const,
          };
          return <Tag color={meta.color}>{meta.label}</Tag>;
        },
      },
      {
        title: '时间',
        width: 130,
        render: (_, row) => formatTime(row.paidAt ?? row.createdAt),
      },
      {
        title: '操作',
        width: 140,
        render: (_, row) => {
          const statusLabel =
            ORDER_STATUS_META[row.status]?.label ?? row.status;
          return (
            <Space size={0} wrap>
              <Button type="link" size="small" onClick={() => showOrderDetail(row)}>
                详情
              </Button>
              {statusLabel === '待支付' && (
                <Button
                  type="link"
                  size="small"
                  className="membership-link-warning"
                  onClick={() => handleCloseOrder(row)}
                >
                  关闭
                </Button>
              )}
              {statusLabel === '已支付' && (
                <Button
                  type="link"
                  size="small"
                  className="membership-link-warning"
                  onClick={() => handleRefund(row)}
                >
                  退款
                </Button>
              )}
              {statusLabel === '回调异常' && (
                <Button
                  type="link"
                  size="small"
                  danger
                  onClick={() => handleReconcile(row)}
                >
                  处理
                </Button>
              )}
              {statusLabel === '已退款' && (
                <Button type="link" size="small" onClick={() => showRefundFlow(row)}>
                  退款流水
                </Button>
              )}
            </Space>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <div className="membership-page admin-scroll-page">
      <section className="membership-section membership-points-section">
        <div className="membership-section-head membership-section-head--between">
          <div className="membership-section-head-left">
            <span className="membership-section-title">用户积分账户</span>
            <Tooltip title="积分余额、会员月赠积分、免费积分和本月消耗均来自实际账户流水">
              <InfoCircleOutlined className="membership-info-icon" />
            </Tooltip>
          </div>
          <span className="membership-subhead-meta">共 {pointTotal} 位用户</span>
        </div>
        <Table
          rowKey="userId"
          size="small"
          loading={loading}
          columns={pointAccountColumns}
          dataSource={pointAccounts}
          pagination={false}
          scroll={{ x: 1200 }}
          className="membership-table"
        />
      </section>

      <section className="membership-section membership-points-rules">
        <div className="membership-section-head membership-section-head--between">
          <div className="membership-section-head-left">
            <span className="membership-section-title">积分发放与计费规则</span>
            <Tooltip title="修改后立即作用于新发放与新扣费；已入账流水不受影响">
              <InfoCircleOutlined className="membership-info-icon" />
            </Tooltip>
          </div>
          <Space size={8}>
            {rulesEditing ? (
              <>
                <Button size="small" onClick={cancelEditRules} disabled={rulesSaving}>
                  取消
                </Button>
                <Button
                  type="primary"
                  size="small"
                  loading={rulesSaving}
                  onClick={() => void submitPointRules()}
                >
                  保存规则
                </Button>
              </>
            ) : (
              <Button type="primary" ghost size="small" onClick={beginEditRules} disabled={!pointRules}>
                编辑规则
              </Button>
            )}
          </Space>
        </div>
        {pointRules ? (
          <Form form={rulesForm} layout="vertical" disabled={!rulesEditing} className="membership-rules-form">
            <div className="membership-rules-block">
              <div className="membership-rules-block-head">
                <b>免费赠送</b>
                <span>注册、每月自动赠送与每日领取计入免费额度</span>
              </div>
              <div className="membership-rules-fields membership-rules-fields--4">
                <Form.Item
                  name="registrationPoints"
                  label="注册赠送"
                  rules={[{ required: true, message: '请输入注册赠送积分' }]}
                >
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="积分" />
                </Form.Item>
                <Form.Item
                  name="monthlyFreePoints"
                  label="每月自动赠送"
                  rules={[{ required: true, message: '请输入每月自动赠送积分' }]}
                >
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="积分" />
                </Form.Item>
                <Form.Item
                  name="dailyPoints"
                  label="每日可领取"
                  rules={[{ required: true, message: '请输入每日领取积分' }]}
                >
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="积分" />
                </Form.Item>
                <Form.Item
                  name="freeMonthlyLimit"
                  label="免费赠分月上限"
                  rules={[{ required: true, message: '请输入免费赠分上限' }]}
                  tooltip="注册、每月自动赠送与每日领取合计上限，免费与付费会员均适用"
                >
                  <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="积分" />
                </Form.Item>
              </div>
            </div>

            <div className="membership-rules-split">
              <div className="membership-rules-block">
                <div className="membership-rules-block-head">
                  <b>会员月度积分</b>
                  <span>按自然月发放，不受免费赠分上限约束</span>
                </div>
                {pointRules.levels.length === 0 ? (
                  <Typography.Text type="secondary">暂无会员版本，请先新增版本</Typography.Text>
                ) : (
                  <div className="membership-rules-fields membership-rules-fields--levels">
                    {pointRules.levels.map((level) => (
                      <Form.Item
                        key={level.id}
                        name={['levelMonthlyPoints', level.id]}
                        label={level.name}
                        rules={[{ required: true, message: '请输入月度积分' }]}
                      >
                        <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="积分/月" />
                      </Form.Item>
                    ))}
                  </div>
                )}
              </div>

              <div className="membership-rules-block">
                <div className="membership-rules-block-head">
                  <b>请求扣分</b>
                  <span>余额不足时拦截请求</span>
                </div>
                <div className="membership-rules-fields membership-rules-fields--2">
                  <Form.Item
                    name="minSearchPoints"
                    label="智搜最低积分"
                    rules={[{ required: true, message: '请输入智搜最低积分' }]}
                    tooltip="用户可用积分低于该值时禁止发起 AI 智搜；设为 0 表示不限制"
                  >
                    <InputNumber min={0} precision={0} style={{ width: '100%' }} addonAfter="积分" />
                  </Form.Item>
                  <Form.Item
                    name="yuanPerPoint"
                    label="积分折算单价"
                    rules={[{ required: true, message: '请输入积分折算单价' }]}
                    tooltip="用于将模型实际输入、输出 Token 成本折算为积分"
                  >
                    <InputNumber
                      min={0.000001}
                      step={0.001}
                      precision={6}
                      style={{ width: '100%' }}
                      addonBefore="¥"
                      addonAfter="/积分"
                    />
                  </Form.Item>
                </div>
                <Form.List name="modelPricing">
                  {(fields, { add, remove }) => (
                    <div className="membership-rules-block">
                      <div className="membership-rules-block-head">
                        <b>模型 Token 单价</b>
                        <Button size="small" icon={<PlusOutlined />} onClick={() => add({ model: '', inputYuanPerMillionTokens: 0, outputYuanPerMillionTokens: 0 })}>
                          添加模型
                        </Button>
                      </div>
                      <Typography.Text type="secondary">单位：元/百万 Token。模型名应与供应商返回的 model 一致；default 可作兜底。</Typography.Text>
                      {fields.map((field) => (
                        <Space key={field.key} align="start" style={{ display: 'flex', marginTop: 10 }}>
                          <Form.Item name={[field.name, 'model']} rules={[{ required: true, message: '请输入模型名' }]}>
                            <Input placeholder="例如 qwen3.7-plus-2026-05-26 或 default" />
                          </Form.Item>
                          <Form.Item name={[field.name, 'inputYuanPerMillionTokens']} rules={[{ required: true, message: '请输入输入单价' }]}>
                            <InputNumber min={0} precision={6} addonBefore="输入 ¥" addonAfter="/百万" />
                          </Form.Item>
                          <Form.Item name={[field.name, 'outputYuanPerMillionTokens']} rules={[{ required: true, message: '请输入输出单价' }]}>
                            <InputNumber min={0} precision={6} addonBefore="输出 ¥" addonAfter="/百万" />
                          </Form.Item>
                          <Button danger type="text" onClick={() => remove(field.name)}>删除</Button>
                        </Space>
                      ))}
                    </div>
                  )}
                </Form.List>
              </div>
            </div>
          </Form>
        ) : (
          <Typography.Text type="secondary">积分规则加载中…</Typography.Text>
        )}
      </section>

      <section className="membership-section">
        <div className="membership-section-head membership-section-head--between">
          <div className="membership-section-head-left">
            <span className="membership-section-title">会员版本</span>
            <Tooltip title="可新增多个会员版本（如专业版、旗舰版），再为每个版本配置套餐">
              <InfoCircleOutlined className="membership-info-icon" />
            </Tooltip>
          </div>
          <Button
            type="primary"
            ghost
            size="small"
            icon={<PlusOutlined />}
            onClick={openCreateLevel}
          >
            新增版本
          </Button>
        </div>

        {levels.length === 0 ? (
          <Typography.Text type="secondary">暂无会员版本，请先新增</Typography.Text>
        ) : (
          <div className="membership-level-tabs">
            {levels.map((item) => {
              const active = item.id === selectedLevelId;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`membership-level-tab${active ? ' membership-level-tab--active' : ''}`}
                  onClick={() => setSelectedLevelId(item.id)}
                >
                  <span>{item.name}</span>
                  <Tag
                    color={item.status === 'active' ? 'success' : 'default'}
                    style={{ marginInlineEnd: 0 }}
                  >
                    {item.status === 'active' ? '启用' : '停用'}
                  </Tag>
                </button>
              );
            })}
          </div>
        )}

        {selectedLevel && (
          <div className="membership-level-detail">
            <div className="membership-status-row">
              <CreditCardOutlined className="membership-status-icon" />
              <span>
                {selectedLevel.name}状态：
                {selectedLevel.status === 'active' ? '启用' : '停用'}
              </span>
              {selectedLevel.status === 'active' &&
                (overview?.level?.id === selectedLevel.id
                  ? overview.purchasable
                  : true) && <Tag color="success">可购买</Tag>}
              <span className="membership-level-points">
                月赠积分{' '}
                <b>{(selectedLevel.monthlyPoints ?? 0).toLocaleString()}</b>
              </span>
              <Space size={4} style={{ marginLeft: 'auto' }}>
                <Button type="link" size="small" onClick={() => openEditLevel(selectedLevel)}>
                  编辑版本
                </Button>
                {selectedLevel.status === 'active' && (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={() => handleDisableLevel(selectedLevel)}
                  >
                    停用
                  </Button>
                )}
              </Space>
            </div>
            <div className="membership-level-desc">
              <span className="membership-level-desc-label">说明</span>
              <span className="membership-level-desc-text">
                {selectedLevel.description?.trim() || '暂无说明'}
              </span>
            </div>
          </div>
        )}
      </section>

      <section className="membership-section">
        <div className="membership-section-head membership-section-head--between">
          <div className="membership-section-head-left">
            <span className="membership-section-title">会员套餐方案</span>
            <Tooltip
              title={
                selectedLevel
                  ? `当前版本：${selectedLevel.name} · 单月 / 连续包月 / 年付`
                  : '请先选择会员版本'
              }
            >
              <InfoCircleOutlined className="membership-info-icon" />
            </Tooltip>
          </div>
          <Button type="primary" ghost size="small" icon={<PlusOutlined />} onClick={openCreatePlan}>
            新增套餐
          </Button>
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          columns={packageColumns}
          dataSource={visiblePackages}
          pagination={false}
          scroll={{ x: 960 }}
          className="membership-table"
        />
      </section>

      <section className="membership-section">
        <Row gutter={12}>
          <Col xs={24} lg={14}>
            <div className="membership-subhead">
              <span className="membership-section-title">缴费订单</span>
              <span className="membership-subhead-meta">用户 · 等级 · 金额 · 支付状态</span>
            </div>
            <Table
              rowKey="id"
              size="small"
              loading={loading}
              columns={orderColumns}
              dataSource={orders}
              pagination={{
                current: orderPage,
                pageSize: orderPageSize,
                total: orderTotal,
                showSizeChanger: false,
                showTotal: (total) => `共 ${total} 条`,
                onChange: (page) => {
                  setLoading(true);
                  void loadOrders(page).finally(() => setLoading(false));
                },
              }}
              scroll={{ x: 760 }}
              className="membership-table"
            />
          </Col>
          <Col xs={24} lg={10}>
            <div className="membership-subhead membership-subhead--between">
              <div>
                <span className="membership-section-title">续费提醒</span>
                <span className="membership-subhead-meta">到期前 7 天触发</span>
              </div>
              <Button size="small" onClick={handleBatchRemind}>
                批量发起提醒
              </Button>
            </div>
            <div className="membership-renewal-list">
              {renewals.length === 0 && !loading && (
                <Typography.Text type="secondary">暂无即将到期会员</Typography.Text>
              )}
              {renewals.map((item) => (
                <div key={item.subscriptionId} className="membership-renewal-item">
                  <div className="membership-renewal-left">
                    <span
                      className={`membership-renewal-dot ${
                        item.inWindow ? 'membership-renewal-dot--warn' : 'membership-renewal-dot--ok'
                      }`}
                    />
                    <div>
                      <div className="membership-renewal-title">
                        {item.username} · {item.levelName}
                      </div>
                      <div className="membership-renewal-desc">{item.desc}</div>
                    </div>
                  </div>
                  {item.action && (
                    <Button
                      type="link"
                      size="small"
                      onClick={() => handleSendReminder(item)}
                    >
                      {item.action}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Col>
        </Row>
      </section>

      <Modal
        title={pointLedgerTitle}
        open={pointLedgerOpen}
        footer={null}
        width={760}
        onCancel={() => setPointLedgerOpen(false)}
      >
        <Table
          rowKey="id"
          size="small"
          dataSource={pointLedgers}
          pagination={false}
          columns={[
            { title: '说明', dataIndex: 'description' },
            { title: '来源', dataIndex: 'source' },
            { title: '积分变动', dataIndex: 'amount', render: (value: number) => <span className={value > 0 ? 'membership-points-income' : 'membership-points-consumed'}>{value > 0 ? '+' : ''}{value}</span> },
            { title: '余额', dataIndex: 'balanceAfter' },
            { title: '时间', dataIndex: 'createdAt', render: formatTime },
          ]}
        />
      </Modal>

      <Modal
        {...withFormModal({
          title: editingLevel ? '编辑会员版本' : '新增会员版本',
          open: levelOpen,
          width: FORM_MODAL_WIDTH,
          onCancel: () => setLevelOpen(false),
          onOk: () => void submitLevel(),
        })}
      >
        <Form form={levelForm} labelCol={{ span: 5 }} wrapperCol={{ span: 19 }}>
          {!editingLevel && (
            <Form.Item
              name="code"
              label="编码"
              rules={[
                { required: true, message: '请输入编码' },
                {
                  pattern: /^[a-z][a-z0-9_]{1,31}$/,
                  message: '小写字母开头，仅含小写字母/数字/下划线',
                },
              ]}
            >
              <Input placeholder="如：flagship" />
            </Form.Item>
          )}
          <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="如：旗舰版" />
          </Form.Item>
          <Form.Item name="scope" hidden initialValue="user">
            <Input />
          </Form.Item>
          <Form.Item name="price" label="标价" rules={[{ required: true, message: '请输入标价' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} placeholder="兼容字段，套餐价为准" />
          </Form.Item>
          <Form.Item
            name="monthlyPoints"
            label="月赠积分"
            rules={[{ required: true, message: '请输入会员月度积分' }]}
          >
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder="按自然月发放" />
          </Form.Item>
          {!editingLevel && (
            <Form.Item name="sort" label="排序">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          )}
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          title: editingPlan ? '编辑套餐' : '新增套餐',
          open: planOpen,
          width: FORM_MODAL_WIDTH,
          onCancel: () => setPlanOpen(false),
          onOk: submitPlan,
        })}
      >
        <Form form={planForm} labelCol={{ span: 5 }} wrapperCol={{ span: 19 }}>
          <Form.Item name="levelId" label="等级" rules={[{ required: true }]}>
            <Select
              disabled={!!editingPlan}
              options={levelOptions}
              placeholder="选择会员版本"
            />
          </Form.Item>
          <Form.Item name="packageType" label="套餐" rules={[{ required: true }]}>
            <Select
              options={PACKAGE_TYPE_OPTIONS}
              disabled={!!editingPlan}
              onChange={(v) => {
                planForm.setFieldValue('name', PACKAGE_TYPE_LABEL[v] ?? v);
              }}
            />
          </Form.Item>
          <Form.Item name="name" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            name="price"
            label="价格"
            rules={[{ required: true, message: '请输入价格' }]}
          >
            <InputNumberLike placeholder="如：59" />
          </Form.Item>
          <Form.Item name="priceLabel" label="展示价">
            <Input placeholder="如：¥59 / 月" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input placeholder="如：单次购买，随用随付" />
          </Form.Item>
          <Form.Item name="originalPrice" label="原价">
            <InputNumberLike placeholder="年付划线价，如：708（非年付可留空）" />
          </Form.Item>
          <Form.Item name="tag" label="标签" rules={[{ required: true }]}>
            <Radio.Group options={TAG_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="订单详情"
        open={detailOpen}
        footer={null}
        onCancel={() => setDetailOpen(false)}
        width={560}
      >
        {detailOrder && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="订单号">{detailOrder.orderNo}</Descriptions.Item>
            <Descriptions.Item label="用户">{detailOrder.buyerUsername}</Descriptions.Item>
            <Descriptions.Item label="等级">{detailOrder.levelTitle}</Descriptions.Item>
            <Descriptions.Item label="金额">{formatAmount(detailOrder.amount)}</Descriptions.Item>
            <Descriptions.Item label="状态">
              {ORDER_STATUS_META[detailOrder.status]?.label ?? detailOrder.status}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {formatTime(detailOrder.createdAt)}
            </Descriptions.Item>
            <Descriptions.Item label="支付时间">
              {formatTime(detailOrder.paidAt)}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>

      <Modal
        title="确认退款"
        open={refundOpen}
        onCancel={() => setRefundOpen(false)}
        onOk={submitRefund}
        width={FORM_MODAL_WIDTH}
      >
        <Form form={refundForm} layout="vertical">
          <Form.Item name="reason" label="退款原因">
            <Input.TextArea rows={3} placeholder="可选填写退款原因" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/** 数字输入（兼容 Form 字符串/数字） */
function InputNumberLike({
  value,
  onChange,
  placeholder,
}: {
  value?: string | number;
  onChange?: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <InputNumber
      min={0}
      step={0.01}
      precision={2}
      style={{ width: '100%' }}
      placeholder={placeholder}
      value={value === undefined || value === '' ? null : Number(value)}
      onChange={(next) => onChange?.(next ?? undefined)}
    />
  );
}
