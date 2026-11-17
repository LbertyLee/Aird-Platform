import './FieldMappingsPage.css';
import {
  CheckOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  Button,
  Form,
  Input,
  InputNumber,
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
  batchAcceptFieldMappings,
  batchDeleteFieldMappings,
  batchDismissFieldMappings,
  createFieldMapping,
  deleteFieldMapping,
  fetchDatasetFieldOptions,
  fetchFieldMappingDatasetOptions,
  fetchFieldMappings,
  fetchIndicators,
  reapplyAutoFieldMappings,
  updateFieldMapping,
  type DatasetFieldOption,
  type FieldMappingItem,
  type IndicatorItem,
  type KnowledgeStructuredDatasetOption,
} from '../api/admin';
import { FORM_MODAL_WIDTH, withFormModal } from '../components/form-modal';
import { useSessionStore } from '../stores/session';

const STATUS_META: Record<
  string,
  { label: string; color: 'success' | 'default' }
> = {
  active: { label: '启用', color: 'success' },
  disabled: { label: '停用', color: 'default' },
};

const SOURCE_META: Record<
  string,
  { label: string; color: 'blue' | 'orange' | 'default' }
> = {
  manual: { label: '手动', color: 'default' },
  auto: { label: '自动', color: 'blue' },
  auto_pending: { label: '待确认', color: 'orange' },
};

const AGGREGATION_OPTIONS = [
  { value: 'SUM', label: 'SUM 求和' },
  { value: 'AVG', label: 'AVG 平均' },
  { value: 'COUNT', label: 'COUNT 计数' },
  { value: 'MAX', label: 'MAX 最大' },
  { value: 'MIN', label: 'MIN 最小' },
  { value: 'NONE', label: 'NONE 原值' },
];

/**
 * Semantic Layer：指标 ↔ 知识库结构化文件字段映射。
 */
