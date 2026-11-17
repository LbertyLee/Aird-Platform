import './RolesPage.css';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  batchDeleteRoles,
  createRole,
  deleteRole,
  fetchPermissionTree,
  fetchRoleDetail,
  fetchRoleMembers,
  fetchRoles,
  replaceRolePermissions,
  updateRole,
  updateRoleStatus,
  type RoleItem,
  type RoleMemberItem,
} from '../api/admin';
import {
  PermissionTreeSelect,
  buildPermissionTreeFromFlat,
  collectAllPermissionIds,
  type PermissionTreeNode,
} from '../components/PermissionTreeSelect';
import {
  FORM_MODAL_WIDTH_LG,
  withFormModal,
} from '../components/form-modal';
import { useTableScrollY } from '../hooks/useTableScrollY';
import { useSessionStore } from '../stores/session';

const BUILTIN_ROLE_CODES = ['platform_admin', 'regular_user'] as const;

function isPlatformAdmin(role: Pick<RoleItem, 'code'>) {
  return role.code === 'platform_admin';
}

const STATUS_META: Record<
  string,
  { label: string; color: 'success' | 'default' }
> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' },
};

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function isBuiltinRole(role: Pick<RoleItem, 'code' | 'type'>) {
  return (
    role.type === 'system' ||
    (BUILTIN_ROLE_CODES as readonly string[]).includes(role.code)
  );
}

/**
 * 角色管理：列表 CRUD + 菜单权限树勾选。
 */
