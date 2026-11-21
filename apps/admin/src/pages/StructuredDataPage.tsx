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
  fetchStructuredData,
  fetchStructuredDataDetail,
  type StructuredDataRecord,
  type StructuredDataRecordDetail,
} from '../api/admin';

const namespaceLabels: Record<string, string> = {
  sources: '来源数据',
  remote: '外部数据',
  extractions: '抽取结果',
};
const fields: Array<[string, string[]]> = [
  [
    '指标（中文名称）',
    ['indicatorNameZh', 'indicatorZh', '指标（中文名称）', 'indicator'],
  ],
  [
    '数据指标来源机构',
    [
      'sourceOrganization',
      'dataSourceOrganization',
      'organization',
      '数据指标来源机构',
    ],
  ],
  [
    '数据指标来源项目',
    ['sourceProject', 'dataSourceProject', 'project', '数据指标来源项目'],
  ],
  ['国别/地区', ['country', 'region', 'entity', '国家', '地区', '国别/地区']],
  ['国别/地区指标类型', ['regionType', 'areaType', '国别/地区指标类型']],
  ['上级地区', ['parentRegion', 'parentArea', '上级地区']],
  ['起始时间', ['startTime', 'startYear', 'year', '年份', '起始时间']],
  ['截至时间', ['endTime', 'endYear', '截至时间']],
  ['时间指标类型', ['timeType', 'timeIndicatorType', '时间指标类型']],
  ['数据值', ['value', 'dataValue', '数据值']],
  ['单位', ['unit', '数据单位', '单位']],
  ['数据来源网址', ['sourceUrl', 'url', '数据来源网址']],
  ['数据发布时间', ['publishedAt', 'publicationDate', '数据发布时间']],
  ['数据指标解释', ['indicatorDescription', 'description', '数据指标解释']],
  ['数据输入者', ['inputBy', 'createdBy', '数据输入者']],
  ['数据输入时间', ['inputAt', 'createdAt', '数据输入时间']],
  ['是否公共数据', ['isPublic', 'shared', '是否公共数据']],
  ['数据所有人', ['owner', 'ownerName', '数据所有人']],
  ['数据最后修改人', ['updatedBy', '数据最后修改人']],
  ['数据最后修改时间', ['updatedAt', '数据最后修改时间']],
  ['数据最后修改频率', ['updateFrequency', '数据最后修改频率']],
  ['其它数据标准元数据', ['metadata', '其它数据标准元数据']],
];

function observations(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data))
    return data.filter(
      (item): item is Record<string, unknown> =>
        !!item && typeof item === 'object' && !Array.isArray(item),
    );
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>;
    for (const key of [
      'rows',
      'items',
      'observations',
      'structuredData',
      'data',
    ]) {
      if (Array.isArray(object[key])) return observations(object[key]);
    }
    return [object];
  }
  return [];
}

function display(value: unknown) {
  if (value == null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export function StructuredDataPage() {
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [namespace, setNamespace] = useState<string>();
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{
    items: StructuredDataRecord[];
    total: number;
  }>();
  const [detail, setDetail] = useState<StructuredDataRecordDetail>();
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(
    async (nextPage = page) => {
      setLoading(true);
      try {
        const response = await fetchStructuredData({
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
    [keyword, namespace, page],
  );

  useEffect(() => {
    void load(1);
  }, [namespace]);

  const showDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await fetchStructuredDataDetail(id));
    } catch {
      message.error('加载数据详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: ColumnsType<StructuredDataRecord> = [
    {
      title: '数据空间',
      dataIndex: 'namespace',
      width: 120,
      render: (v: string) => <Tag>{namespaceLabels[v] ?? v}</Tag>,
    },
    {
      title: '记录指纹',
      dataIndex: 'fingerprint',
      width: 310,
      ellipsis: true,
      render: (v: string) => (
        <Typography.Text code copyable>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: '校验值',
      dataIndex: 'checksum',
      width: 220,
      ellipsis: true,
      render: (v: string) => <Typography.Text code>{v}</Typography.Text>,
    },
    {
      title: '首次存储时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '最近更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: '操作',
      key: 'action',
      fixed: 'right',
      width: 90,
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
  const rows = observations(detail?.data);
  const observationColumns: ColumnsType<Record<string, unknown>> = fields.map(
    ([title, aliases]) => ({
      title,
      key: title,
      width: 170,
      render: (_, row) =>
        display(
          aliases
            .map((key) => row[key])
            .find((value) => value != null && value !== ''),
        ),
    }),
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space wrap>
        <Input
          allowClear
          placeholder="记录指纹"
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
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          刷新
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={result?.items ?? []}
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          pageSize: 20,
          total: result?.total ?? 0,
          showSizeChanger: false,
          onChange: (next) => void load(next),
        }}
      />
      <Drawer
        title="结构化数据详情"
        width="min(96vw, 1400px)"
        open={!!detail || detailLoading}
        onClose={() => setDetail(undefined)}
        loading={detailLoading}
      >
        {detail && (
          <>
            <Typography.Paragraph type="secondary">
              数据空间：{namespaceLabels[detail.namespace] ?? detail.namespace}
              　指纹：{detail.fingerprint}
            </Typography.Paragraph>
            <Typography.Title level={5}>观测数据</Typography.Title>
            <Table
              size="small"
              rowKey={(_, index) => String(index)}
              columns={observationColumns}
              dataSource={rows}
              scroll={{ x: 3740, y: 360 }}
              pagination={{ pageSize: 20, showSizeChanger: false }}
              locale={{
                emptyText: '该缓存记录不是可识别的逐行观测数组，请查看原始数据',
              }}
            />
            <Typography.Title level={5} style={{ marginTop: 20 }}>
              原始数据
            </Typography.Title>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                maxHeight: 360,
                overflow: 'auto',
                padding: 12,
                background: '#f5f5f5',
              }}
            >
              {JSON.stringify(detail.data, null, 2)}
            </pre>
          </>
        )}
      </Drawer>
    </div>
  );
}