export function FieldMappingsPage() {
  const hasPermission = useSessionStore((s) => s.hasPermission);
  const canCreate = hasPermission('button:data:field-mapping:create');
  const canUpdate = hasPermission('button:data:field-mapping:update');
  const canDelete = hasPermission('button:data:field-mapping:delete');

  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [indicatorFilter, setIndicatorFilter] = useState<string | undefined>();
  const [datasetFilter, setDatasetFilter] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchFieldMappings>
  > | null>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<FieldMappingItem | null>(null);
  const [form] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [batchReviewing, setBatchReviewing] = useState(false);
  const [reapplying, setReapplying] = useState(false);

  const [indicatorOptions, setIndicatorOptions] = useState<IndicatorItem[]>([]);
  const [datasetOptions, setDatasetOptions] = useState<
    KnowledgeStructuredDatasetOption[]
  >([]);
  const [fieldOptions, setFieldOptions] = useState<DatasetFieldOption[]>([]);
  const [fieldOptionsLoading, setFieldOptionsLoading] = useState(false);

  const loadIndicatorOptions = useCallback(async () => {
    try {
      const res = await fetchIndicators({
        page: 1,
        pageSize: 100,
        status: 'active',
      });
      setIndicatorOptions(res.items ?? []);
    } catch {
      setIndicatorOptions([]);
    }
  }, []);

  const loadDatasetOptions = useCallback(async () => {
    try {
      const rows = await fetchFieldMappingDatasetOptions();
      setDatasetOptions(rows);
    } catch {
      setDatasetOptions([]);
    }
  }, []);

  const loadFieldOptions = useCallback(async (datasetId?: string) => {
    setFieldOptionsLoading(true);
    try {
      const rows = await fetchDatasetFieldOptions({ datasetId });
      setFieldOptions(rows);
    } catch {
      message.error('加载结构化字段失败（需知识库文件学习完成）');
      setFieldOptions([]);
    } finally {
      setFieldOptionsLoading(false);
    }
  }, []);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const res = await fetchFieldMappings({
          page,
          pageSize: 20,
          keyword: keyword.trim() || undefined,
          indicatorId: indicatorFilter,
          datasetId: datasetFilter,
          status: statusFilter,
          source: sourceFilter,
        });
        setData(res);
        setSelectedRowKeys([]);
      } catch {
        message.error('加载字段映射失败');
      } finally {
        setLoading(false);
      }
    },
    [keyword, indicatorFilter, datasetFilter, statusFilter, sourceFilter],
  );

  useEffect(() => {
    void loadIndicatorOptions();
    void loadDatasetOptions();
  }, [loadIndicatorOptions, loadDatasetOptions]);

  useEffect(() => {
    void load(1);
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      aggregation: 'SUM',
      priority: 0,
      status: 'active',
    });
    void loadFieldOptions();
    setOpen(true);
  };

  const openEdit = (row: FieldMappingItem) => {
    setEditing(row);
    const datasetId = row.datasetField.dataset?.id;
    form.setFieldsValue({
      indicatorId: row.indicatorId,
      datasetId,
      datasetFieldId: row.datasetFieldId,
      aggregation: row.aggregation,
      formula: row.formula ?? '',
      condition: row.condition ?? '',
      priority: row.priority,
      status: row.status,
    });
    void loadFieldOptions(datasetId);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    try {
      const payload = {
        indicatorId: values.indicatorId as string,
        datasetFieldId: values.datasetFieldId as string,
        aggregation: values.aggregation as string,
        formula: (values.formula as string)?.trim() || undefined,
        condition: (values.condition as string)?.trim() || undefined,
        priority: Number(values.priority ?? 0),
        status: values.status as string,
      };
      if (editing) {
        await updateFieldMapping(editing.id, payload);
        message.success('已更新字段映射');
      } else {
        await createFieldMapping(payload);
        message.success('已创建字段映射');
      }
      setOpen(false);
      void load(data?.page ?? 1);
    } catch (err) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      message.error(editing ? '更新失败' : '创建失败');
    }
  };

  const onDelete = (row: FieldMappingItem) => {
    Modal.confirm({
      title: '删除字段映射？',
      content: `${row.indicator.name} → ${row.datasetField.fieldName}`,
      okType: 'danger',
      onOk: async () => {
        await deleteFieldMapping(row.id);
        message.success('已删除');
        void load(data?.page ?? 1);
      },
    });
  };

  const onBatchDelete = () => {
    if (!selectedRowKeys.length) return;
    Modal.confirm({
      title: `删除选中的 ${selectedRowKeys.length} 条映射？`,
      okType: 'danger',
      onOk: async () => {
        setBatchDeleting(true);
        try {
          await batchDeleteFieldMappings(selectedRowKeys);
          message.success('批量删除成功');
          void load(data?.page ?? 1);
        } finally {
          setBatchDeleting(false);
        }
      },
    });
  };

  const onBatchAccept = async () => {
    if (!selectedRowKeys.length) return;
    setBatchReviewing(true);
    try {
      const res = await batchAcceptFieldMappings(selectedRowKeys);
      message.success(
        `已采纳 ${res.accepted} 条，新增别名 ${res.aliasesAdded} 个`,
      );
      void load(data?.page ?? 1);
    } catch {
      message.error('批量采纳失败');
    } finally {
      setBatchReviewing(false);
    }
  };

  const onBatchDismiss = () => {
    if (!selectedRowKeys.length) return;
    Modal.confirm({
      title: `忽略选中的 ${selectedRowKeys.length} 条自动建议？`,
      content: '将删除这些自动映射建议，不会影响手工映射。',
      onOk: async () => {
        setBatchReviewing(true);
        try {
          const res = await batchDismissFieldMappings(selectedRowKeys);
          message.success(`已忽略 ${res.deleted} 条`);
          void load(data?.page ?? 1);
        } catch {
          message.error('批量忽略失败');
        } finally {
          setBatchReviewing(false);
        }
      },
    });
  };

  const onReapplyAuto = () => {
    Modal.confirm({
      title: datasetFilter
        ? '对当前筛选的结构化文件重跑自动映射？'
        : '对全部知识库结构化 READY 文件重跑自动映射？',
      content: '不会覆盖手工映射；高置信度自动启用，中置信度进入待确认。',
      onOk: async () => {
        setReapplying(true);
        try {
          const res = await reapplyAutoFieldMappings(datasetFilter);
          const summary = res.results.reduce(
            (acc, row) => ({
              created: acc.created + row.created,
              updated: acc.updated + row.updated,
              pending: acc.pending + row.pending,
            }),
            { created: 0, updated: 0, pending: 0 },
          );
          message.success(
            `已处理 ${res.datasets} 个文件：新建 ${summary.created}，更新 ${summary.updated}，待确认 ${summary.pending}`,
          );
          void load(1);
        } catch {
          message.error('自动映射重跑失败');
        } finally {
          setReapplying(false);
        }
      },
    });
  };

  const columns: ColumnsType<FieldMappingItem> = [
    {
      title: '指标',
      key: 'indicator',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.indicator.name}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.indicator.code}
            {row.indicator.unit ? ` · ${row.indicator.unit}` : ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '结构化文件',
      key: 'dataset',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>
            {row.datasetField.dataset?.name ?? '-'}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.datasetField.dataset?.code}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '字段',
      key: 'field',
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text code>
            {row.datasetField.displayName || row.datasetField.fieldName}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {row.datasetField.fieldName} · {row.datasetField.dataType}
            {row.datasetField.semanticType
              ? ` · ${row.datasetField.semanticType}`
              : ''}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 100,
      render: (v: string, row) => {
        const meta = SOURCE_META[v] ?? SOURCE_META.manual;
        return (
          <Space direction="vertical" size={0}>
            <Tag color={meta.color}>{meta.label}</Tag>
            {typeof row.confidence === 'number' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {(row.confidence * 100).toFixed(0)}%
                {row.matchTerm ? ` · ${row.matchTerm}` : ''}
              </Typography.Text>
            ) : null}
          </Space>
        );
      },
    },
    {
      title: '聚合',
      dataIndex: 'aggregation',
      width: 90,
      render: (v: string) => <Tag>{v}</Tag>,
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 80,
      align: 'right',
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: string) => {
        const meta = STATUS_META[v] ?? STATUS_META.disabled;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      fixed: 'right',
      render: (_, row) => (
        <Space size={0} wrap>
          {canUpdate && row.source === 'auto_pending' && (
            <Button
              type="link"
              size="small"
              onClick={async () => {
                try {
                  await batchAcceptFieldMappings([row.id]);
                  message.success('已采纳并写入别名');
                  void load(data?.page ?? 1);
                } catch {
                  message.error('采纳失败');
                }
              }}
            >
              采纳
            </Button>
          )}
          {canUpdate && (
            <Button type="link" size="small" onClick={() => openEdit(row)}>
              编辑
            </Button>
          )}
          {canDelete && (
            <Button type="link" size="small" danger onClick={() => onDelete(row)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="field-mappings-page">
      <div className="field-mappings-toolbar">
        <Space wrap>
          <Input
            allowClear
            placeholder="搜索指标/字段"
            prefix={<SearchOutlined />}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onPressEnter={() => void load(1)}
            style={{ width: 200 }}
          />
          <Select
            allowClear
            placeholder="指标"
            style={{ width: 200 }}
            value={indicatorFilter}
            onChange={setIndicatorFilter}
            options={indicatorOptions.map((i) => ({
              value: i.id,
              label: `${i.name} (${i.code})`,
            }))}
            showSearch
            optionFilterProp="label"
          />
          <Select
            allowClear
            placeholder="知识库结构化文件"
            style={{ width: 260 }}
            value={datasetFilter}
            onChange={setDatasetFilter}
            options={datasetOptions.map((d) => ({
              value: d.id,
              label: d.label,
            }))}
            showSearch
            optionFilterProp="label"
            notFoundContent="暂无已学习完成的结构化文件"
          />
          <Select
            allowClear
            placeholder="来源"
            style={{ width: 130 }}
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: 'manual', label: '手动' },
              { value: 'auto', label: '自动' },
              { value: 'auto_pending', label: '待确认' },
            ]}
          />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 120 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '停用' },
            ]}
          />
          <Button icon={<SearchOutlined />} onClick={() => void load(1)}>
            查询
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setKeyword('');
              setIndicatorFilter(undefined);
              setDatasetFilter(undefined);
              setStatusFilter(undefined);
              setSourceFilter(undefined);
            }}
          >
            重置
          </Button>
        </Space>
        <Space wrap>
          {canUpdate && selectedRowKeys.length > 0 && (
            <Button
              icon={<CheckOutlined />}
              loading={batchReviewing}
              onClick={() => void onBatchAccept()}
            >
              批量采纳 ({selectedRowKeys.length})
            </Button>
          )}
          {canDelete && selectedRowKeys.length > 0 && (
            <Button loading={batchReviewing} onClick={onBatchDismiss}>
              批量忽略
            </Button>
          )}
          {canDelete && selectedRowKeys.length > 0 && (
            <Button danger loading={batchDeleting} onClick={onBatchDelete}>
              批量删除 ({selectedRowKeys.length})
            </Button>
          )}
          {canCreate && (
            <Button
              icon={<ThunderboltOutlined />}
              loading={reapplying}
              onClick={onReapplyAuto}
            >
              重新自动映射
            </Button>
          )}
          {canCreate && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新建映射
            </Button>
          )}
        </Space>
      </div>

      <Typography.Paragraph type="secondary" className="field-mappings-hint">
        结构化文件学习完成后会按字段名/别名自动匹配：仅规则满分(100%)直接启用；
        其余候选交由 LLM 审核，通过才启用，拒绝则丢弃；LLM 不可用时进入「待确认」。
        手工映射不会被自动任务覆盖。
      </Typography.Paragraph>

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data?.items ?? []}
        scroll={{ x: 1280 }}
        rowSelection={
          canDelete || canUpdate
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }
            : undefined
        }
        pagination={{
          current: data?.page ?? 1,
          pageSize: data?.pageSize ?? 20,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: (page) => void load(page),
        }}
      />

      <Modal
        {...withFormModal}
        title={editing ? '编辑字段映射' : '新建字段映射'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={() => void submit()}
        width={FORM_MODAL_WIDTH}
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="indicatorId"
            label="指标"
            rules={[{ required: true, message: '请选择指标' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="选择标准指标"
              options={indicatorOptions.map((i) => ({
                value: i.id,
                label: `${i.name} (${i.code})`,
              }))}
            />
          </Form.Item>
          <Form.Item name="datasetId" label="知识库结构化文件">
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="可选：按文件筛选字段"
              options={datasetOptions.map((d) => ({
                value: d.id,
                label: d.label,
              }))}
              notFoundContent="暂无已学习完成的结构化文件"
              onChange={(id?: string) => {
                form.setFieldValue('datasetFieldId', undefined);
                void loadFieldOptions(id);
              }}
            />
          </Form.Item>
          <Form.Item
            name="datasetFieldId"
            label="结构化字段"
            rules={[{ required: true, message: '请选择结构化字段' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              loading={fieldOptionsLoading}
              placeholder={
                fieldOptions.length
                  ? '选择 READY 版本字段'
                  : '暂无可用字段，请先上传并完成知识库学习'
              }
              options={fieldOptions.map((f) => ({
                value: f.id,
                label: f.label,
              }))}
              notFoundContent={
                fieldOptionsLoading ? '加载中…' : '无 READY 版本字段'
              }
            />
          </Form.Item>
          <Form.Item
            name="aggregation"
            label="聚合方式"
            rules={[{ required: true }]}
          >
            <Select options={AGGREGATION_OPTIONS} />
          </Form.Item>
          <Form.Item name="priority" label="优先级" tooltip="数值越大越优先">
            <InputNumber min={0} max={9999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="formula" label="计算公式">
            <Input placeholder="可选，如 SUM(revenue - refund)" />
          </Form.Item>
          <Form.Item name="condition" label="过滤条件">
            <Input placeholder="可选，如 region = 'EAST'" />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true }]}>
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
