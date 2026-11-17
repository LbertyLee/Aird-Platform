import './UsersPage.css';
import {
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  assignUserRoles,
  batchDeleteUsers,
  createUser,
  deleteUser,
  exportUsers,
  fetchAssignableLevels,
  fetchRoles,
  fetchUserRoles,
  fetchUserRoleOptions,
  fetchUserSubscription,
  fetchUsers,
  grantUserMembership,
  resetUserPassword,
  setUserStatus,
  updateUser,
  type RoleItem,
  type UserItem,
} from '../api/admin';
import {
  FORM_MODAL_WIDTH_LG,
  withFormModal,
} from '../components/form-modal';
import { TableRowActions } from '../components/TableRowActions';
import { useTableScrollY } from '../hooks/useTableScrollY';
import { useSessionStore } from '../stores/session';

const STATUS_META: Record<
  string,
  { label: string; color: 'success' | 'error' | 'processing' | 'default' }
> = {
  active: { label: '正常', color: 'success' },
  disabled: { label: '已禁用', color: 'error' },
  pending: { label: '待激活', color: 'processing' },
};

type AssignableLevel = Awaited<
  ReturnType<typeof fetchAssignableLevels>
>[number];

function formatDateTime(value?: string | null) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isAdminRole(role: { code: string; name: string }) {
  return (
    role.code === 'platform_admin' ||
    role.name.includes('管理员') ||
    role.name.includes('平台')
  );
}

/** 用户可分配角色（与角色权限页一致，仅系统内置） */
const ASSIGNABLE_ROLE_CODES = ['platform_admin', 'regular_user'] as const;

function filterAssignableRoles(roles: RoleItem[]) {
  return roles.filter((role) =>
    (ASSIGNABLE_ROLE_CODES as readonly string[]).includes(role.code),
  );
}

/**
 * 用户账号管理：CRUD、启停、重置密码、分配角色、分配会员等级。
 */
