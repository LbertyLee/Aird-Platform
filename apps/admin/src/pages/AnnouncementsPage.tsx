import { PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  createAnnouncement,
  fetchAnnouncements,
  fetchBusinessNotifications,
  fetchRoles,
  markNotificationRead,
  publishAnnouncement,
  recallAnnouncement,
  republishAnnouncement,
  resendNotification,
  updateAnnouncement,
  type AnnouncementItem,
  type AnnouncementListResult,
  type BusinessNotificationItem,
  type PageResult,
} from '../api/admin';
import { withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';

const AUDIENCE_LABEL: Record<string, string> = {
  all_users: '全部用户',
  specified_roles: '指定角色',
  pro_members: '专业版会员',
};

const STATUS_META: Record<
  string,
  { label: string; color: 'success' | 'default' | 'warning' }
> = {
  published: { label: '已发布', color: 'success' },
  recalled: { label: '已撤回', color: 'default' },
  draft: { label: '草稿', color: 'warning' },
};

const NOTIF_BIZ_META: Record<
  string,
  { label: string; color: string }
> = {
  announcement: { label: '平台公告', color: 'processing' },
  payment_success: { label: '支付成功', color: 'success' },
  membership_activated: { label: '会员开通', color: 'gold' },
  refund: { label: '退款成功', color: 'orange' },
  report_ready: { label: '报告生成', color: 'blue' },
  renewal: { label: '续费提醒', color: 'purple' },
  knowledge_index: { label: '索引更新', color: 'cyan' },
  file_learned: { label: '文件学习', color: 'geekblue' },
  import: { label: '数据接入', color: 'lime' },
  order: { label: '订单提醒', color: 'magenta' },
  general: { label: '系统通知', color: 'default' },
};

const NOTIF_BIZ_OPTIONS = [
  { value: 'all', label: '全部类型' },
  ...Object.entries(NOTIF_BIZ_META).map(([value, meta]) => ({
    value,
    label: meta.label,
  })),
];

const NOTIF_TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
];

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * 消息公告：公告列表 + 业务通知记录。
 */
