import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  cancelOrder,
  fetchOrderDetail,
  fetchOrders,
  reconcileOrder,
  refundOrder as refundOrderApi,
  type OrderItem,
} from '../api/admin';
import { useSessionStore } from '../stores/session';

/** 订单状态（与 OrderStatus 对齐；failed 展示为问题异常） */
type PayOrderStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cancelled';

type PayChannelCode = 'wechat' | 'alipay';

type MockChannel = {
  id: string;
  code: PayChannelCode;
  name: string;
  merchantId: string;
  callbackUrl: string;
  status: 'active' | 'disabled';
};

type MockCredential = {
  id: string;
  channelCode: PayChannelCode;
  channelName: string;
  keyStatus: 'configured' | 'missing' | 'expired';
  lastRotatedAt: string;
};

const CHANNEL_LABEL: Record<string, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  mock: '模拟支付',
};

const ORDER_STATUS_META: Record<
  string,
  { label: string; color: string }
> = {
  pending: { label: '待支付', color: 'warning' },
  paid: { label: '已支付', color: 'success' },
  failed: { label: '问题异常', color: 'error' },
  refunded: { label: '已退款', color: 'default' },
  cancelled: { label: '已关闭', color: 'default' },
};

const MOCK_CHANNELS: MockChannel[] = [
  {
    id: 'seed-pay-channel-wechat',
    code: 'wechat',
    name: '微信支付',
    merchantId: 'wx_merchant_88231',
    callbackUrl: 'https://research.example.com/pay/callback/wx',
    status: 'active',
  },
  {
    id: 'seed-pay-channel-alipay',
    code: 'alipay',
    name: '支付宝',
    merchantId: 'ali_merchant_55201',
    callbackUrl: 'https://research.example.com/pay/callback/ali',
    status: 'active',
  },
];

const MOCK_CREDENTIALS: MockCredential[] = [
  {
    id: 'seed-pay-cred-wechat',
    channelCode: 'wechat',
    channelName: '微信支付',
    keyStatus: 'configured',
    lastRotatedAt: '2024-06-01',
  },
  {
    id: 'seed-pay-cred-alipay',
    channelCode: 'alipay',
    channelName: '支付宝',
    keyStatus: 'configured',
    lastRotatedAt: '2024-06-01',
  },
];

function formatAmount(value: string | number) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (Number.isNaN(n)) return `¥${value}`;
  return `¥${n.toFixed(2)}`;
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 支付中心：订单管理（真实会员订单）+ 支付渠道配置（占位）。
 */
