import './DatasetsPage.css';
import {
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  Form,
  Input,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TableRowActions } from '../components/TableRowActions';
import {
  batchDeleteDatasets,
  createDataset,
  deleteDataset,
  fetchDatasetStats,
  fetchDatasets,
  fetchDictionaries,
  updateDataset,
  type DatasetItem,
  type DictionaryItem,
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

/** 已知来源分类固定配色 */
const CATEGORY_TAG_COLOR: Record<string, string> = {
  intl_org: 'processing',
  national_stats: 'success',
  cn_gov: 'warning',
};

const CATEGORY_COLOR_PALETTE = [
  'blue',
  'purple',
  'cyan',
  'geekblue',
  'magenta',
  'volcano',
  'orange',
  'gold',
  'lime',
  'green',
] as const;

function categoryTagColor(code: string) {
  if (CATEGORY_TAG_COLOR[code]) return CATEGORY_TAG_COLOR[code];
  let hash = 0;
  for (let i = 0; i < code.length; i += 1) {
    hash = (hash * 31 + code.charCodeAt(i)) >>> 0;
  }
  return CATEGORY_COLOR_PALETTE[hash % CATEGORY_COLOR_PALETTE.length];
}

/**
 * 来源管理（原数据集管理页）。
 */
export function DatasetsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate = hasPermission('button:data:dataset:create');
  const canUpdate = hasPermission('button:data:dataset:update');
  const canDelete = hasPermission('button:data:dataset:delete');

  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [regionFilter, setRegionFilter] = useState<string | undefined>();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [categories, setCategories] = useState<DictionaryItem[]>([]);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    activeCount: number;
    byCategory: Array<{ categoryCode: string; count: number }>;
  } | null>(null);
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchDatasets>
  > | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DatasetItem | null>(null);
  const [form] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((item) => map.set(item.code, item.name));
    return map;
  }, [categories]);

  const categoryCount = useCallback(
    (code: string) => {
      if (!stats) return 0;
      if (code === 'all') return stats.total;
      return (
        stats.byCategory.find((row) => row.categoryCode === code)?.count ?? 0
      );
    },
    [stats],
  );

  const loadMeta = useCallback(async () => {
    try {
      const [cats, statsRes, regionPage] = await Promise.all([
        fetchDictionaries({
          page: 1,
          pageSize: 100,
          type: 'source_category',
          status: 'active',
        }),
        fetchDatasetStats(),
        fetchDatasets({ page: 1, pageSize: 100 }),
      ]);
      setCategories(cats.items);
      setStats(statsRes);
      const regions = [
        ...new Set(
          (regionPage.items ?? [])
            .map((item) => item.regionLevel?.trim())
            .filter((v): v is string => Boolean(v)),
        ),
      ].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      setRegionOptions(regions);
    } catch {
      message.error('加载来源分类失败');
    }
  }, []);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const res = await fetchDatasets({
          page,
          pageSize: data?.pageSize ?? 20,
          keyword: keyword || undefined,
          status: statusFilter,
          regionLevel: regionFilter,
          categoryCode:
            activeCategory === 'all' ? undefined : activeCategory,
        });
        setData(res);
      } catch {
        message.error('加载来源列表失败');
      } finally {
        setLoading(false);
      }
    },
    [activeCategory, data?.pageSize, keyword, regionFilter, statusFilter],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    setSelectedRowKeys([]);
    void load(1);
  }, [activeCategory]);

  const handleQuery = () => {
    setSelectedRowKeys([]);
    void load(1);
    void loadMeta();
  };

  const resetQuery = () => {
    setKeyword('');
    setStatusFilter(undefined);
    setRegionFilter(undefined);
    setActiveCategory('all');
    void (async () => {
      setLoading(true);
      try {
        const res = await fetchDatasets({ page: 1, pageSize: 20 });
        setData(res);
        await loadMeta();
      } catch {
        message.error('加载来源列表失败');
      } finally {
        setLoading(false);
      }
    })();
  };

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      status: 'active',
      categoryCode:
        activeCategory !== 'all' ? activeCategory : categories[0]?.code,
    });
    setOpen(true);
  };

  const openEdit = (row: DatasetItem) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      nameEn: row.nameEn,
      categoryCode: row.categoryCode,
      regionLevel: row.regionLevel,
      websiteUrl: row.websiteUrl,
      remark: row.remark,
      status: row.status || 'active',
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name,
      nameEn: values.nameEn || undefined,
      categoryCode: values.categoryCode,
      regionLevel: values.regionLevel || undefined,
      websiteUrl: values.websiteUrl || undefined,
      remark: values.remark || undefined,
      status: values.status,
    };
    try {
      if (editing) {
        await updateDataset(editing.id, payload);
        message.success('已更新');
      } else {
        await createDataset(payload);
        message.success('已创建');
      }
      setOpen(false);
      await load(data?.page ?? 1);
      await loadMeta();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const toggleStatus = (row: DatasetItem) => {
    const next = row.status === 'active' ? 'disabled' : 'active';
    const actionLabel = next === 'disabled' ? '停用' : '启用';
    Modal.confirm({
      title: `确认${actionLabel}「${row.name}」？`,
      content:
        next === 'disabled'
          ? '停用来源不参与联网检索。'
          : '启用来源后可参与联网检索。',
      okText: actionLabel,
      cancelText: '取消',
      onOk: async () => {
        await updateDataset(row.id, { status: next });
        message.success(`已${actionLabel}`);
        await load(data?.page ?? 1);
        await loadMeta();
      },
    });
  };

  const confirmDeleteOne = (row: DatasetItem) => {
    Modal.confirm({
      title: `确认删除「${row.name}」？`,
      content: '删除后不可恢复（软删除）。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          await deleteDataset(row.id);
          message.success('已删除');
          setSelectedRowKeys((prev) => prev.filter((id) => id !== row.id));
          await load(data?.page ?? 1);
          await loadMeta();
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
      title: `确认删除选中的 ${selectedRowKeys.length} 条来源？`,
      content: '删除后不可恢复（软删除）。',
      okText: '批量删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBatchDeleting(true);
        try {
          const result = await batchDeleteDatasets(selectedRowKeys);
          message.success(`已删除 ${result.deleted} 条`);
          setSelectedRowKeys([]);
          await load(data?.page ?? 1);
          await loadMeta();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '批量删除失败');
          throw e;
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  };

  const listTitle =
    activeCategory === 'all'
      ? '全部'
      : categoryMap.get(activeCategory) || activeCategory;

  const columns: ColumnsType<DatasetItem> = [
    {
      title: '编码',
      dataIndex: 'code',
      width: 120,
    },
    {
      title: '来源名称',
      dataIndex: 'name',
      render: (_, row) => (
        <div className="sources-name-cell">
          <span className="sources-name-main">{row.name}</span>
          {row.nameEn ? (
            <span className="sources-name-en">{row.nameEn}</span>
          ) : null}
        </div>
      ),
    },
    {
      title: '分类',
      dataIndex: 'categoryCode',
      width: 140,
      render: (code?: string | null) =>
        code ? (
          <Tag color={categoryTagColor(code)}>
            {categoryMap.get(code) || code}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: '地区/层级',
      dataIndex: 'regionLevel',
      width: 120,
      render: (v?: string | null) => v || '—',
    },
    {
      title: '网站链接',
      dataIndex: 'websiteUrl',
      width: 200,
      ellipsis: true,
      render: (url: string | null | undefined, row) =>
        url ? (
          <Space size={4} wrap={false}>
            <a
              className="sources-link"
              href={/^https?:\/\//i.test(url) ? url : `https://${url}`}
              target="_blank"
              rel="noreferrer"
            >
              {url}
            </a>
            {!row.externalSearchEligible ? (
              <Tooltip title={row.externalSearchIneligibleReason ?? '该链接不能用于 Exa 外部搜索'}>
                <Tag color="warning">不可外搜</Tag>
              </Tooltip>
            ) : null}
          </Space>
        ) : (
          <Space size={4} wrap={false}>
            <span className="sources-link--muted">待补充链接</span>
            <Tooltip title={row.externalSearchIneligibleReason ?? '该链接不能用于 Exa 外部搜索'}>
              <Tag color="warning">不可外搜</Tag>
            </Tooltip>
          </Space>
        ),
    },
    {
      title: '备注',
      dataIndex: 'remark',
      ellipsis: true,
      render: (v?: string | null) => v || '—',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status: string) => {
        const meta = STATUS_META[status] ?? STATUS_META.active;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <TableRowActions
          actions={[
            {
              key: 'edit',
              label: '编辑',
              inline: true,
              hidden: !canUpdate,
              linkClassName: 'sources-action-link',
              onClick: () => openEdit(row),
            },
            {
              key: 'toggle',
              label: row.status === 'active' ? '停用' : '启用',
              hidden: !canUpdate,
              linkClassName:
                row.status === 'active'
                  ? 'sources-action-link sources-action-link--warning'
                  : 'sources-action-link',
              onClick: () => toggleStatus(row),
            },
            {
              key: 'delete',
              label: '删除',
              danger: true,
              hidden: !canDelete,
              linkClassName: 'sources-action-link sources-action-link--danger',
              onClick: () => confirmDeleteOne(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <div className="sources-page">
      <section className="sources-section">
        <div className="sources-title-row">
          <h2 className="sources-title">来源管理</h2>
          <Typography.Text className="sources-stats-tip">
            已启用 {stats?.activeCount ?? 0} / 共 {stats?.total ?? 0}{' '}
            个来源，停用来源不参与联网检索
          </Typography.Text>
        </div>

        <Tabs
          className="sources-tabs"
          activeKey={activeCategory}
          onChange={setActiveCategory}
          items={[
            {
              key: 'all',
              label: `全部（${categoryCount('all')}）`,
            },
            ...categories.map((cat) => ({
              key: cat.code,
              label: `${cat.name}（${categoryCount(cat.code)}）`,
            })),
          ]}
        />

        <div className="sources-toolbar">
          <div className="sources-toolbar-filters">
            <Input
              allowClear
              placeholder="按名称 / 英文名 / 地区 / 网址搜索"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onPressEnter={handleQuery}
            />
            <Select
              allowClear
              placeholder="全部状态"
              value={statusFilter}
              options={[
                { value: 'active', label: '启用' },
                { value: 'disabled', label: '停用' },
              ]}
              onChange={setStatusFilter}
            />
            <Select
              allowClear
              showSearch
              className="sources-filter-region"
              placeholder="全部地区/层级"
              value={regionFilter}
              options={regionOptions.map((r) => ({ value: r, label: r }))}
              onChange={setRegionFilter}
              optionFilterProp="label"
            />
            <Button
              icon={<SearchOutlined />}
              className="sources-search-btn"
              onClick={handleQuery}
            >
              搜索
            </Button>
            <Button icon={<ReloadOutlined />} onClick={resetQuery}>
              重置
            </Button>
          </div>
          <div className="sources-toolbar-actions">
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
            {canCreate ? (
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={openCreate}
              >
                新增来源
              </Button>
            ) : null}
          </div>
        </div>

        <div className="sources-table-head">
          <span className="sources-table-title">来源列表 · {listTitle}</span>
        </div>

        <Table
          rowKey="id"
          size="small"
          loading={loading}
          className="sources-table"
          columns={columns}
          dataSource={data?.items ?? []}
          scroll={{ x: 1100 }}
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
            pageSize: data?.pageSize ?? 20,
            current: data?.page ?? 1,
            showSizeChanger: true,
            pageSizeOptions: ['10', '20', '50'],
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, pageSize) => {
              void (async () => {
                setLoading(true);
                try {
                  const res = await fetchDatasets({
                    page,
                    pageSize,
                    keyword: keyword || undefined,
                    status: statusFilter,
                    regionLevel: regionFilter,
                    categoryCode:
                      activeCategory === 'all' ? undefined : activeCategory,
                  });
                  setData(res);
                } finally {
                  setLoading(false);
                }
              })();
            },
          }}
        />
      </section>

      <Modal
        {...withFormModal({
          title: editing ? '编辑来源' : '新增来源',
          open,
          onCancel: () => setOpen(false),
          onOk: () => void submit(),
          okText: '保存',
          width: 560,
        })}
      >
        <Form form={form} layout="vertical" className="admin-form-grid">
          <Form.Item
            name="name"
            label="来源名称"
            rules={[{ required: true, message: '请输入来源名称' }]}
            className="admin-form-span-2"
          >
            <Input placeholder="如 中国国家统计局" />
          </Form.Item>
          <Form.Item name="nameEn" label="英文名" className="admin-form-span-2">
            <Input placeholder="如 National Bureau of Statistics of China" />
          </Form.Item>
          <Form.Item
            name="categoryCode"
            label="分类"
            rules={[{ required: true, message: '请选择分类' }]}
          >
            <Select
              options={categories.map((c) => ({
                value: c.code,
                label: c.name,
              }))}
              placeholder="选择来源分类"
            />
          </Form.Item>
          <Form.Item name="regionLevel" label="地区/层级">
            <Input placeholder="如 国际 / 中国 / 巴林" />
          </Form.Item>
          <Form.Item
            name="websiteUrl"
            label="网站链接"
            className="admin-form-span-2"
          >
            <Input placeholder="如 www.stats.gov.cn" />
          </Form.Item>
          <Form.Item name="remark" label="备注" className="admin-form-span-2">
            <Input placeholder="如 核心数据源 / 显示维护中" />
          </Form.Item>
          <Form.Item
            name="status"
            label="状态"
            initialValue="active"
            className="admin-form-span-2"
          >
            <Radio.Group>
              <Radio value="active">启用</Radio>
              <Radio value="disabled">停用</Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
