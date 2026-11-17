import './IndicatorsPage.css';
import {
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  Drawer,
  Form,
  Input,
  Modal,
  Radio,
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
  batchDeleteIndicators,
  createIndicator,
  createIndicatorSourceMapping,
  deleteIndicator,
  deleteIndicatorSourceMapping,
  fetchDatasets,
  fetchDictionaries,
  fetchIndicatorDetail,
  fetchIndicatorSourceMappings,
  fetchIndicators,
  updateIndicator,
  updateIndicatorSourceMapping,
  type DatasetItem,
  type IndicatorItem,
  type IndicatorSourceMappingItem,
} from '../api/admin';
import { FORM_MODAL_WIDTH, withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';

const TRANSFORM_OPTIONS = [{ value: 'direct', label: '直接映射' }];

const TRANSFORM_LABELS: Record<string, string> = {
  direct: '直接映射',
};

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

/**
 * 标准指标库管理。
 */
export function IndicatorsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchIndicators>
  > | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<IndicatorItem | null>(null);
  const [form] = Form.useForm();

  const [mappingOpen, setMappingOpen] = useState(false);
  const [mappingItem, setMappingItem] = useState<IndicatorItem | null>(null);
  const [mappingLoading, setMappingLoading] = useState(false);
  const [mappings, setMappings] = useState<IndicatorSourceMappingItem[]>([]);

  const [mappingFormOpen, setMappingFormOpen] = useState(false);
  const [editingMapping, setEditingMapping] =
    useState<IndicatorSourceMappingItem | null>(null);
  const [mappingForm] = Form.useForm();
  const [mappingSaving, setMappingSaving] = useState(false);
  const [sourceOptions, setSourceOptions] = useState<DatasetItem[]>([]);
  const [sourceOptionsLoading, setSourceOptionsLoading] = useState(false);
  const [categoryOptions, setCategoryOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const canDelete = hasPermission('button:data:indicator:delete');

  const loadSourceOptions = useCallback(async () => {
    setSourceOptionsLoading(true);
    try {
      const pageSize = 100;
      let page = 1;
      let total = Infinity;
      const items: DatasetItem[] = [];
      while (items.length < total) {
        const res = await fetchDatasets({
          page,
          pageSize,
          status: 'active',
        });
        items.push(...(res.items ?? []));
        total = res.total ?? items.length;
        if (!res.items?.length) break;
        page += 1;
        if (page > 50) break;
      }
      setSourceOptions(items);
    } catch {
      message.error('加载数据源列表失败');
      setSourceOptions([]);
    } finally {
      setSourceOptionsLoading(false);
    }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await fetchDictionaries({
        page: 1,
        pageSize: 100,
        type: 'indicator_category',
        status: 'active',
      });
      const options = (res?.items ?? [])
        .slice()
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((item) => ({ value: item.name, label: item.name }));
      setCategoryOptions(options);
    } catch {
      setCategoryOptions([]);
      message.error('加载指标分类失败');
    }
  }, []);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        setData(
          await fetchIndicators({
            page,
            pageSize: 50,
            keyword: keyword.trim() || undefined,
            category: categoryFilter,
            status: statusFilter,
          }),
        );
      } catch {
        message.error('加载指标列表失败');
      } finally {
        setLoading(false);
      }
    },
    [keyword, categoryFilter, statusFilter],
  );

  const reloadMappings = async (indicatorId: string) => {
    const list = await fetchIndicatorSourceMappings(indicatorId);
    setMappings(list);
    return list;
  };

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleQuery = () => {
    void load(1);
  };

  const resetQuery = async () => {
    setKeyword('');
    setCategoryFilter(undefined);
    setStatusFilter(undefined);
    setLoading(true);
    try {
      setData(
        await fetchIndicators({
          page: 1,
          pageSize: 50,
        }),
      );
      message.success('已重置查询条件');
    } catch {
      message.error('重置失败');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'active' });
    setOpen(true);
    void loadCategories();
  };

  const openEdit = async (row: IndicatorItem) => {
    setEditing(row);
    form.setFieldsValue(row);
    setOpen(true);
    try {
      const res = await fetchDictionaries({
        page: 1,
        pageSize: 100,
        type: 'indicator_category',
        status: 'active',
      });
      const options = (res?.items ?? [])
        .slice()
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((item) => ({ value: item.name, label: item.name }));
      if (
        row.category &&
        !options.some((opt) => opt.value === row.category)
      ) {
        options.push({ value: row.category, label: row.category });
      }
      setCategoryOptions(options);
    } catch {
      setCategoryOptions(
        row.category ? [{ value: row.category, label: row.category }] : [],
      );
    }
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (editing) {
      // 编码创建后不可改，且 UpdateIndicatorDto 禁止 code 字段（forbidNonWhitelisted）
      const { code: _code, ...payload } = values as Record<string, unknown> & {
        code?: string;
      };
      await updateIndicator(editing.id, payload);
      message.success('指标已更新');
    } else {
      await createIndicator(values);
      message.success('指标已创建');
    }
    setOpen(false);
    await load(data?.page ?? 1);
  };

  const toggleStatus = (row: IndicatorItem) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const actionLabel = next === 'disabled' ? '停用' : '启用';
    Modal.confirm({
      title: `确认${actionLabel}指标「${row.name}」？`,
      okText: actionLabel,
      cancelText: '取消',
      onOk: async () => {
        await updateIndicator(row.id, { status: next });
        message.success(`已${actionLabel}`);
        await load(data?.page ?? 1);
      },
    });
  };

  const confirmDeleteOne = (row: IndicatorItem) => {
    Modal.confirm({
      title: `确认删除指标「${row.name}」？`,
      content: '删除后不可恢复（软删除）。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteIndicator(row.id);
        message.success('已删除');
        setSelectedRowKeys((prev) => prev.filter((id) => id !== row.id));
        await load(data?.page ?? 1);
      },
    });
  };

  const confirmBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认删除选中的 ${selectedRowKeys.length} 条指标？`,
      content: '删除后不可恢复（软删除）。',
      okText: '批量删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true);
        try {
          const result = await batchDeleteIndicators(selectedRowKeys);
          message.success(`已删除 ${result.deleted} 条`);
          setSelectedRowKeys([]);
          await load(data?.page ?? 1);
        } catch {
          message.error('批量删除失败');
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  };

  const openMapping = async (row: IndicatorItem) => {
    setMappingOpen(true);
    setMappingLoading(true);
    setMappingItem(row);
    setMappings([]);
    try {
      const detail = await fetchIndicatorDetail(row.id);
      setMappingItem(detail);
      setMappings(await reloadMappings(row.id));
    } catch {
      message.error('加载来源映射失败');
    } finally {
      setMappingLoading(false);
    }
  };

  const refreshMappingPanel = async () => {
    if (!mappingItem) return;
    const detail = await fetchIndicatorDetail(mappingItem.id);
    setMappingItem(detail);
    await reloadMappings(mappingItem.id);
    await load(data?.page ?? 1);
  };

  const openCreateMapping = () => {
    setEditingMapping(null);
    mappingForm.resetFields();
    mappingForm.setFieldsValue({
      transform: 'direct',
      status: 'active',
    });
    setMappingFormOpen(true);
    void loadSourceOptions();
  };

  const openEditMapping = (row: IndicatorSourceMappingItem) => {
    setEditingMapping(row);
    mappingForm.setFieldsValue(row);
    setMappingFormOpen(true);
    void loadSourceOptions();
  };

  const submitMapping = async () => {
    if (!mappingItem) return;
    const values = await mappingForm.validateFields();
    setMappingSaving(true);
    try {
      if (editingMapping) {
        await updateIndicatorSourceMapping(
          mappingItem.id,
          editingMapping.id,
          values,
        );
        message.success('来源映射已更新');
      } else {
        await createIndicatorSourceMapping(mappingItem.id, values);
        message.success('来源映射已新增');
      }
      setMappingFormOpen(false);
      await refreshMappingPanel();
    } catch {
      message.error(editingMapping ? '更新失败' : '新增失败');
    } finally {
      setMappingSaving(false);
    }
  };

  const removeMapping = (row: IndicatorSourceMappingItem) => {
    if (!mappingItem) return;
    Modal.confirm({
      title: '确认移除该来源映射？',
      content: `${row.dataSource} · ${row.sourceField}`,
      okText: '移除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await deleteIndicatorSourceMapping(mappingItem.id, row.id);
        message.success('已移除');
        await refreshMappingPanel();
      },
    });
  };

  const mappingColumns: ColumnsType<IndicatorSourceMappingItem> = [
    {
      title: '数据源',
      dataIndex: 'dataSource',
      width: 140,
      ellipsis: true,
    },
    {
      title: '来源字段',
      dataIndex: 'sourceField',
      ellipsis: true,
    },
    {
      title: '换算/处理',
      dataIndex: 'transform',
      width: 110,
      render: (value: string) => TRANSFORM_LABELS[value] ?? value,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? {
          label: status,
          color: 'default' as const,
        };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      width: 120,
      render: (_, row) => (
        <Space size={4}>
          {hasPermission('button:data:indicator:update') ? (
            <>
              <Button
                type="link"
                className="indicators-action-link"
                onClick={() => openEditMapping(row)}
              >
                编辑
              </Button>
              <Button
                type="link"
                className="indicators-action-link indicators-mapping-action-danger"
                onClick={() => removeMapping(row)}
              >
                移除
              </Button>
            </>
          ) : null}
        </Space>
      ),
    },
  ];

  const columns: ColumnsType<IndicatorItem> = [
    {
      title: '指标编码',
      dataIndex: 'code',
      width: 260,
      className: 'indicators-code-cell',
    },
    {
      title: '指标名称',
      dataIndex: 'name',
      width: 140,
      ellipsis: true,
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 110,
    },
    {
      title: '单位',
      dataIndex: 'unit',
      width: 90,
    },
    {
      title: '定义 / 口径',
      dataIndex: 'definition',
      ellipsis: true,
      render: (value: string) => (
        <span className="indicators-def-cell" title={value}>
          {value}
        </span>
      ),
    },
    {
      title: '数据来源',
      dataIndex: 'source',
      width: 140,
      ellipsis: true,
    },
    {
      title: '来源映射',
      width: 110,
      render: (_, row) =>
        row.mappingCount > 0 ? (
          <Tag color="blue">{row.mappingCount} 个来源</Tag>
        ) : (
          <Tag>无映射</Tag>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      defaultSortOrder: 'descend',
      sorter: (a, b) =>
        new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(),
      render: (value: string) => formatDateTime(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? {
          label: status,
          color: 'default' as const,
        };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4} wrap>
          {hasPermission('button:data:indicator:update') ? (
            <Button
              type="link"
              className="indicators-action-link"
              onClick={() => void openEdit(row)}
            >
              编辑
            </Button>
          ) : null}
          {hasPermission('menu:data:indicator') ? (
            <Button
              type="link"
              className="indicators-action-link"
              onClick={() => void openMapping(row)}
            >
              映射
            </Button>
          ) : null}
          {hasPermission('button:data:indicator:update') ? (
            <Button
              type="link"
              className={
                row.status === 'active'
                  ? 'indicators-action-link indicators-action-link--warning'
                  : 'indicators-action-link'
              }
              onClick={() => toggleStatus(row)}
            >
              {row.status === 'active' ? '停用' : '启用'}
            </Button>
          ) : null}
          {canDelete ? (
            <Button
              type="link"
              className="indicators-action-link indicators-mapping-action-danger"
              onClick={() => confirmDeleteOne(row)}
            >
              删除
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  return (
    <div className="indicators-page">
      <section className="indicators-section">
        <div className="indicators-toolbar">
          <div className="indicators-toolbar-filters">
            <Input
              allowClear
              placeholder="按名称 / 编码搜索"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={handleQuery}
            />
            <Select
              allowClear
              placeholder="全部分类"
              className="indicators-filter-select--category"
              value={categoryFilter}
              options={categoryOptions}
              onChange={setCategoryFilter}
            />
            <Select
              allowClear
              placeholder="全部状态"
              className="indicators-filter-select--status"
              value={statusFilter}
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
              onChange={setStatusFilter}
            />
            <Button
              icon={<SearchOutlined />}
              className="indicators-search-btn"
              onClick={handleQuery}
            >
              搜索
            </Button>
            <Button icon={<ReloadOutlined />} onClick={() => void resetQuery()}>
              重置
            </Button>
          </div>
          <div className="indicators-toolbar-actions">
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
            {hasPermission('button:data:indicator:create') ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                新增指标
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="indicators-section">
        <div className="indicators-table-head">
          <span className="indicators-table-title">指标列表</span>
          <Typography.Text type="secondary" className="indicators-table-meta">
            <InfoCircleOutlined /> 共 {data?.total ?? 0} 条
          </Typography.Text>
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          className="indicators-table"
          columns={columns}
          dataSource={data?.items ?? []}
          scroll={{ x: 1280 }}
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
      </section>

      <Modal
        {...withFormModal({
          title: editing ? '编辑指标' : '新增指标',
          open,
          width: FORM_MODAL_WIDTH,
          onCancel: () => setOpen(false),
          onOk: () => void submit(),
        })}
      >
        <Form form={form} labelCol={{ span: 5 }} wrapperCol={{ span: 19 }}>
          <Form.Item
            name="code"
            label="指标编码"
            rules={[{ required: true, message: '请输入指标编码' }]}
          >
            <Input
              disabled={Boolean(editing)}
              placeholder="如 GDP_GROWTH，全局唯一"
            />
          </Form.Item>
          <Form.Item
            name="name"
            label="指标名称"
            rules={[{ required: true, message: '请输入指标名称' }]}
          >
            <Input placeholder="指标名称" />
          </Form.Item>
          <Form.Item
            name="category"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select
              placeholder="请选择"
              options={categoryOptions}
              notFoundContent="请先在「字典管理」中维护指标分类"
            />
          </Form.Item>
          <Form.Item
            name="unit"
            label="单位"
            rules={[{ required: true, message: '请输入单位' }]}
          >
            <Input placeholder="如 % / 亿美元" />
          </Form.Item>
          <Form.Item
            name="definition"
            label="定义"
            rules={[{ required: true, message: '请输入定义' }]}
          >
            <Input.TextArea rows={3} placeholder="指标定义 / 口径说明" />
          </Form.Item>
          <Form.Item
            name="source"
            label="数据来源"
            rules={[{ required: true, message: '请输入数据来源' }]}
          >
            <Input placeholder="如 世界银行 WDI" />
          </Form.Item>
          <Form.Item name="status" label="状态" initialValue="active">
            <Radio.Group>
              <Radio value="active">启用</Radio>
              <Radio value="disabled">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="来源映射"
        placement="right"
        width={720}
        open={mappingOpen}
        onClose={() => setMappingOpen(false)}
        destroyOnClose
        className="indicators-mapping-drawer"
      >
        <Typography.Text type="secondary" className="indicators-mapping-subtitle">
          将外部数据源字段绑定到统一指标，支撑数据标准化与跨来源比较
        </Typography.Text>

        {mappingItem ? (
          <div className="indicators-mapping-summary">
            <div className="indicators-mapping-summary-title">
              {mappingItem.name}
            </div>
            <div className="indicators-mapping-summary-meta">
              <span>指标编码：{mappingItem.code}</span>
              <span>单位：{mappingItem.unit}</span>
              <span>数据来源：{mappingItem.source}</span>
            </div>
          </div>
        ) : null}

        <div className="indicators-mapping-toolbar">
          <span className="indicators-mapping-count">
            已配置 {mappings.length} 个来源字段
          </span>
          {hasPermission('button:data:indicator:update') ? (
            <Button icon={<PlusOutlined />} onClick={openCreateMapping}>
              新增映射
            </Button>
          ) : null}
        </div>

        <Table
          rowKey="id"
          size="small"
          loading={mappingLoading}
          className="indicators-mapping-table"
          columns={mappingColumns}
          dataSource={mappings}
          pagination={false}
          scroll={{ x: 880 }}
          locale={{ emptyText: '暂无来源映射，点击「新增映射」添加' }}
        />
      </Drawer>

      <Modal
        {...withFormModal({
          title: editingMapping ? '编辑来源映射' : '新增来源映射',
          open: mappingFormOpen,
          onCancel: () => setMappingFormOpen(false),
          onOk: () => void submitMapping(),
          confirmLoading: mappingSaving,
          okText: '保存',
          width: 560,
        })}
      >
        <Form form={mappingForm} layout="vertical" className="admin-form-grid">
          <Form.Item label="所属指标" className="admin-form-span-2">
            <Input value={mappingItem?.code ?? ''} disabled />
          </Form.Item>
          <Form.Item
            name="dataSource"
            label="数据源"
            rules={[{ required: true, message: '请选择数据源' }]}
            className="admin-form-span-2"
          >
            <Select
              showSearch
              allowClear
              loading={sourceOptionsLoading}
              placeholder="请选择来源（来源管理）"
              optionFilterProp="label"
              options={(() => {
                const opts = sourceOptions.map((s) => ({
                  value: s.name,
                  label: s.nameEn
                    ? `${s.name} / ${s.nameEn}（${s.code}）`
                    : `${s.name}（${s.code}）`,
                }));
                const current = editingMapping?.dataSource?.trim();
                if (current && !opts.some((o) => o.value === current)) {
                  opts.unshift({
                    value: current,
                    label: `${current}（已有）`,
                  });
                }
                return opts;
              })()}
              notFoundContent={
                sourceOptionsLoading
                  ? '加载中…'
                  : '暂无启用中的来源，请先在来源管理维护'
              }
            />
          </Form.Item>
          <Form.Item
            name="sourceField"
            label="来源字段"
            rules={[{ required: true, message: '请输入来源字段' }]}
            className="admin-form-span-2"
          >
            <Input placeholder="如 WDI.NY.GDP.MKTP.KD.ZG" />
          </Form.Item>
          <Form.Item
            name="transform"
            label="换算/处理"
            initialValue="direct"
            className="admin-form-span-2"
          >
            <Select options={TRANSFORM_OPTIONS} />
          </Form.Item>
          {!editingMapping ? (
            <Form.Item name="status" label="状态" initialValue="active" hidden>
              <Input />
            </Form.Item>
          ) : (
            <Form.Item
              name="status"
              label="状态"
              className="admin-form-span-2"
            >
              <Radio.Group>
                <Radio value="active">启用</Radio>
                <Radio value="disabled">停用</Radio>
              </Radio.Group>
            </Form.Item>
          )}
        </Form>
      </Modal>
    </div>
  );
}