export function AnnouncementsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate = hasPermission('button:operation:announcement:create');
  const canUpdate = hasPermission('button:operation:announcement:update');
  const canPublish = hasPermission('button:operation:announcement:publish');

  const [loading, setLoading] = useState(false);
  const [annData, setAnnData] = useState<AnnouncementListResult | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);
  const [notifData, setNotifData] =
    useState<PageResult<BusinessNotificationItem> | null>(null);
  const [notifPage, setNotifPage] = useState(1);
  const [notifPageSize] = useState(20);
  const [notifBizType, setNotifBizType] = useState('all');
  const [notifTimeRange, setNotifTimeRange] = useState('all');
  const [notifReceiver, setNotifReceiver] = useState('');

  const [open, setOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<AnnouncementItem | null>(null);
  const [form] = Form.useForm();
  const audienceScope = Form.useWatch('audienceScope', form);
  const [roleOptions, setRoleOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAnnouncements({ page: 1, pageSize: 50 });
      setAnnData(res);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载公告失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadNotifications = useCallback(
    async (
      page = notifPage,
      filters?: {
        bizType?: string;
        timeRange?: string;
        receiver?: string;
      },
    ) => {
      const bizType = filters?.bizType ?? notifBizType;
      const timeRange = filters?.timeRange ?? notifTimeRange;
      const receiver = filters?.receiver ?? notifReceiver;
      setNotifLoading(true);
      try {
        const res = await fetchBusinessNotifications({
          page,
          pageSize: notifPageSize,
          bizType: bizType !== 'all' ? bizType : undefined,
          timeRange: timeRange !== 'all' ? timeRange : undefined,
          receiver: receiver.trim() || undefined,
        });
        setNotifData(res);
        setNotifPage(res.page);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载通知失败');
      } finally {
        setNotifLoading(false);
      }
    },
    [notifPage, notifPageSize, notifBizType, notifTimeRange, notifReceiver],
  );

  useEffect(() => {
    void loadAnnouncements();
    void loadNotifications(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAnnouncements]);

  useEffect(() => {
    void fetchRoles({ page: 1, pageSize: 100 })
      .then((res) => {
        setRoleOptions(
          res.items.map((r) => ({ value: r.id, label: r.name })),
        );
      })
      .catch(() => {
        // ignore
      });
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ audienceScope: 'all_users' });
    setOpen(true);
  };

  const openEdit = (row: AnnouncementItem) => {
    setEditing(row);
    form.setFieldsValue({
      title: row.title,
      content: row.content,
      audienceScope: row.audienceScope,
      audienceRoleIds: row.audienceRoleIds ?? [],
    });
    setOpen(true);
  };

  const saveDraft = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await updateAnnouncement(editing.id, values);
        message.success('公告已更新');
      } else {
        await createAnnouncement({ ...values, publish: false });
        message.success('已存草稿');
      }
      setOpen(false);
      await loadAnnouncements();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const saveAndPublish = async () => {
    const values = await form.validateFields();
    setPublishing(true);
    try {
      if (editing) {
        await updateAnnouncement(editing.id, values);
        if (editing.status !== 'published') {
          await publishAnnouncement(editing.id);
        }
        message.success('公告已发布');
      } else {
        await createAnnouncement({ ...values, publish: true });
        message.success('公告已发布');
      }
      setOpen(false);
      await loadAnnouncements();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const searchNotifications = () => {
    setNotifPage(1);
    void loadNotifications(1);
  };

  const resetNotificationFilters = () => {
    setNotifBizType('all');
    setNotifTimeRange('all');
    setNotifReceiver('');
    setNotifPage(1);
    void loadNotifications(1, {
      bizType: 'all',
      timeRange: 'all',
      receiver: '',
    });
  };

  const annColumns: ColumnsType<AnnouncementItem> = [
    {
      title: '标题',
      dataIndex: 'title',
      ellipsis: true,
    },
    {
      title: '接收范围',
      dataIndex: 'audienceScope',
      width: 120,
      render: (v: string) => AUDIENCE_LABEL[v] ?? v,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const meta = STATUS_META[v] ?? STATUS_META.draft;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '时间',
      width: 160,
      render: (_: unknown, row) =>
        formatDateTime(row.publishedAt || row.updatedAt),
    },
    {
      title: '操作',
      width: 180,
      render: (_: unknown, row) => (
        <Space size={8}>
          {canUpdate ? (
            <Button type="link" size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
          ) : null}
          {canPublish && row.status === 'draft' ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await publishAnnouncement(row.id);
                  message.success('已发布');
                  await loadAnnouncements();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '发布失败');
                }
              }}
            >
              发布
            </Button>
          ) : null}
          {canPublish && row.status === 'published' ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await recallAnnouncement(row.id);
                  message.success('已撤回');
                  await loadAnnouncements();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '撤回失败');
                }
              }}
            >
              撤回
            </Button>
          ) : null}
          {canPublish && row.status === 'recalled' ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await republishAnnouncement(row.id);
                  message.success('已重新发布');
                  await loadAnnouncements();
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '重新发布失败');
                }
              }}
            >
              重新发布
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const notifColumns: ColumnsType<BusinessNotificationItem> = [
    { title: '通知内容', dataIndex: 'content', ellipsis: true },
    { title: '接收人', dataIndex: 'receiverName', width: 120 },
    {
      title: '类型',
      dataIndex: 'bizType',
      width: 110,
      render: (v: string) => {
        const meta = NOTIF_BIZ_META[v];
        return (
          <Tag color={meta?.color ?? 'default'}>{meta?.label ?? v}</Tag>
        );
      },
    },
    {
      title: '时间',
      dataIndex: 'sentAt',
      width: 160,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) =>
        v === 'read' ? (
          <Tag>已读</Tag>
        ) : (
          <Tag color="processing">未读</Tag>
        ),
    },
    {
      title: '操作',
      width: 160,
      render: (_: unknown, row) => (
        <Space size={8}>
          {row.status === 'unread' ? (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await markNotificationRead(row.id);
                  message.success('已标记已读');
                  await loadNotifications(notifPage);
                } catch (e) {
                  message.error(e instanceof Error ? e.message : '操作失败');
                }
              }}
            >
              标记已读
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            onClick={async () => {
              try {
                await resendNotification(row.id);
                message.success('已重发');
                await loadNotifications(notifPage);
              } catch (e) {
                message.error(e instanceof Error ? e.message : '重发失败');
              }
            }}
          >
            重发
          </Button>
        </Space>
      ),
    },
  ];

  const summary = annData
    ? `草稿 ${annData.draftCount} / 已发布 ${annData.publishedCount} / 已撤回 ${annData.recalledCount}，共 ${annData.total} 条`
    : '';

  return (
    <Space direction="vertical" size={28} style={{ width: '100%' }}>
      <div>
        <Space
          style={{
            width: '100%',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
          wrap
        >
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              公告列表
            </Typography.Title>
            <Typography.Text type="secondary">{summary}</Typography.Text>
          </div>
          {canCreate ? (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增公告
            </Button>
          ) : null}
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          columns={annColumns}
          dataSource={annData?.items ?? []}
          pagination={false}
          scroll={{ x: 960 }}
        />
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}
        >
          撤回公告保留记录；发布失败（内容为空/过长）会 toast 提示。
        </Typography.Paragraph>
      </div>

      <div>
        <Space
          style={{
            width: '100%',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
          wrap
        >
          <div>
            <Typography.Title level={5} style={{ margin: 0 }}>
              业务通知记录
            </Typography.Title>
            <Typography.Text type="secondary">
              退款/订单状态等，进入站内信
              {notifData ? ` · 共 ${notifData.total} 条` : ''}
            </Typography.Text>
          </div>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void loadNotifications(notifPage)}
          >
            刷新
          </Button>
        </Space>
        <Space wrap style={{ marginBottom: 12 }}>
          <Select
            style={{ width: 140 }}
            value={notifBizType}
            options={NOTIF_BIZ_OPTIONS}
            onChange={setNotifBizType}
            aria-label="按类型筛选"
          />
          <Select
            style={{ width: 140 }}
            value={notifTimeRange}
            options={NOTIF_TIME_OPTIONS}
            onChange={setNotifTimeRange}
            aria-label="按时间筛选"
          />
          <Input
            style={{ width: 180 }}
            allowClear
            placeholder="接收人用户名/显示名"
            value={notifReceiver}
            onChange={(e) => setNotifReceiver(e.target.value)}
            onPressEnter={searchNotifications}
          />
          <Button
            type="primary"
            icon={<SearchOutlined />}
            onClick={searchNotifications}
          >
            查询
          </Button>
          <Button onClick={resetNotificationFilters}>重置</Button>
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={notifLoading}
          columns={notifColumns}
          dataSource={notifData?.items ?? []}
          scroll={{ x: 960 }}
          pagination={{
            current: notifData?.page ?? notifPage,
            pageSize: notifData?.pageSize ?? notifPageSize,
            total: notifData?.total ?? 0,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page) => {
              setNotifPage(page);
              void loadNotifications(page);
            },
          }}
        />
      </div>

      <Modal
        {...withFormModal({
          title: editing ? '编辑公告' : '新增公告',
          open,
          onCancel: () => setOpen(false),
          footer: (
            <Space>
              <Button onClick={() => setOpen(false)}>取消</Button>
              <Button onClick={() => void saveDraft()}>存草稿</Button>
              <Button
                type="primary"
                loading={publishing}
                onClick={() => void saveAndPublish()}
              >
                发布
              </Button>
            </Space>
          ),
        })}
      >
        <Form form={form} layout="vertical" requiredMark>
          <Form.Item
            name="title"
            label="公告标题"
            rules={[
              { required: true, message: '请输入公告标题' },
              { max: 60, message: '最多 60 字' },
            ]}
          >
            <Input placeholder="请输入公告标题" showCount maxLength={60} />
          </Form.Item>
          <Form.Item
            name="content"
            label="公告内容"
            rules={[
              { required: true, message: '请输入公告内容' },
              { max: 500, message: '最多 500 字' },
            ]}
          >
            <Input.TextArea
              placeholder="请输入公告内容，最多 500 字"
              showCount
              maxLength={500}
              rows={5}
            />
          </Form.Item>
          <Form.Item
            name="audienceScope"
            label="接收范围"
            rules={[{ required: true, message: '请选择接收范围' }]}
          >
            <Select
              options={[
                { value: 'all_users', label: '全部用户' },
                { value: 'specified_roles', label: '指定角色' },
                { value: 'pro_members', label: '专业版会员' },
              ]}
            />
          </Form.Item>
          {audienceScope === 'specified_roles' ? (
            <Form.Item
              name="audienceRoleIds"
              label="指定角色"
              rules={[{ required: true, message: '请选择角色' }]}
            >
              <Select
                mode="multiple"
                placeholder="请选择角色"
                options={roleOptions}
              />
            </Form.Item>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}
