import './DictionariesPage.css';
import {
  Button,
  Drawer,
  Form,
  Input,
  InputNumber,
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
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  batchDeleteDictionaries,
  createDictionary,
  createDictionaryType,
  deleteDictionary,
  deleteDictionaryType,
  fetchDictionaries,
  fetchDictionaryTypes,
  updateDictionary,
  updateDictionaryType,
  type DictionaryItem,
  type DictionaryTypeItem,
} from '../api/admin';
import { withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';

const STATUS_META: Record<
  string,
  { label: string; color: 'success' | 'default' }
> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' },
};

/**
 * 基础字典库管理。
 */
export function DictionariesPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canDelete = hasPermission('button:data:dict:delete');
  const canUpdate = hasPermission('button:data:dict:update');
  const canCreate = hasPermission('button:data:dict:create');

  const [allTypes, setAllTypes] = useState<DictionaryTypeItem[]>([]);
  const [activeType, setActiveType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [typesLoading, setTypesLoading] = useState(false);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchDictionaries>
  > | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DictionaryItem | null>(null);
  const [form] = Form.useForm();
  const editingCode = Form.useWatch('code', form);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const isLegalDocumentField = activeType === 'legal_documents';
  const isLegalDocumentBody =
    isLegalDocumentField &&
    Boolean(
      editing?.code.endsWith('_content') ||
      (!editing && editingCode?.endsWith('_content')),
    );

  const [typeDrawerOpen, setTypeDrawerOpen] = useState(false);
  const [typeFormOpen, setTypeFormOpen] = useState(false);
  const [editingType, setEditingType] = useState<DictionaryTypeItem | null>(
    null,
  );
  const [typeForm] = Form.useForm();

  const activeTabs = useMemo(
    () => allTypes.filter((t) => t.status === 'active'),
    [allTypes],
  );

  const typeOptions = useMemo(
    () =>
      activeTabs.map((t) => ({
        value: t.code,
        label: t.name,
      })),
    [activeTabs],
  );

  const loadTypes = useCallback(async () => {
    setTypesLoading(true);
    try {
      const list = await fetchDictionaryTypes();
      setAllTypes(list);
      setActiveType((prev) => {
        const activeCodes = list
          .filter((t) => t.status === 'active')
          .map((t) => t.code);
        if (prev && activeCodes.includes(prev)) return prev;
        return activeCodes[0] ?? '';
      });
    } catch {
      message.error('加载字典类型失败');
    } finally {
      setTypesLoading(false);
    }
  }, []);

  const load = useCallback(
    async (page = 1) => {
      if (!activeType) {
        setData(null);
        return;
      }
      setLoading(true);
      try {
        const res = await fetchDictionaries({
          page,
          pageSize: 50,
          type: activeType,
        });
        setData(res);
      } catch {
        message.error('加载字典失败');
      } finally {
        setLoading(false);
      }
    },
    [activeType],
  );

  useEffect(() => {
    void loadTypes();
  }, [loadTypes]);

  useEffect(() => {
    setSelectedRowKeys([]);
    void load(1);
  }, [load]);

  const openCreate = () => {
    if (!activeType) {
      message.warning('请先维护并启用至少一个字典类型');
      return;
    }
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      type: activeType,
      sort: 0,
      status: 'active',
      englishName: '',
    });
    setOpen(true);
  };

  const openEdit = (row: DictionaryItem) => {
    setEditing(row);
    form.setFieldsValue({
      ...row,
      englishName: row.aliases?.[0] ?? '',
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const englishName = String(values.englishName || '').trim();
    const payload = {
      type: values.type,
      name: values.name,
      code: values.code,
      aliases: englishName ? [englishName] : [],
      description: values.description,
      sort: Number(values.sort ?? 0),
      status: values.status,
    };
    if (editing) {
      const { type: _type, code: _code, ...updatePayload } = payload;
      await updateDictionary(editing.id, updatePayload);
      message.success('已更新');
    } else {
      await createDictionary(payload);
      message.success('已创建');
    }
    setOpen(false);
    await load(data?.page ?? 1);
  };

  const toggleStatus = (row: DictionaryItem) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const actionLabel = next === 'disabled' ? '停用' : '启用';
    Modal.confirm({
      title: `确认${actionLabel}「${row.name}」？`,
      okText: actionLabel,
      cancelText: '取消',
      onOk: async () => {
        await updateDictionary(row.id, { status: next });
        message.success(`已${actionLabel}`);
        await load(data?.page ?? 1);
      },
    });
  };

  const confirmDeleteOne = (row: DictionaryItem) => {
    Modal.confirm({
      title: `确认删除「${row.name}」？`,
      content: '被数据集或指标引用的字典项无法删除，建议改用停用。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDictionary(row.id);
          message.success('已删除');
          setSelectedRowKeys((prev) => prev.filter((id) => id !== row.id));
          await load(data?.page ?? 1);
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
          throw e;
        }
      },
    });
  };

  const confirmBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条字典项？`,
      content: '被引用的字典项无法删除，建议改用停用。',
      okText: '批量删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true);
        try {
          const result = await batchDeleteDictionaries(selectedRowKeys);
          message.success(`已删除 ${result.deleted} 条`);
          setSelectedRowKeys([]);
          await load(data?.page ?? 1);
        } catch (e) {
          message.error(e instanceof Error ? e.message : '批量删除失败');
          throw e;
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  };

  const openTypeCreate = () => {
    setEditingType(null);
    typeForm.resetFields();
    typeForm.setFieldsValue({ sort: 100, status: 'active' });
    setTypeFormOpen(true);
  };

  const openTypeEdit = (row: DictionaryTypeItem) => {
    setEditingType(row);
    typeForm.setFieldsValue(row);
    setTypeFormOpen(true);
  };

  const submitType = async () => {
    const values = await typeForm.validateFields();
    const payload = {
      code: String(values.code || '').trim(),
      name: String(values.name || '').trim(),
      description: values.description,
      sort: Number(values.sort ?? 0),
      status: values.status,
    };
    try {
      if (editingType) {
        await updateDictionaryType(editingType.id, payload);
        message.success('类型已更新');
      } else {
        await createDictionaryType(payload);
        message.success('类型已创建');
      }
      setTypeFormOpen(false);
      await loadTypes();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存类型失败');
    }
  };

  const toggleTypeStatus = (row: DictionaryTypeItem) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const actionLabel = next === 'disabled' ? '停用' : '启用';
    Modal.confirm({
      title: `确认${actionLabel}类型「${row.name}」？`,
      content:
        next === 'disabled'
          ? '停用后该类型将不在 Tab 中显示，已有字典项仍保留。'
          : undefined,
      okText: actionLabel,
      cancelText: '取消',
      onOk: async () => {
        try {
          await updateDictionaryType(row.id, { status: next });
          message.success(`已${actionLabel}`);
          await loadTypes();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '操作失败');
          throw e;
        }
      },
    });
  };

  const confirmDeleteType = (row: DictionaryTypeItem) => {
    if (row.isSystem) {
      message.warning('系统内置类型禁止删除');
      return;
    }
    Modal.confirm({
      title: `确认删除类型「${row.name}」？`,
      content: '类型下仍有字典项时无法删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDictionaryType(row.id);
          message.success('类型已删除');
          await loadTypes();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '删除失败');
          throw e;
        }
      },
    });
  };

  const columns: ColumnsType<DictionaryItem> = [
    {
      title: '编码',
      dataIndex: 'code',
      width: 140,
    },
    {
      title: '名称',
      dataIndex: 'name',
      render: (value: string, row) =>
        row.code.endsWith('_content')
          ? value
            ? `正文已配置（${value.length.toLocaleString()} 字符）`
            : '尚未配置正文'
          : value,
    },
    {
      title: '说明',
      dataIndex: 'description',
      width: 360,
      render: (value?: string | null) => value || '-',
    },
    ...(activeType === 'legal_documents'
      ? []
      : [
          {
            title: '英文名',
            dataIndex: 'aliases',
            render: (aliases: string[]) =>
              aliases?.length ? aliases.join('、') : '-',
          },
        ]),
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? STATUS_META.active;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      width: 200,
      render: (_, row) => (
        <Space size={4} wrap>
          {canUpdate ? (
            <Button
              type="link"
              className="dictionaries-action-link"
              onClick={() => openEdit(row)}
            >
              编辑
            </Button>
          ) : null}
          {canUpdate ? (
            <Button
              type="link"
              className={
                row.status === 'active'
                  ? 'dictionaries-action-link dictionaries-action-link--warning'
                  : 'dictionaries-action-link'
              }
              onClick={() => toggleStatus(row)}
            >
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="link"
              className="dictionaries-action-link dictionaries-action-link--danger"
              onClick={() => confirmDeleteOne(row)}
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const typeColumns: ColumnsType<DictionaryTypeItem> = [
    {
      title: '编码',
      dataIndex: 'code',
      width: 160,
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 120,
    },
    {
      title: '排序',
      dataIndex: 'sort',
      width: 72,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 88,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? STATUS_META.active;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '内置',
      dataIndex: 'isSystem',
      width: 72,
      render: (v: boolean) => (v ? '是' : '否'),
    },
    {
      title: '操作',
      width: 180,
      render: (_, row) => (
        <Space size={4} wrap>
          {canUpdate ? (
            <Button
              type="link"
              className="dictionaries-action-link"
              onClick={() => openTypeEdit(row)}
            >
              编辑
            </Button>
          ) : null}
          {canUpdate ? (
            <Button
              type="link"
              className={
                row.status === 'active'
                  ? 'dictionaries-action-link dictionaries-action-link--warning'
                  : 'dictionaries-action-link'
              }
              onClick={() => toggleTypeStatus(row)}
            >
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          ) : null}
          {canDelete && !row.isSystem ? (
            <Button
              type="link"
              className="dictionaries-action-link dictionaries-action-link--danger"
              onClick={() => confirmDeleteType(row)}
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div className="dictionaries-page">
      <section className="dictionaries-section">
        <div className="dictionaries-title-row">
          <h2 className="dictionaries-title">基础字典库</h2>
          <Space wrap>
            {canCreate ? (
              <Button type="primary" onClick={openCreate}>
                新增字典项
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                danger
                disabled={selectedRowKeys.length === 0}
                loading={batchDeleting}
                onClick={confirmBatchDelete}
              >
                批量删除
                {selectedRowKeys.length > 0
                  ? `（${selectedRowKeys.length}）`
                  : ''}
              </Button>
            ) : null}
            <Button onClick={() => setTypeDrawerOpen(true)}>维护类型</Button>
          </Space>
        </div>
        <Tabs
          className="dictionaries-tabs"
          activeKey={activeType || undefined}
          onChange={(key) => setActiveType(key)}
          items={activeTabs.map((tab) => ({
            key: tab.code,
            label: tab.name,
          }))}
        />

        <Table
          rowKey="id"
          size="small"
          loading={loading || typesLoading}
          className="dictionaries-table"
          columns={columns}
          dataSource={data?.items ?? []}
          scroll={{ x: 1100 }}
          locale={{
            emptyText: activeType ? '暂无数据' : '请先维护字典类型',
          }}
          rowSelection={
            canDelete
              ? {
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys as string[]),
                }
              : undefined
          }
          pagination={{
            total: data?.total,
            pageSize: data?.pageSize ?? 50,
            current: data?.page ?? 1,
            showSizeChanger: false,
            onChange: (page) => void load(page),
          }}
        />

        <div className="dictionaries-footer">
          <Typography.Text className="dictionaries-footer-tip">
            字典由系统内置预置，平台管理员可维护；字典项被引用时禁止删除，建议停用。
          </Typography.Text>
        </div>
      </section>

      <Modal
        {...withFormModal({
          title: editing ? '编辑字典项' : '新增字典项',
          open,
          onCancel: () => setOpen(false),
          onOk: () => void submit(),
        })}
      >
        <Form form={form} layout="vertical" className="admin-form-grid">
          <Form.Item name="type" label="类型" rules={[{ required: true }]}>
            <Select options={typeOptions} disabled={Boolean(editing)} />
          </Form.Item>
          <Form.Item name="code" label="编码" rules={[{ required: true }]}>
            <Input disabled={Boolean(editing)} placeholder="如 CN" />
          </Form.Item>
          <Form.Item
            name="name"
            label={isLegalDocumentBody ? '正文（HTML）' : '名称 / 配置值'}
            rules={[
              { required: !isLegalDocumentBody, message: '请输入配置值' },
            ]}
            className={isLegalDocumentBody ? 'admin-form-span-2' : undefined}
          >
            {isLegalDocumentBody ? (
              <Input.TextArea
                rows={16}
                placeholder="粘贴用户协议或隐私政策 HTML 正文"
              />
            ) : (
              <Input
                placeholder={
                  isLegalDocumentField
                    ? '输入版本号或日期，如 V1.0、2026-10-26'
                    : '如 中国'
                }
              />
            )}
          </Form.Item>
          {!isLegalDocumentField && (
            <Form.Item name="englishName" label="英文名">
              <Input placeholder="如 China" />
            </Form.Item>
          )}
          <Form.Item
            name="description"
            label="说明"
            className="admin-form-span-2"
          >
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="sort" label="排序" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
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

      <Drawer
        title="维护字典类型"
        width={720}
        open={typeDrawerOpen}
        onClose={() => setTypeDrawerOpen(false)}
        destroyOnClose={false}
        extra={
          canCreate ? (
            <Button type="primary" onClick={openTypeCreate}>
              新增类型
            </Button>
          ) : null
        }
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          系统内置类型可改名称/排序/状态，不可改编码、不可删除。自定义类型可完整维护。
        </Typography.Paragraph>
        <Table
          rowKey="id"
          size="small"
          loading={typesLoading}
          columns={typeColumns}
          dataSource={allTypes}
          pagination={false}
          scroll={{ x: 720 }}
        />
      </Drawer>

      <Modal
        {...withFormModal({
          title: editingType ? '编辑字典类型' : '新增字典类型',
          open: typeFormOpen,
          onCancel: () => setTypeFormOpen(false),
          onOk: () => void submitType(),
          width: 520,
        })}
      >
        <Form form={typeForm} layout="vertical">
          <Form.Item
            name="code"
            label="编码"
            rules={[
              { required: true, message: '请输入编码' },
              {
                pattern: /^[a-z][a-z0-9_]{1,63}$/,
                message: '小写字母开头，仅含小写字母、数字、下划线',
              },
            ]}
            extra="创建后建议不要频繁修改；有字典项时不可改编码"
          >
            <Input
              disabled={Boolean(editingType?.isSystem)}
              placeholder="如 custom_field"
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="如 自定义字段" />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="sort" label="排序" initialValue={100}>
            <InputNumber style={{ width: '100%' }} />
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
    </div>
  );
}
