import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  message,
} from 'antd';
import { useEffect, useState } from 'react';
import {
  applyInvoice,
  cancelOrder,
  createOrder,
  fetchInvoices,
  fetchLevels,
  fetchOrders,
  fetchPayments,
  fetchReminders,
  fetchUsers,
  issueInvoice,
  mockPay,
  scheduleReminders,
  type OrderItem,
} from '../api/admin';
import { withFormModal } from '../components/form-modal';

/**
 * 会员缴费管理：订单、支付记录、续费提醒、发票。
 */
export function OrdersPage() {
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof fetchOrders>> | null>(
    null,
  );
  const [payments, setPayments] = useState<Awaited<
    ReturnType<typeof fetchPayments>
  > | null>(null);
  const [invoices, setInvoices] = useState<Awaited<
    ReturnType<typeof fetchInvoices>
  > | null>(null);
  const [reminders, setReminders] = useState<Awaited<
    ReturnType<typeof fetchReminders>
  > | null>(null);
  const [orderOpen, setOrderOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [currentOrder, setCurrentOrder] = useState<OrderItem | null>(null);
  const [levels, setLevels] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [users, setUsers] = useState<Array<{ value: string; label: string }>>(
    [],
  );
  const [orderForm] = Form.useForm();
  const [invoiceForm] = Form.useForm();

  const loadAll = async () => {
    const [o, p, i, r] = await Promise.all([
      fetchOrders({ page: 1, pageSize: 20 }),
      fetchPayments({ page: 1, pageSize: 20 }),
      fetchInvoices({ page: 1, pageSize: 20 }),
      fetchReminders({ page: 1, pageSize: 20 }),
    ]);
    setOrders(o);
    setPayments(p);
    setInvoices(i);
    setReminders(r);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const openCreateOrder = async () => {
    const [levelPage, userPage] = await Promise.all([
      fetchLevels({ page: 1, pageSize: 50 }),
      fetchUsers({ page: 1, pageSize: 100 }),
    ]);
    setLevels(
      levelPage.items
        .filter((l) => l.status === 'active' && l.code !== 'free')
        .map((l) => ({
          value: l.id,
          label: `${l.name}（¥${l.price} / ${l.durationDays}天）`,
        })),
    );
    setUsers(
      userPage.items.map((u) => ({
        value: u.id,
        label: `${u.username}${u.displayName ? ` (${u.displayName})` : ''}`,
      })),
    );
    orderForm.resetFields();
    orderForm.setFieldsValue({ buyerType: 'user' });
    setOrderOpen(true);
  };

  const submitOrder = async () => {
    const values = await orderForm.validateFields();
    const created = (await createOrder(values)) as { orderNo: string };
    message.success(`订单已创建：${created.orderNo}`);
    setOrderOpen(false);
    await loadAll();
  };

  return (
    <div>
      <Tabs
        items={[
          {
            key: 'orders',
            label: '订单管理',
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Button type="primary" onClick={() => void openCreateOrder()}>
                    新建订单
                  </Button>
                  <Button onClick={() => void loadAll()}>刷新</Button>
                </Space>
                <Table
                  rowKey="id"
                  dataSource={orders?.items ?? []}
                  scroll={{ x: 1100 }}
                  columns={[
                    { title: '订单号', dataIndex: 'orderNo' },
                    { title: '买方类型', dataIndex: 'buyerType' },
                    { title: '金额', dataIndex: 'amount' },
                    { title: '状态', dataIndex: 'status' },
                    { title: '支付时间', dataIndex: 'paidAt' },
                    {
                      title: '操作',
                      width: 280,
                      render: (_, row) => (
                        <Space wrap>
                          {row.status === 'pending' ? (
                            <>
                              <Button
                                size="small"
                                type="primary"
                                onClick={async () => {
                                  await mockPay(row.orderNo);
                                  message.success('Mock 支付成功');
                                  await loadAll();
                                }}
                              >
                                模拟支付
                              </Button>
                              <Button
                                size="small"
                                danger
                                onClick={async () => {
                                  await cancelOrder(row.id);
                                  message.success('已取消');
                                  await loadAll();
                                }}
                              >
                                取消
                              </Button>
                            </>
                          ) : null}
                          {row.status === 'paid' ? (
                            <Button
                              size="small"
                              onClick={() => {
                                setCurrentOrder(row);
                                invoiceForm.resetFields();
                                setInvoiceOpen(true);
                              }}
                            >
                              申请发票
                            </Button>
                          ) : null}
                        </Space>
                      ),
                    },
                  ]}
                />
              </>
            ),
          },
          {
            key: 'payments',
            label: '支付记录',
            children: (
              <Table
                rowKey="id"
                dataSource={(payments?.items ?? []) as Array<Record<string, unknown>>}
                columns={[
                  { title: '交易号', dataIndex: 'tradeNo' },
                  { title: '渠道', dataIndex: 'channel' },
                  { title: '金额', dataIndex: 'amount' },
                  { title: '状态', dataIndex: 'status' },
                  { title: '支付时间', dataIndex: 'paidAt' },
                  {
                    title: '订单号',
                    render: (_, row) =>
                      (row.order as { orderNo?: string } | undefined)?.orderNo ??
                      '-',
                  },
                ]}
              />
            ),
          },
          {
            key: 'invoices',
            label: '发票管理',
            children: (
              <Table
                rowKey="id"
                dataSource={(invoices?.items ?? []) as Array<Record<string, unknown>>}
                scroll={{ x: 880 }}
                columns={[
                  { title: '抬头', dataIndex: 'title' },
                  { title: '税号', dataIndex: 'taxNo' },
                  { title: '状态', dataIndex: 'status' },
                  { title: '开票时间', dataIndex: 'issuedAt' },
                  {
                    title: '操作',
                    render: (_, row) =>
                      row.status === 'pending' ? (
                        <Button
                          size="small"
                          type="primary"
                          onClick={async () => {
                            await issueInvoice(String(row.id));
                            message.success('已开票');
                            await loadAll();
                          }}
                        >
                          开具
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ),
          },
          {
            key: 'reminders',
            label: '续费提醒',
            children: (
              <>
                <Space style={{ marginBottom: 16 }}>
                  <Button
                    type="primary"
                    onClick={async () => {
                      const result = await scheduleReminders();
                      message.success(`已生成 ${result.created} 条提醒`);
                      await loadAll();
                    }}
                  >
                    生成续费提醒
                  </Button>
                </Space>
                <Table
                  rowKey="id"
                  dataSource={
                    (reminders?.items ?? []) as Array<Record<string, unknown>>
                  }
                  columns={[
                    { title: '订阅类型', dataIndex: 'subscriptionType' },
                    { title: '订阅ID', dataIndex: 'subscriptionId' },
                    { title: '提醒时间', dataIndex: 'remindAt' },
                    { title: '发送时间', dataIndex: 'sentAt' },
                    { title: '通道', dataIndex: 'channel' },
                  ]}
                />
              </>
            ),
          },
        ]}
      />

      <Modal
        {...withFormModal({
          title: '新建会员订单',
          open: orderOpen,
          onOk: () => void submitOrder(),
          onCancel: () => setOrderOpen(false),
        })}
      >
        <Form form={orderForm} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="buyerType"
            label="买方类型"
            initialValue="user"
            rules={[{ required: true }]}
            hidden
          >
            <Input />
          </Form.Item>
          <Form.Item
            name="buyerId"
            label="用户"
            rules={[{ required: true, message: '请选择用户' }]}
          >
            <Select showSearch optionFilterProp="label" options={users} />
          </Form.Item>
          <Form.Item name="levelId" label="会员等级" rules={[{ required: true }]}>
            <Select options={levels} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          title: `申请发票 - ${currentOrder?.orderNo ?? ''}`,
          open: invoiceOpen,
          onOk: async () => {
            if (!currentOrder) return;
            const values = await invoiceForm.validateFields();
            await applyInvoice({
              orderId: currentOrder.id,
              title: values.title,
              taxNo: values.taxNo,
            });
            message.success('已申请发票');
            setInvoiceOpen(false);
            await loadAll();
          },
          onCancel: () => setInvoiceOpen(false),
        })}
      >
        <Form form={invoiceForm} layout="vertical" className="admin-form-grid">
          <Form.Item name="title" label="发票抬头" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="taxNo" label="税号">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
