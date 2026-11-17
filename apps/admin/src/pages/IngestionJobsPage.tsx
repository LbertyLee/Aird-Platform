import {
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
  Input,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import {
  fetchIngestionJobs,
  type IngestionJobItem,
} from '../api/admin';

const STATUS_META: Record<
  string,
  { label: string; color: string }
> = {
  pending: { label: '排队中', color: 'default' },
  running: { label: '执行中', color: 'processing' },
  succeeded: { label: '成功', color: 'success' },
  failed: { label: '失败', color: 'error' },
  cancelled: { label: '已取消', color: 'warning' },
};

/**
 * 数据接入任务监控：验证知识库上传后的学习流水线。
 */
export function IngestionJobsPage() {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [targetType, setTargetType] = useState<string | undefined>('knowledge');
  const [data, setData] = useState<Awaited<
    ReturnType<typeof fetchIngestionJobs>
  > | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const res = await fetchIngestionJobs({
          page,
          pageSize: 20,
          keyword: keyword.trim() || undefined,
          status,
          targetType,
        });
        setData(res);
      } catch {
        message.error('加载接入任务失败');
      } finally {
        setLoading(false);
      }
    },
    [keyword, status, targetType],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const columns: ColumnsType<IngestionJobItem> = [
    {
      title: '任务 ID',
      dataIndex: 'id',
      width: 200,
      ellipsis: true,
      render: (v: string) => <Typography.Text code copyable={{ text: v }}>{v.slice(0, 12)}…</Typography.Text>,
    },
    {
      title: '类型',
      dataIndex: 'targetType',
      width: 100,
      render: (v: string) => (v === 'knowledge' ? '知识库' : '数据集'),
    },
    {
      title: '目标 ID',
      dataIndex: 'targetId',
      width: 200,
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text code copyable={{ text: v }}>
          {v.slice(0, 12)}…
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: string) => {
        const meta = STATUS_META[v] ?? { label: v, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '步骤',
      dataIndex: 'currentStep',
      width: 120,
      render: (v?: string | null) => v || '—',
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 80,
      render: (v: number) => `${v ?? 0}%`,
    },
    {
      title: '错误',
      dataIndex: 'errorMessage',
      ellipsis: true,
      render: (v?: string | null) =>
        v ? <Typography.Text type="danger">{v}</Typography.Text> : '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '完成时间',
      dataIndex: 'completedAt',
      width: 170,
      render: (v?: string | null) =>
        v ? new Date(v).toLocaleString() : '—',
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
        知识库上传并过审/发布后会创建接入任务。成功后文档应显示「学习完成」且分段数 &gt; 0。
        公用库需先在「公开数据审核」通过。学习成功后可到「数据资源 → 搜索测试」验证检索命中。
      </Typography.Paragraph>
      <Space wrap>
        <Input
          allowClear
          placeholder="任务/目标 ID / 错误关键字"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onPressEnter={() => void load(1)}
          style={{ width: 240 }}
        />
        <Select
          allowClear
          placeholder="类型"
          style={{ width: 140 }}
          value={targetType}
          onChange={setTargetType}
          options={[
            { value: 'knowledge', label: '知识库' },
            { value: 'dataset', label: '数据集' },
          ]}
        />
        <Select
          allowClear
          placeholder="状态"
          style={{ width: 140 }}
          value={status}
          onChange={setStatus}
          options={Object.entries(STATUS_META).map(([value, meta]) => ({
            value,
            label: meta.label,
          }))}
        />
        <Button icon={<SearchOutlined />} onClick={() => void load(1)}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void load(data?.page ?? 1)}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={data?.items ?? []}
        scroll={{ x: 1200 }}
        pagination={{
          current: data?.page ?? 1,
          pageSize: data?.pageSize ?? 20,
          total: data?.total ?? 0,
          showSizeChanger: false,
          onChange: (page) => void load(page),
        }}
      />
    </div>
  );
}