export function UsersPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const currentUserId = useSessionStore((s) => s.profile?.id);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const [keyword, setKeyword] = useState('');
  const [roleFilter, setRoleFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchUsers>> | null>(
    null,
  );
  const [roleOptions, setRoleOptions] = useState<
    Array<Pick<RoleItem, 'id' | 'code' | 'name'>>
  >([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<UserItem | null>(null);
  const [form] = Form.useForm();
  const [createRoleOptions, setCreateRoleOptions] = useState<RoleItem[]>([]);
  const [exporting, setExporting] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const [levelOpen, setLevelOpen] = useState(false);
  const [levelUser, setLevelUser] = useState<UserItem | null>(null);
  const [levelOptions, setLevelOptions] = useState<AssignableLevel[]>([]);
  const [currentMembership, setCurrentMembership] = useState<{
    levelName: string;
    endAt: string;
  } | null>(null);
  const [levelForm] = Form.useForm();
  const [levelSaving, setLevelSaving] = useState(false);

  const [pwdOpen, setPwdOpen] = useState(false);
  const [pwdUser, setPwdUser] = useState<UserItem | null>(null);
  const [pwdNotify, setPwdNotify] = useState(true);
  const [pwdLoading, setPwdLoading] = useState(false);
  const { wrapRef: tableWrapRef, scrollY } = useTableScrollY();

  const loadRoles = useCallback(async () => {
    try {
      setRoleOptions(await fetchUserRoleOptions());
    } catch {
      setRoleOptions([]);
    }
  }, []);

  const load = useCallback(
    async (page = 1, notify = false) => {
      const currentRequest = ++requestId.current;
      setLoading(true);
      try {
        const result = await fetchUsers({
          page,
          pageSize: 10,
          keyword: keyword.trim() || undefined,
          status: statusFilter,
          roleId: roleFilter,
        });
        if (currentRequest !== requestId.current) return;
        setData(result);
        if (notify) {
          message.success(`已按条件查询，命中 ${result.total} 个账号`);
        }
      } catch (error) {
        if (currentRequest === requestId.current) {
          message.error(error instanceof Error ? error.message : '加载用户失败');
        }
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [keyword, statusFilter, roleFilter],
  );

  useEffect(() => {
    void loadRoles();
  }, [loadRoles]);

  useEffect(() => {
    setSelectedRowKeys([]);
    void load();
    return () => {
      requestId.current += 1;
    };
  }, [load]);

  const handleQuery = () => {
    void load(1, true);
  };

  const filteredItems = data?.items ?? [];

  const resetQuery = () => {
    const hadFilters = Boolean(keyword || roleFilter || statusFilter);
    setKeyword('');
    setRoleFilter(undefined);
    setStatusFilter(undefined);
    if (!hadFilters) {
      void load(1);
    }
  };

  const openCreate = async () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
    try {
      const rolesPage = await fetchRoles({ page: 1, pageSize: 100 });
      setCreateRoleOptions(filterAssignableRoles(rolesPage?.items ?? []));
    } catch {
      setCreateRoleOptions([]);
      message.error('加载角色失败');
    }
  };

  const openEdit = async (row: UserItem) => {
    setEditing(row);
    form.setFieldsValue({
      displayName: row.displayName,
      email: row.email,
      phone: row.phone,
    });
    setOpen(true);
    if (!hasPermission('menu:rbac:role')) return;
    try {
      const [rolesPage, bindings] = await Promise.all([
        fetchRoles({ page: 1, pageSize: 100 }),
        fetchUserRoles(row.id),
      ]);
      const assignableRoles = filterAssignableRoles(rolesPage?.items ?? []);
      const assignableIds = new Set(assignableRoles.map((role) => role.id));
      setCreateRoleOptions(assignableRoles);
      form.setFieldsValue({
        roleIds: (bindings ?? [])
          .map((b) => b.roleId)
          .filter((roleId) => assignableIds.has(roleId)),
      });
    } catch {
      message.error('加载角色失败');
    }
  };

  const onSubmit = async () => {
    const values = await form.validateFields();
    if (editing) {
      await updateUser(editing.id, {
        displayName: values.displayName,
        email: values.email,
        phone: values.phone,
      });
      if (hasPermission('menu:rbac:role') && values.roleIds?.length) {
        await assignUserRoles(
          editing.id,
          (values.roleIds as string[]).map((roleId) => ({ roleId })),
        );
      }
      message.success(`已保存用户：${editing.username}`);
    } else {
      const result = (await createUser(values)) as { tempPassword?: string };
      message.success(
        result.tempPassword
          ? `已新增用户：${values.username}（初始密码 ${result.tempPassword}）`
          : `已新增用户：${values.username}`,
      );
    }
    setOpen(false);
    await load(data?.page);
  };

  const openAssignLevel = async (row: UserItem) => {
    setLevelUser(row);
    setLevelOpen(true);
    levelForm.resetFields();
    setCurrentMembership(null);
    setLevelSaving(true);
    try {
      let levels: AssignableLevel[] = [];
      try {
        levels = await fetchAssignableLevels();
      } catch {
        message.error('加载会员等级失败');
      }

      let options = levels.filter((l) => l.code === 'pro');

      try {
        const sub = await fetchUserSubscription(row.id);
        if (sub?.active) {
          const { level, levelId } = sub.active;
          setCurrentMembership({
            levelName: level.name,
            endAt: sub.active.endAt,
          });
          if (!options.some((item) => item.id === level.id)) {
            const matched = levels.find((item) => item.id === level.id);
            options = [
              ...options,
              matched ?? {
                id: level.id,
                code: level.code,
                name: level.name,
                durationDays: 0,
              },
            ];
          }
          levelForm.setFieldsValue({ levelId });
        }
      } catch {
        // 订阅信息加载失败不阻断分配
      }

      setLevelOptions(options);

      if (options.length === 0) {
        message.warning('暂无可分配的会员等级，请先在会员管理中配置专业版');
      }
    } finally {
      setLevelSaving(false);
    }
  };

  const submitLevel = async () => {
    if (!levelUser) return;
    const values = await levelForm.validateFields();
    setLevelSaving(true);
    try {
      await grantUserMembership({
        userId: levelUser.id,
        levelId: values.levelId,
      });
      message.success('会员已分配，立即生效');
      setLevelOpen(false);
      await load(data?.page);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '分配会员失败');
    } finally {
      setLevelSaving(false);
    }
  };

  const toggleStatus = (row: UserItem) => {
    if (row.id === currentUserId && row.status !== 'disabled') {
      message.warning('不能禁用自己的账号');
      return;
    }

    const enabling = row.status === 'disabled';
    const action = enabling ? '启用' : '禁用';

    Modal.confirm({
      title: `${action}账号`,
      content: `${action}后${enabling ? '该用户可正常登录' : '该用户不可登录'}，是否继续？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        await setUserStatus(row.id, enabling);
        message.success(`已${action}账号：${row.username}`);
        await load(data?.page);
      },
    });
  };

  const openResetPassword = (row: UserItem) => {
    setPwdUser(row);
    setPwdNotify(true);
    setPwdOpen(true);
  };

  const submitResetPassword = async () => {
    if (!pwdUser) return;
    setPwdLoading(true);
    try {
      const result = await resetUserPassword(pwdUser.id);
      setPwdOpen(false);
      Modal.success({
        title: '密码已重置',
        content: (
          <div>
            <p>
              用户 <strong>{pwdUser.username}</strong> 的新密码：
            </p>
            <Typography.Paragraph copyable code>
              {result.tempPassword}
            </Typography.Paragraph>
            {pwdNotify ? (
              <Typography.Text type="secondary">
                请通过安全渠道通知该用户修改密码。
              </Typography.Text>
            ) : null}
          </div>
        ),
      });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重置密码失败');
    } finally {
      setPwdLoading(false);
    }
  };

  const confirmDeleteUser = (row: UserItem) => {
    if (row.id === currentUserId) {
      message.warning('不能删除当前登录账号');
      return;
    }

    Modal.confirm({
      title: '删除账号',
      content: `确定删除用户「${row.displayName || row.username}」吗？删除后不可恢复登录。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteUser(row.id);
          message.success(`已删除用户：${row.username}`);
          setSelectedRowKeys((keys) => keys.filter((key) => key !== row.id));
          await load(data?.page);
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
        }
      },
    });
  };

  const confirmBatchDelete = () => {
    const ids = selectedRowKeys.filter((id) => id !== currentUserId);
    if (ids.length === 0) {
      message.warning('请选择要删除的用户');
      return;
    }

    Modal.confirm({
      title: '批量删除账号',
      content: `确定删除选中的 ${ids.length} 个用户吗？删除后不可恢复登录。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true);
        try {
          const result = await batchDeleteUsers(ids);
          message.success(`已删除 ${result.deleted} 个用户`);
          setSelectedRowKeys([]);
          await load(data?.page);
        } catch (e) {
          message.error(e instanceof Error ? e.message : '批量删除失败');
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  };

  const canDeleteUser = hasPermission('button:user:delete');

  return (
    <div className="users-page admin-table-fill-page">
      <section className="users-section users-section--toolbar">
        <div className="users-toolbar">
          <div className="users-toolbar-filters">
            <Input
              allowClear
              placeholder="用户名 / 姓名"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={handleQuery}
            />
            <Select
              allowClear
              className="users-filter-select--role"
              placeholder="全部角色"
              value={roleFilter}
              options={roleOptions.map((role) => ({
                value: role.id,
                label: role.name,
              }))}
              onChange={setRoleFilter}
            />
            <Select
              allowClear
              className="users-filter-select--status"
              placeholder="全部状态"
              value={statusFilter}
              options={[
                { value: 'active', label: '正常' },
                { value: 'disabled', label: '已禁用' },
                { value: 'pending', label: '待激活' },
              ]}
              onChange={setStatusFilter}
            />
            <Button
              className="users-search-btn"
              icon={<SearchOutlined />}
              onClick={handleQuery}
            >
              搜索
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void resetQuery()}>
              重置
            </Button>
          </div>
          <div className="users-toolbar-actions">
            {canDeleteUser ? (
              <Button
                danger
                disabled={selectedRowKeys.length === 0}
                loading={batchDeleting}
                onClick={confirmBatchDelete}
              >
                批量删除
                {selectedRowKeys.length > 0 ? `（${selectedRowKeys.length}）` : ''}
              </Button>
            ) : null}
            {hasPermission('export:user') ? (
              <Button
                loading={exporting}
                onClick={async () => {
                  setExporting(true);
                  try {
                    await exportUsers({
                      keyword: keyword.trim() || undefined,
                      status: statusFilter,
                      roleId: roleFilter,
                      ids:
                        selectedRowKeys.length > 0
                          ? selectedRowKeys
                          : undefined,
                    });
                    message.success(
                      selectedRowKeys.length > 0
                        ? `已导出勾选的 ${selectedRowKeys.length} 个账号`
                        : '导出成功',
                    );
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '导出失败');
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                导出
                {selectedRowKeys.length > 0
                  ? `（${selectedRowKeys.length}）`
                  : ''}
              </Button>
            ) : null}
            {hasPermission('button:user:create') ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => void openCreate()}
              >
                新增用户
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="users-section admin-table-fill-section">
        <div className="users-table-head">
          <span className="users-table-title">用户列表</span>
          <span className="users-table-meta">
            <InfoCircleOutlined style={{ marginRight: 4 }} />
            共 {data?.total ?? 0} 个账号
          </span>
        </div>

        <div className="admin-table-fill-wrap" ref={tableWrapRef}>
          <Table
            className="users-table"
            rowKey="id"
            loading={loading}
            dataSource={filteredItems}
            rowSelection={
              canDeleteUser
                ? {
                    selectedRowKeys,
                    onChange: (keys) => setSelectedRowKeys(keys as string[]),
                    getCheckboxProps: (row) => ({
                      disabled: row.id === currentUserId,
                    }),
                  }
                : undefined
            }
            scroll={{ x: 'max-content', y: scrollY }}
            pagination={{
              total: data?.total,
              pageSize: data?.pageSize,
              current: data?.page,
              onChange: (p) => void load(p),
              showSizeChanger: false,
            }}
            columns={[
            {
              title: '用户名',
              dataIndex: 'username',
              width: 140,
            },
            {
              title: '姓名',
              dataIndex: 'displayName',
              width: 140,
              render: (value: string | null, row) => value || row.username,
            },
            {
              title: '手机号',
              dataIndex: 'phone',
              width: 130,
              render: (value: string | null) =>
                value || <span className="users-membership-empty">—</span>,
            },
            {
              title: '角色',
              width: 160,
              render: (_, row) =>
                row.roles?.length ? (
                  <Space size={[4, 4]} wrap>
                    {row.roles.map((role) => (
                      <Tag
                        key={role.id}
                        color={isAdminRole(role) ? 'processing' : 'default'}
                      >
                        {role.name}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  '-'
                ),
            },
            {
              title: '会员等级',
              width: 120,
              render: (_, row) =>
                row.membership?.levelName ? (
                  <Tag
                    color={
                      row.membership.levelCode === 'pro' ? 'blue' : 'default'
                    }
                  >
                    {row.membership.levelName}
                  </Tag>
                ) : (
                  <span className="users-membership-empty">未开通</span>
                ),
            },
            {
              title: '会员到期时间',
              width: 160,
              render: (_, row) =>
                row.membership?.endAt ? (
                  formatDateTime(row.membership.endAt)
                ) : (
                  <span className="users-membership-empty">—</span>
                ),
            },
            {
              title: '创建时间',
              dataIndex: 'createdAt',
              width: 160,
              render: (value: string) => formatDateTime(value),
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 100,
              render: (value: string) => {
                const meta = STATUS_META[value] ?? {
                  label: value,
                  color: 'default' as const,
                };
                return <Tag color={meta.color}>{meta.label}</Tag>;
              },
            },
            {
              title: '操作',
              width: 120,
              fixed: 'right',
              render: (_, row) => {
                const linkClass = (extra?: string) =>
                  ['users-action-link', extra].filter(Boolean).join(' ');
                const canMembership =
                  hasPermission('menu:membership:level') ||
                  hasPermission('menu:membership:order');

                return (
                  <TableRowActions
                    actions={[
                      {
                        key: 'edit',
                        label: '编辑',
                        inline: true,
                        hidden: !hasPermission('button:user:update'),
                        linkClassName: linkClass(),
                        onClick: () => void openEdit(row),
                      },
                      {
                        key: 'enable',
                        label: '启用',
                        hidden:
                          row.status !== 'disabled' ||
                          !hasPermission('button:user:disable'),
                        linkClassName: linkClass('users-action-link--success'),
                        onClick: () => toggleStatus(row),
                      },
                      {
                        key: 'disable',
                        label: '禁用',
                        hidden:
                          row.status === 'disabled' ||
                          !hasPermission('button:user:disable'),
                        disabled: row.id === currentUserId,
                        linkClassName: linkClass('users-action-link--warning'),
                        onClick: () => toggleStatus(row),
                      },
                      {
                        key: 'reset-password',
                        label: '重置密码',
                        hidden: !hasPermission('button:user:reset_password'),
                        linkClassName: linkClass(),
                        onClick: () => openResetPassword(row),
                      },
                      {
                        key: 'membership',
                        label: '会员',
                        hidden: !canMembership,
                        linkClassName: linkClass(),
                        onClick: () => void openAssignLevel(row),
                      },
                      {
                        key: 'delete',
                        label: '删除',
                        danger: true,
                        hidden: !canDeleteUser,
                        disabled: row.id === currentUserId,
                        linkClassName: linkClass('users-action-link--danger'),
                        onClick: () => confirmDeleteUser(row),
                      },
                    ]}
                  />
                );
              },
            },
          ]}
          />
        </div>

        <Alert
          className="users-tip"
          type="info"
          showIcon
          message="不能禁用自己的账号；禁用不影响已生成的数据和报告；操作记录会计入审计日志。"
        />
      </section>

      <Modal
        {...withFormModal({
          title: editing ? '编辑用户' : '新增用户',
          open,
          onOk: () => void onSubmit(),
          onCancel: () => setOpen(false),
          width: editing ? FORM_MODAL_WIDTH_LG : 480,
          okText: '保存',
        })}
      >
        <Form form={form} layout="vertical">
          {editing ? (
            <>
              <Form.Item label="用户名">
                <Input value={editing.username} disabled />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="displayName"
                    label="姓名"
                    rules={[{ required: true, message: '请输入姓名' }]}
                  >
                    <Input placeholder="用户姓名" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="phone" label="手机号">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="email" label="邮箱">
                <Input />
              </Form.Item>
              {hasPermission('menu:rbac:role') ? (
                <Form.Item name="roleIds" label="角色">
                  <Select
                    mode="multiple"
                    allowClear
                    placeholder="请选择角色"
                    optionFilterProp="label"
                    options={createRoleOptions.map((role) => ({
                      value: role.id,
                      label: role.name,
                    }))}
                  />
                </Form.Item>
              ) : null}
            </>
          ) : (
            <>
              <Form.Item
                name="username"
                label="用户名"
                rules={[{ required: true, message: '请输入用户名' }]}
              >
                <Input placeholder="登录账号，唯一" />
              </Form.Item>
              <Form.Item
                name="displayName"
                label="姓名"
                rules={[{ required: true, message: '请输入姓名' }]}
              >
                <Input placeholder="用户姓名" />
              </Form.Item>
              <Form.Item
                name="roleIds"
                label="角色"
                rules={[
                  { required: true, message: '请选择角色' },
                  { type: 'array', min: 1, message: '请选择角色' },
                ]}
              >
                <Select
                  mode="multiple"
                  allowClear
                  placeholder="请选择角色"
                  optionFilterProp="label"
                  options={createRoleOptions.map((role) => ({
                    value: role.id,
                    label: role.name,
                  }))}
                />
              </Form.Item>
              <Form.Item name="password" label="初始密码">
                <Input.Password placeholder="留空则默认为 账号+@123" />
              </Form.Item>
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item name="email" label="邮箱">
                    <Input />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="phone" label="手机号">
                    <Input />
                  </Form.Item>
                </Col>
              </Row>
            </>
          )}
        </Form>
      </Modal>

      <Modal
        title={`重置密码 - ${pwdUser?.username ?? ''}`}
        open={pwdOpen}
        confirmLoading={pwdLoading}
        okText="确认重置"
        cancelText="取消"
        onOk={() => void submitResetPassword()}
        onCancel={() => setPwdOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="用户名">
            <Typography.Text strong>{pwdUser?.username}</Typography.Text>
          </Form.Item>
          <Form.Item label="说明">
            <Typography.Text type="secondary">
              密码将重置为「账号+@123」，例如 {pwdUser?.username ?? 'username'}
              @123，请在重置后通知用户尽快修改。
            </Typography.Text>
          </Form.Item>
          <Form.Item>
            <label>
              <input
                type="checkbox"
                checked={pwdNotify}
                onChange={(e) => setPwdNotify(e.target.checked)}
                style={{ marginRight: 8 }}
              />
              重置后通知该用户
            </label>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        {...withFormModal({
          title: `分配会员 - ${levelUser?.displayName || levelUser?.username || ''}`,
          open: levelOpen,
          confirmLoading: levelSaving,
          okText: '确定',
          cancelText: '取消',
          onOk: () => void submitLevel(),
          onCancel: () => setLevelOpen(false),
        })}
      >
        {currentMembership ? (
          <Typography.Paragraph type="secondary">
            当前有效等级：{currentMembership.levelName}
            {currentMembership.endAt
              ? `（${formatDateTime(currentMembership.endAt)} 到期，保存后将覆盖为新等级）`
              : '（保存后将覆盖为新等级）'}
          </Typography.Paragraph>
        ) : (
          <Typography.Paragraph type="secondary">
            当前未开通个人会员，保存后立即生效。
          </Typography.Paragraph>
        )}
        <Form
          form={levelForm}
          labelCol={{ span: 6 }}
          wrapperCol={{ span: 18 }}
        >
          <Form.Item
            name="levelId"
            label="会员等级"
            rules={[{ required: true, message: '请选择等级' }]}
            extra="有效期按所选等级默认套餐自动计算"
          >
            <Select
              loading={levelSaving}
              placeholder="请选择等级"
              optionFilterProp="label"
              options={levelOptions.map((level) => ({
                value: level.id,
                label: level.name,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