export function RolesPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const { wrapRef: tableWrapRef, scrollY } = useTableScrollY();
  const canDelete = hasPermission('button:rbac:role:delete');

  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchRoles>> | null>(
    null,
  );
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [permissionTree, setPermissionTree] = useState<PermissionTreeNode[]>(
    [],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [checkedPermissionIds, setCheckedPermissionIds] = useState<string[]>(
    [],
  );
  const [form] = Form.useForm<{
    code: string;
    name: string;
    description?: string;
  }>();

  const [memberOpen, setMemberOpen] = useState(false);
  const [memberRole, setMemberRole] = useState<RoleItem | null>(null);
  const [members, setMembers] = useState<RoleMemberItem[]>([]);
  const [memberLoading, setMemberLoading] = useState(false);

  const loadTree = useCallback(async () => {
    try {
      const raw = await fetchPermissionTree();
      setPermissionTree(
        buildPermissionTreeFromFlat(raw as PermissionTreeNode[]),
      );
    } catch {
      setPermissionTree([]);
      message.error('加载权限树失败');
    }
  }, []);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        setData(
          await fetchRoles({
            page,
            pageSize: 10,
            keyword: keyword.trim() || undefined,
          }),
        );
      } catch {
        message.error('加载角色列表失败');
      } finally {
        setLoading(false);
      }
    },
    [keyword],
  );

  useEffect(() => {
    void loadTree();
  }, [loadTree]);

  useEffect(() => {
    void load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setCheckedPermissionIds([]);
    form.resetFields();
    setFormOpen(true);
  };

  const openEdit = async (row: RoleItem) => {
    setEditing(row);
    setFormOpen(true);
    setSaving(true);
    try {
      const detail = await fetchRoleDetail(row.id);
      form.setFieldsValue({
        code: detail.code,
        name: detail.name,
        description: detail.description ?? undefined,
      });
      setCheckedPermissionIds(detail.permissionIds ?? []);
    } catch {
      message.error('加载角色详情失败');
      setFormOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editing) {
        await updateRole(editing.id, {
          name: values.name,
          description: values.description,
        });
        await replaceRolePermissions(editing.id, checkedPermissionIds);
        message.success('角色已更新，权限变更在下次登录时生效');
      } else {
        const created = (await createRole({
          code: values.code.trim(),
          name: values.name.trim(),
          description: values.description?.trim() || undefined,
        })) as RoleItem;
        if (checkedPermissionIds.length) {
          await replaceRolePermissions(created.id, checkedPermissionIds);
        }
        message.success('角色已创建');
      }
      setFormOpen(false);
      await load(data?.page ?? 1);
    } catch {
      message.error(editing ? '保存角色失败' : '创建角色失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (row: RoleItem) => {
    if (isBuiltinRole(row)) {
      message.warning('系统内置角色不可删除');
      return;
    }
    Modal.confirm({
      title: `确认删除角色「${row.name}」？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteRole(row.id);
        message.success('角色已删除');
        await load(data?.page ?? 1);
      },
    });
  };

  const handleBatchDelete = () => {
    if (!selectedRowKeys.length) {
      message.warning('请选择要删除的角色');
      return;
    }
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 个角色？`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const result = await batchDeleteRoles(selectedRowKeys);
        message.success(`已删除 ${result.deleted} 个角色`);
        setSelectedRowKeys([]);
        await load(1);
      },
    });
  };

  const handleStatusChange = async (row: RoleItem, checked: boolean) => {
    if (row.code === 'platform_admin' && !checked) {
      message.warning('平台管理员不可停用');
      return;
    }
    try {
      await updateRoleStatus(row.id, checked ? 'active' : 'disabled');
      message.success('角色状态已更新');
      await load(data?.page ?? 1);
    } catch {
      message.error('更新角色状态失败');
    }
  };

  const openMembers = async (row: RoleItem) => {
    setMemberRole(row);
    setMemberOpen(true);
    setMemberLoading(true);
    try {
      setMembers(await fetchRoleMembers(row.id));
    } catch {
      message.error('加载角色成员失败');
    } finally {
      setMemberLoading(false);
    }
  };

  const columns: ColumnsType<RoleItem & { createdAt?: string }> = [
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 160,
      render: (name, row) => (
        <Space size={4}>
          <span>{name}</span>
          {isBuiltinRole(row) ? (
            <Tag color="blue" bordered={false}>
              内置
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: '权限字符',
      dataIndex: 'code',
      width: 180,
      ellipsis: true,
    },
    {
      title: '权限数',
      width: 90,
      align: 'center',
      render: (_, row) => row._count?.rolePermissions ?? 0,
    },
    {
      title: '成员数',
      width: 90,
      align: 'center',
      render: (_, row) => row._count?.userRoles ?? 0,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string, row) => {
        const meta = STATUS_META[status] ?? {
          label: status,
          color: 'default' as const,
        };
        return (
          <Switch
            checked={status === 'active'}
            disabled={row.code === 'platform_admin'}
            checkedChildren={meta.label}
            unCheckedChildren={meta.label}
            onChange={(checked) => void handleStatusChange(row, checked)}
          />
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (value) => formatDateTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => void openEdit(row)}
          >
            修改
          </Button>
          <Button
            type="link"
            size="small"
            icon={<TeamOutlined />}
            onClick={() => void openMembers(row)}
          >
            成员
          </Button>
          {canDelete ? (
            <Button
              type="link"
              size="small"
              danger
              disabled={isBuiltinRole(row)}
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(row)}
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const memberColumns: ColumnsType<RoleMemberItem> = [
    { title: '用户名', dataIndex: 'username', width: 140 },
    {
      title: '姓名',
      dataIndex: 'displayName',
      render: (v) => v ?? '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'disabled' ? 'error' : 'success'}>
          {status === 'disabled' ? '已禁用' : '正常'}
        </Tag>
      ),
    },
  ];

  return (
    <div className="roles-page admin-table-fill-page">
      <section className="roles-section admin-table-fill-section">
        <div className="roles-toolbar">
          <Space wrap>
            <Input
              allowClear
              placeholder="角色名称 / 权限字符"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={() => void load(1)}
              style={{ width: 220 }}
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={() => void load(1)}
            >
              搜索
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void load(1)}>
              重置
            </Button>
          </Space>
          <Space>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增
            </Button>
            {canDelete ? (
              <Button danger onClick={handleBatchDelete}>
                删除
              </Button>
            ) : null}
          </Space>
        </div>

        <div className="admin-table-fill-wrap" ref={tableWrapRef}>
          <Table
            rowKey="id"
            size="small"
            loading={loading}
            columns={columns}
            dataSource={data?.items ?? []}
            scroll={{ x: 1100, y: scrollY }}
            rowSelection={
              canDelete
                ? {
                    selectedRowKeys,
                    onChange: (keys) => setSelectedRowKeys(keys as string[]),
                    getCheckboxProps: (row) => ({
                      disabled: isBuiltinRole(row),
                    }),
                  }
                : undefined
            }
            pagination={{
              current: data?.page ?? 1,
              pageSize: data?.pageSize ?? 10,
              total: data?.total ?? 0,
              showSizeChanger: false,
              showTotal: (total) => `共 ${total} 条`,
              onChange: (page) => void load(page),
            }}
          />
        </div>

        <Alert
          className="roles-tip"
          type="info"
          showIcon
          message="系统内置角色（平台管理员、普通用户）不可删除；平台管理员至少保留 1 名；权限变更在下次登录时生效。"
        />
      </section>

      <Modal
        {...withFormModal({
          title: editing ? `修改角色：${editing.name}` : '新增角色',
          open: formOpen,
          width: FORM_MODAL_WIDTH_LG,
          confirmLoading: saving,
          onOk: () => void handleSave(),
          onCancel: () => setFormOpen(false),
        })}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="角色名称"
            name="name"
            rules={[{ required: true, message: '请输入角色名称' }]}
          >
            <Input placeholder="如：运营组长" maxLength={64} />
          </Form.Item>
          <Form.Item
            label="权限字符"
            name="code"
            rules={[
              { required: true, message: '请输入权限字符' },
              {
                pattern: /^[a-z][a-z0-9_]*$/,
                message: '仅支持小写字母、数字和下划线，且以字母开头',
              },
            ]}
          >
            <Input
              placeholder="如：operation_lead"
              maxLength={64}
              disabled={Boolean(editing)}
            />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea
              placeholder="角色说明（可选）"
              maxLength={256}
              rows={2}
            />
          </Form.Item>
          <Form.Item label="菜单权限" required>
            {editing && isPlatformAdmin(editing) ? (
              <Alert
                type="info"
                showIcon
                message="平台管理员始终拥有全部菜单与按钮权限，无需单独配置。"
                style={{ marginBottom: 8 }}
              />
            ) : null}
            <PermissionTreeSelect
              tree={permissionTree}
              value={
                editing && isPlatformAdmin(editing)
                  ? collectAllPermissionIds(permissionTree)
                  : checkedPermissionIds
              }
              onChange={setCheckedPermissionIds}
              disabled={Boolean(editing && isPlatformAdmin(editing))}
            />
            <Typography.Text type="secondary" className="roles-perm-hint">
              勾选该角色可访问的菜单与按钮权限；支持展开/折叠、全选和父子联动。
            </Typography.Text>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`角色成员：${memberRole?.name ?? ''}（${members.length} 人）`}
        open={memberOpen}
        onCancel={() => setMemberOpen(false)}
        footer={
          <Button type="primary" onClick={() => setMemberOpen(false)}>
            关闭
          </Button>
        }
        width={560}
        destroyOnClose
      >
        <Table
          rowKey="id"
          size="small"
          loading={memberLoading}
          pagination={false}
          columns={memberColumns}
          dataSource={members}
        />
      </Modal>
    </div>
  );
}