export function PaymentCenterPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const [tab, setTab] = useState('orders');
  const [channels, setChannels] = useState(MOCK_CHANNELS);
  const [credentials, setCredentials] = useState(MOCK_CREDENTIALS);

  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<PayOrderStatus | 'all'>(
    'all',
  );
  const [channelFilter, setChannelFilter] = useState<PayChannelCode | 'all'>(
    'all',
  );

  const [channelModalOpen, setChannelModalOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<MockChannel | null>(
    null,
  );
  const [channelForm] = Form.useForm();

  const [keyModalOpen, setKeyModalOpen] = useState(false);
  const [keyTarget, setKeyTarget] = useState<MockCredential | null>(null);
  const [keyForm] = Form.useForm();

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderItem | null>(null);

  const [refundOpen, setRefundOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<OrderItem | null>(null);
  const [refundForm] = Form.useForm();

  const loadOrders = useCallback(
    async (nextPage = page, nextPageSize = pageSize) => {
      setLoading(true);
      try {
        const res = await fetchOrders({
          page: nextPage,
          pageSize: nextPageSize,
          keyword: keyword.trim() || undefined,
          status: statusFilter === 'all' ? undefined : statusFilter,
          paymentChannel:
            channelFilter === 'all' ? undefined : channelFilter,
        });
        setOrders(res.items);
        setTotal(res.total);
        setPage(res.page);
        setPageSize(res.pageSize);
      } catch {
        message.error('加载订单失败');
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, keyword, statusFilter, channelFilter],
  );

  useEffect(() => {
    void loadOrders(1, pageSize);
    // 初次加载；筛选变更通过搜索/重置触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placeholder = (action: string) => {
    message.info(`${action}（占位，待对接支付 API）`);
  };

  const openChannelModal = (row?: MockChannel) => {
    setEditingChannel(row ?? null);
    channelForm.setFieldsValue(
      row ?? {
        code: 'wechat',
        name: '',
        merchantId: '',
        callbackUrl: '',
        status: 'active',
      },
    );
    setChannelModalOpen(true);
  };

  const submitChannel = async () => {
    const values = await channelForm.validateFields();
    if (editingChannel) {
      setChannels((prev) =>
        prev.map((c) =>
          c.id === editingChannel.id ? { ...c, ...values } : c,
        ),
      );
      message.success('渠道已更新（本地占位）');
    } else {
      const code = values.code as PayChannelCode;
      setChannels((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          code,
          name: values.name,
          merchantId: values.merchantId,
          callbackUrl: values.callbackUrl,
          status: values.status,
        },
      ]);
      setCredentials((prev) => [
        ...prev,
        {
          id: `local-cred-${Date.now()}`,
          channelCode: code,
          channelName: values.name,
          keyStatus: 'missing',
          lastRotatedAt: '-',
        },
      ]);
      message.success('渠道已新增（本地占位）');
    }
    setChannelModalOpen(false);
  };

  const toggleChannel = (row: MockChannel) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    setChannels((prev) =>
      prev.map((c) => (c.id === row.id ? { ...c, status: next } : c)),
    );
    message.success(next === 'active' ? '已启用（本地占位）' : '已停用（本地占位）');
  };

  const openKeyModal = (row: MockCredential) => {
    setKeyTarget(row);
    keyForm.resetFields();
    setKeyModalOpen(true);
  };

  const submitKey = async () => {
    await keyForm.validateFields();
    if (!keyTarget) return;
    const today = new Date().toISOString().slice(0, 10);
    setCredentials((prev) =>
      prev.map((c) =>
        c.id === keyTarget.id
          ? { ...c, keyStatus: 'configured', lastRotatedAt: today }
          : c,
      ),
    );
    message.success('密钥已更新（本地占位，明文不会展示）');
    setKeyModalOpen(false);
  };

  const rotateKey = (row: MockCredential) => {
    Modal.confirm({
      title: `轮换「${row.channelName}」密钥？`,
      content: '轮换后旧密钥立即失效；操作将记入审计日志（占位）。',
      onOk: () => {
        const today = new Date().toISOString().slice(0, 10);
        setCredentials((prev) =>
          prev.map((c) =>
            c.id === row.id
              ? { ...c, keyStatus: 'configured', lastRotatedAt: today }
              : c,
          ),
        );
        message.success('已轮换（本地占位）');
      },
    });
  };

  const showOrderDetail = async (row: OrderItem) => {
    try {
      const detail = await fetchOrderDetail(row.id);
      setDetailOrder(detail);
      setDetailOpen(true);
    } catch {
      message.error('加载订单详情失败');
    }
  };

  const handleCloseOrder = (row: OrderItem) => {
    Modal.confirm({
      title: '关闭该待支付订单？',
      onOk: async () => {
        await cancelOrder(row.id);
        message.success('订单已关闭');
        void loadOrders(page, pageSize);
      },
    });
  };

  const openRefund = (row: OrderItem) => {
    setRefundTarget(row);
    refundForm.resetFields();
    setRefundOpen(true);
  };

  const submitRefund = async () => {
    const values = await refundForm.validateFields();
    if (!refundTarget) return;
    try {
      await refundOrderApi(refundTarget.id, values.reason);
      message.success('退款成功');
      setRefundOpen(false);
      void loadOrders(page, pageSize);
    } catch {
      message.error('退款失败');
    }
  };

  const handleReconcile = (row: OrderItem) => {
    Modal.confirm({
      title: '确认重新处理该异常订单？',
      onOk: async () => {
        await reconcileOrder(row.id);
        message.success('订单已处理');
        void loadOrders(page, pageSize);
      },
    });
  };

  const orderColumns: ColumnsType<OrderItem> = [
    { title: '订单号', dataIndex: 'orderNo', width: 180 },
    {
      title: '用户',
      width: 160,
      render: (_, row) => (
        <span>
          {row.buyerUsername ?? row.buyerId}{' '}
          {row.buyerDisplayName ? (
            <Typography.Text type="warning">
              {row.buyerDisplayName}
            </Typography.Text>
          ) : null}
        </span>
      ),
    },
    {
      title: '类型',
      ellipsis: true,
      render: (_, row) =>
        row.levelTitle ??
        row.title ??
        (row.package
          ? `${row.level?.name ?? ''} · ${row.package.name}`
          : (row.level?.name ?? '-')),
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 100,
      render: (v: string | number) => formatAmount(v),
    },
    {
      title: '渠道',
      width: 110,
      render: (_, row) => {
        const ch = row.channel ?? row.paymentChannel;
        if (!ch) return <Typography.Text type="secondary">-</Typography.Text>;
        return CHANNEL_LABEL[ch] ?? ch;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: string) => {
        const meta = ORDER_STATUS_META[v] ?? {
          label: v,
          color: 'default',
        };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '时间',
      width: 160,
      render: (_, row) => formatTime(row.paidAt ?? row.createdAt),
    },
    {
      title: '操作',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space size="middle">
          <Typography.Link onClick={() => void showOrderDetail(row)}>
            详情
          </Typography.Link>
          {row.status === 'pending' &&
          hasPermission('button:payment:order:close') ? (
            <Typography.Link onClick={() => handleCloseOrder(row)}>
              关闭
            </Typography.Link>
          ) : null}
          {row.status === 'paid' &&
          hasPermission('button:payment:order:refund') ? (
            <Typography.Link onClick={() => openRefund(row)}>
              退款
            </Typography.Link>
          ) : null}
          {row.status === 'failed' &&
          hasPermission('button:payment:order:process') ? (
            <Typography.Link onClick={() => handleReconcile(row)}>
              处理
            </Typography.Link>
          ) : null}
        </Space>
      ),
    },
  ];

  const channelColumns: ColumnsType<MockChannel> = [
    { title: '渠道', dataIndex: 'name', width: 140 },
    { title: '商户号', dataIndex: 'merchantId', width: 200 },
    { title: '回调地址', dataIndex: 'callbackUrl', ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: MockChannel['status']) =>
        v === 'active' ? (
          <Tag color="success">启用</Tag>
        ) : (
          <Tag>停用</Tag>
        ),
    },
    {
      title: '操作',
      width: 200,
      render: (_, row) => (
        <Space size="middle">
          {hasPermission('button:payment:channel:update') ? (
            <Typography.Link onClick={() => openChannelModal(row)}>
              编辑
            </Typography.Link>
          ) : null}
          {hasPermission('button:payment:credential:update') ? (
            <Typography.Link
              onClick={() => {
                const cred = credentials.find((c) => c.channelCode === row.code);
                if (cred) openKeyModal(cred);
                else placeholder('密钥');
              }}
            >
              密钥
            </Typography.Link>
          ) : null}
          {hasPermission('button:payment:channel:disable') ? (
            <Typography.Link onClick={() => toggleChannel(row)}>
              {row.status === 'active' ? '停用' : '启用'}
            </Typography.Link>
          ) : null}
        </Space>
      ),
    },
  ];

  const credentialColumns: ColumnsType<MockCredential> = [
    { title: '渠道', dataIndex: 'channelName', width: 140 },
    {
      title: '密钥状态',
      dataIndex: 'keyStatus',
      width: 120,
      render: (v: MockCredential['keyStatus']) => {
        if (v === 'configured') return <Tag color="processing">已配置</Tag>;
        if (v === 'expired') return <Tag color="error">已过期</Tag>;
        return <Tag>未配置</Tag>;
      },
    },
    { title: '上次轮换', dataIndex: 'lastRotatedAt', width: 140 },
    {
      title: '操作',
      width: 180,
      render: (_, row) =>
        hasPermission('button:payment:credential:update') ? (
          <Space size="middle">
            <Typography.Link onClick={() => openKeyModal(row)}>
              更新密钥
            </Typography.Link>
            <Typography.Link onClick={() => rotateKey(row)}>轮换</Typography.Link>
          </Space>
        ) : null,
    },
  ];

  return (
    <div className="admin-scroll-page">
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        订单与支付渠道管理
      </Typography.Title>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'orders',
            label: '订单管理',
            children: (
              <Space direction="vertical" size={16} style={{ width: '100%' }}>
                <Alert
                  type="warning"
                  showIcon
                  message="退款需二次确认并记录原因；退款后状态变为「已退款」。未支付订单超过 30 分钟自动关闭。"
                />

                <Space wrap>
                  <Input
                    allowClear
                    placeholder="订单号 / 用户 / 标题"
                    style={{ width: 200 }}
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onPressEnter={() => void loadOrders(1, pageSize)}
                  />
                  <Select
                    value={statusFilter}
                    style={{ width: 140 }}
                    onChange={setStatusFilter}
                    options={[
                      { value: 'all', label: '全部状态' },
                      { value: 'pending', label: '待支付' },
                      { value: 'paid', label: '已支付' },
                      { value: 'failed', label: '问题异常' },
                      { value: 'refunded', label: '已退款' },
                      { value: 'cancelled', label: '已关闭' },
                    ]}
                  />
                  <Select
                    value={channelFilter}
                    style={{ width: 140 }}
                    onChange={setChannelFilter}
                    options={[
                      { value: 'all', label: '全部渠道' },
                      { value: 'wechat', label: '微信支付' },
                      { value: 'alipay', label: '支付宝' },
                    ]}
                  />
                  <Button
                    type="primary"
                    icon={<SearchOutlined />}
                    onClick={() => void loadOrders(1, pageSize)}
                  >
                    搜索
                  </Button>
                  <Button
                    onClick={() => {
                      setKeyword('');
                      setStatusFilter('all');
                      setChannelFilter('all');
                      void fetchOrders({ page: 1, pageSize }).then((res) => {
                        setOrders(res.items);
                        setTotal(res.total);
                        setPage(res.page);
                      }).catch(() => message.error('加载订单失败'));
                    }}
                  >
                    重置
                  </Button>
                  <Button
                    icon={<ReloadOutlined />}
                    loading={loading}
                    onClick={() => void loadOrders(page, pageSize)}
                  />
                </Space>

                <Typography.Text strong>订单列表</Typography.Text>
                <Table
                  rowKey="id"
                  size="middle"
                  loading={loading}
                  dataSource={orders}
                  columns={orderColumns}
                  pagination={{
                    current: page,
                    pageSize,
                    total,
                    showSizeChanger: true,
                    showTotal: (t) => `共 ${t} 条`,
                    onChange: (p, ps) => {
                      void loadOrders(p, ps);
                    },
                  }}
                  scroll={{ x: 1100 }}
                />
              </Space>
            ),
          },
          {
            key: 'channels',
            label: '支付渠道配置',
            children: (
              <Space direction="vertical" size={24} style={{ width: '100%' }}>
                <div>
                  <Space
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      marginBottom: 12,
                    }}
                  >
                    <Typography.Text strong>支付渠道</Typography.Text>
                    {hasPermission('button:payment:channel:create') ? (
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={() => openChannelModal()}
                      >
                        新增渠道
                      </Button>
                    ) : null}
                  </Space>
                  <Table
                    rowKey="id"
                    size="middle"
                    dataSource={channels}
                    columns={channelColumns}
                    pagination={false}
                    scroll={{ x: 900 }}
                  />
                </div>

                <div>
                  <Typography.Text strong style={{ display: 'block', marginBottom: 12 }}>
                    密钥管理
                  </Typography.Text>
                  <Table
                    rowKey="id"
                    size="middle"
                    dataSource={credentials}
                    columns={credentialColumns}
                    pagination={false}
                  />
                </div>

                <Alert
                  type="info"
                  showIcon
                  message="密钥不得明文展示；相关操作记入审计日志。渠道回调失败或密钥过期将触发告警并需人工核查。"
                />
              </Space>
            ),
          },
        ].filter((item) => item.key !== 'channels')}
      />

      <Modal
        title={editingChannel ? '编辑支付渠道' : '新增支付渠道'}
        open={channelModalOpen}
        onCancel={() => setChannelModalOpen(false)}
        onOk={() => void submitChannel()}
        destroyOnClose
      >
        <Form form={channelForm} layout="vertical">
          <Form.Item
            name="code"
            label="渠道编码"
            rules={[{ required: true, message: '请选择渠道编码' }]}
          >
            <Select
              disabled={Boolean(editingChannel)}
              options={[
                { value: 'wechat', label: 'wechat（微信支付）' },
                { value: 'alipay', label: 'alipay（支付宝）' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="渠道名称"
            rules={[{ required: true, message: '请输入渠道名称' }]}
          >
            <Input placeholder="如 微信支付" />
          </Form.Item>
          <Form.Item
            name="merchantId"
            label="商户号"
            rules={[{ required: true, message: '请输入商户号' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="callbackUrl"
            label="回调地址"
            rules={[
              { required: true, message: '请输入回调地址' },
              { type: 'url', message: '请输入合法 URL' },
            ]}
          >
            <Input />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Select
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={keyTarget ? `更新密钥 · ${keyTarget.channelName}` : '更新密钥'}
        open={keyModalOpen}
        onCancel={() => setKeyModalOpen(false)}
        onOk={() => void submitKey()}
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="提交后仅保存密文，页面不会回显密钥内容。"
        />
        <Form form={keyForm} layout="vertical">
          <Form.Item
            name="apiKey"
            label="API Key / 商户密钥"
            rules={[{ required: true, message: '请输入密钥' }]}
          >
            <Input.Password placeholder="不会明文落库与回显" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="订单详情"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={560}
        destroyOnClose
      >
        {detailOrder ? (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="订单号">
              {detailOrder.orderNo}
            </Descriptions.Item>
            <Descriptions.Item label="用户">
              {detailOrder.buyerUsername ?? detailOrder.buyerId}
              {detailOrder.buyerDisplayName
                ? `（${detailOrder.buyerDisplayName}）`
                : ''}
            </Descriptions.Item>
            <Descriptions.Item label="套餐">
              {detailOrder.levelTitle ??
                detailOrder.title ??
                detailOrder.level?.name ??
                '-'}
            </Descriptions.Item>
            <Descriptions.Item label="金额">
              {formatAmount(detailOrder.amount)}
            </Descriptions.Item>
            <Descriptions.Item label="渠道">
              {CHANNEL_LABEL[
                detailOrder.channel ?? detailOrder.paymentChannel ?? ''
              ] ??
                detailOrder.channel ??
                detailOrder.paymentChannel ??
                '-'}
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              {ORDER_STATUS_META[detailOrder.status]?.label ??
                detailOrder.status}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {formatTime(detailOrder.createdAt)}
            </Descriptions.Item>
            <Descriptions.Item label="支付时间">
              {formatTime(detailOrder.paidAt)}
            </Descriptions.Item>
          </Descriptions>
        ) : null}
      </Modal>

      <Modal
        title="确认退款"
        open={refundOpen}
        onCancel={() => setRefundOpen(false)}
        onOk={() => void submitRefund()}
        okText="确认退款"
        okButtonProps={{ danger: true }}
        destroyOnClose
      >
        <Typography.Paragraph>
          订单 {refundTarget?.orderNo}，金额{' '}
          {refundTarget ? formatAmount(refundTarget.amount) : ''}
        </Typography.Paragraph>
        <Form form={refundForm} layout="vertical">
          <Form.Item
            name="reason"
            label="退款原因"
            rules={[{ required: true, message: '请填写退款原因' }]}
          >
            <Input.TextArea rows={3} placeholder="退款需记录原因" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
    </div>
  );
}
