import { EyeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  Button,
  Drawer,
  Input,
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
  fetchStructuredObservationDetail,
  fetchStructuredObservations,
  type StructuredObservation,
  type StructuredObservationDetail,
} from '../api/admin';

const namespaceLabels: Record<string, string> = {
  sources: '来源数据',
  remote: '外部数据',
  extractions: '抽取结果',
};

function display(value: unknown) {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function safeSourceUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function StructuredDataPage() {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespace, setNamespace] = useState<string>();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    items: StructuredObservation[];
    total: number;
  }>();
  const [detail, setDetail] = useState<StructuredObservationDetail>();
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      try {
        const response = await fetchStructuredObservations({
          page: nextPage,
          pageSize: 20,
          namespace,
          keyword: keyword.trim() || undefined,
        });
        setResult(response);
        setPage(nextPage);
      } catch {
        message.error('加载结构化数据失败');
      } finally {
        setLoading(false);
      }
    },
    [keyword, namespace],
  );

  useEffect(() => {
    void load(1);
  }, [load]);

  const showDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchStructuredObservationDetail(id));
    } catch {
      message.error('加载数据详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: ColumnsType<StructuredObservation> = [
    { title: '指标（英文）', dataIndex: 'indicatorEnglish', width: 180 },
    { title: '指标（中文）', dataIndex: 'indicatorChinese', width: 180 },
    { title: '数据指标来源机构', dataIndex: 'sourceOrganization', width: 180 },
    { title: '数据指标来源项目', dataIndex: 'sourceProject', width: 180 },
    {
      title: '国别地区（Region, subregion, country or area）',
      dataIndex: 'region',
      width: 280,
    },
    {
      title:
        '国别地区指标类型（世界/国家/省州/市县区/乡镇街道/村团社区/其他特定区域）',
      dataIndex: 'regionType',
      width: 360,
    },
    {
      title: '上级地区（对应全球行政区划）',
      dataIndex: 'parentRegion',
      width: 220,
    },
    { title: '起始时间（负值为公元前）', dataIndex: 'startTime', width: 180 },
    { title: '截至时间（负值为公元前）', dataIndex: 'endTime', width: 180 },
    { title: '时间指标类型', dataIndex: 'timeIndicatorType', width: 150 },
    {
      title: '数据值',
      dataIndex: 'dataValue',
      width: 150,
      render: (value: unknown) => display(value),
    },
    { title: '单位', dataIndex: 'unit', width: 110 },
    {
      title: '数据来源网址',
      dataIndex: 'sourceUrl',
      width: 220,
      ellipsis: true,
      render: (value: string | null) => {
        const href = safeSourceUrl(value);
        return href ? (
          <Typography.Link href={href} target="_blank" rel="noreferrer">
            {value}
          </Typography.Link>
        ) : (
          display(value)
        );
      },
    },
    {
      title: '数据发布时间（来源或统计预测日期）',
      dataIndex: 'publishedAt',
      width: 260,
    },
    {
      title: '数据指标解释',
      dataIndex: 'indicatorExplanation',
      width: 240,
      ellipsis: true,
    },
    { title: '数据输入者', dataIndex: 'inputBy', width: 140 },
    {
      title: '数据输入时间',
      dataIndex: 'inputAt',
      width: 180,
      render: (value: string | null) =>
        value ? new Date(value).toLocaleString() : '—',
    },
    {
      title: '是否公共数据',
      dataIndex: 'isPublic',
      width: 130,
      render: (value: boolean | null) =>
        value == null ? (
          '—'
        ) : (
          <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag>
        ),
    },
    { title: '数据所有人', dataIndex: 'dataOwner', width: 150 },
    { title: '数据最后修改人', dataIndex: 'lastModifiedBy', width: 150 },
    {
      title: '数据最后修改时间',
      dataIndex: 'lastModifiedAt',
      width: 180,
      render: (value: string | null) =>
        value ? new Date(value).toLocaleString() : '—',
    },
    {
      title: '其它数据标注',
      dataIndex: 'annotations',
      width: 220,
      ellipsis: true,
      render: (value: unknown) => display(value),
    },
    {
      title: '原始记录',
      key: 'action',
      fixed: 'right',
      width: 100,
      render: (_, row) => (
        <Button
          type="link"
          icon={<EyeOutlined />}
          onClick={() => void showDetail(row.id)}
        >
          查看
        </Button>
      ),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space wrap>
        <Input
          allowClear
          placeholder="指标 / 地区 / 来源"
          prefix={<SearchOutlined />}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          onPressEnter={() => void load(1)}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="数据空间"
          value={namespace}
          onChange={setNamespace}
          style={{ width: 160 }}
          options={Object.entries(namespaceLabels).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <Button icon={<SearchOutlined />} onClick={() => void load(1)}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void load(page)}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={result?.items ?? []}
        scroll={{ x: 3900 }}
        pagination={{
          current: page,
          pageSize: 20,
          total: result?.total ?? 0,
          showSizeChanger: false,
          onChange: (next) => void load(next),
        }}
      />
      <Drawer
        title="结构化数据原始记录"
        width="min(96vw, 1000px)"
        open={!!detail || detailLoading}
        onClose={() => setDetail(undefined)}
        loading={detailLoading}
      >
        {detail && (
          <>
            <Typography.Paragraph type="secondary">
              {namespaceLabels[detail.namespace] ?? detail.namespace} /{' '}
              {detail.region ?? '未标注地区'} /{' '}
              {detail.startTime ?? '未标注时间'}
            </Typography.Paragraph>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: '70vh',
                overflow: 'auto',
                padding: 12,
                background: '#f5f5f5',
              }}
            >
              {JSON.stringify(detail.rawData, null, 2)}
            </pre>
          </>
        )}
      </Drawer>
    </div>
  );
}
