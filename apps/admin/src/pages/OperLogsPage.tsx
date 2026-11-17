import {
  FileSearchOutlined,
  InfoCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import {
  Button,
  DatePicker,
  Descriptions,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/zh-cn';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchOperLogDetail,
  fetchOperLogs,
  fetchUsers,
  type OperLogItem,
} from '../api/admin';
import { FORM_MODAL_WIDTH_LG, withFormModal } from '../components/form-modal';
import { useTableScrollY } from '../hooks/useTableScrollY';

import './OperLogsPage.css';

dayjs.locale('zh-cn');

type LogTab = 'all' | 'login' | 'export' | 'delete';

function formatDateTime(value: string, withSeconds = true): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  const base = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return withSeconds ? `${base}:${pad(date.getSeconds())}` : base;
}

function formatJsonBlock(raw: string): string {
  if (!raw.trim()) return '-';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function resultTag(status: number) {
  if (status === 0) {
    return <Tag color="success">成功</Tag>;
  }
  return <Tag color="error">失败</Tag>;
}

function operContent(row: OperLogItem): string {
  return row.title || row.operUrl || '-';
}

function exportFormat(row: OperLogItem): string {
  const text = `${row.title} ${row.operUrl} ${row.operParam}`.toLowerCase();
  if (/\bpng\b|image\/png/.test(text)) return 'PNG';
  if (/\bxlsx\b|excel|spreadsheet/.test(text)) return 'XLSX';
  if (/\bjson\b/.test(text)) return 'JSON';
  if (/\bpdf\b/.test(text)) return 'PDF';
  return 'CSV';
}

function exportFormatColor(format: string): string {
  if (format === 'CSV') return 'blue';
  if (format === 'PNG') return 'default';
  if (format === 'XLSX') return 'green';
  if (format === 'PDF') return 'red';
  return 'default';
}

function deleteTarget(row: OperLogItem): string {
  return row.title || row.operUrl || '-';
}

function deleteType(row: OperLogItem): { label: string; color: string } {
  const text = `${row.title} ${row.operUrl}`.toLowerCase();
  if (
    text.includes('knowledge') ||
    text.includes('知识') ||
    text.includes('报告') ||
    text.includes('audit')
  ) {
    return { label: '报告', color: 'default' };
  }
  if (
    text.includes('dataset') ||
    text.includes('indicator') ||
    text.includes('dict') ||
    text.includes('数据') ||
    text.includes('指标') ||
    text.includes('字典') ||
    text.includes('来源')
  ) {
    return { label: '数据', color: 'blue' };
  }
  if (text.includes('user') || text.includes('用户')) {
    return { label: '用户', color: 'purple' };
  }
  if (text.includes('role') || text.includes('角色')) {
    return { label: '角色', color: 'geekblue' };
  }
  return { label: '其它', color: 'default' };
}

/**
 * 操作日志：分类 Tab + 状态/详情 + 只读说明。
 */
export function OperLogsPage() {
  const [tab, setTab] = useState<LogTab>('all');
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [operName, setOperName] = useState<string | undefined>();
  const [userOptions, setUserOptions] = useState<
    Array<{ value: string; label: string }>
  >([]);
  const [userLoading, setUserLoading] = useState(false);
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchOperLogs>> | null>(
    null,
  );
  const [detail, setDetail] = useState<OperLogItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const { wrapRef: tableWrapRef, scrollY } = useTableScrollY();

  const category =
    tab === 'all' ? undefined : (tab as 'login' | 'export' | 'delete');

  const loadUsers = useCallback(async (keywordText?: string) => {
    setUserLoading(true);
    try {
      const res = await fetchUsers({
        page: 1,
        pageSize: 50,
        keyword: keywordText?.trim() || undefined,
      });
      setUserOptions(
        res.items.map((user) => ({
          value: user.username,
          label: user.displayName
            ? `${user.username}（${user.displayName}）`
            : user.username,
        })),
      );
    } catch {
      // 下拉失败不影响主列表
    } finally {
      setUserLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchOperLogs({
        page,
        pageSize,
        keyword: keyword.trim() || undefined,
        operName: operName?.trim() || undefined,
        category,
        beginTime: dateRange?.[0]?.startOf('day').toISOString(),
        endTime: dateRange?.[1]?.endOf('day').toISOString(),
      });
      setData(res);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载操作日志失败');
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, keyword, operName, category, dateRange]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const row = await fetchOperLogDetail(id);
      setDetail(row);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const onSearch = () => {
    setPage(1);
    void load();
  };

  const onReset = () => {
    setKeyword('');
    setOperName(undefined);
    setDateRange(null);
    setPage(1);
    setPageSize(20);
  };

  const onTabChange = (key: string) => {
    setTab(key as LogTab);
    setPage(1);
  };

  const statusColumn: ColumnsType<OperLogItem>[number] = {
    title: '状态',
    dataIndex: 'status',
    width: 90,
    render: (value: number) => resultTag(value),
  };

  const detailColumn: ColumnsType<OperLogItem>[number] = {
    title: '详情',
    key: 'detail',
    width: 80,
    fixed: 'right',
    render: (_, row) => (
      <Button type="link" size="small" onClick={() => void openDetail(row.id)}>
        详情
      </Button>
    ),
  };

  const columns = useMemo((): ColumnsType<OperLogItem> => {
    if (tab === 'login') {
      return [
        {
          title: '用户',
          dataIndex: 'operName',
          width: 160,
          render: (value: string) => value || 'unknown',
        },
        {
          title: '时间',
          dataIndex: 'operTime',
          width: 190,
          render: (value: string) => formatDateTime(value, true),
        },
        {
          title: 'IP',
          dataIndex: 'operIp',
          width: 160,
          render: (value: string) => value || '-',
        },
        statusColumn,
        detailColumn,
      ];
    }

    if (tab === 'export') {
      return [
        {
          title: '用户',
          dataIndex: 'operName',
          width: 160,
          render: (value: string) => value || '-',
        },
        {
          title: '导出内容',
          key: 'exportContent',
          ellipsis: true,
          render: (_, row) => operContent(row),
        },
        {
          title: '格式',
          key: 'format',
          width: 100,
          render: (_, row) => {
            const format = exportFormat(row);
            return <Tag color={exportFormatColor(format)}>{format}</Tag>;
          },
        },
        {
          title: '时间',
          dataIndex: 'operTime',
          width: 170,
          render: (value: string) => formatDateTime(value, false),
        },
        statusColumn,
        detailColumn,
      ];
    }

    if (tab === 'delete') {
      return [
        {
          title: '用户',
          dataIndex: 'operName',
          width: 160,
          render: (value: string) => value || '-',
        },
        {
          title: '删除对象',
          key: 'deleteTarget',
          ellipsis: true,
          render: (_, row) => deleteTarget(row),
        },
        {
          title: '类型',
          key: 'deleteType',
          width: 100,
          render: (_, row) => {
            const meta = deleteType(row);
            return <Tag color={meta.color}>{meta.label}</Tag>;
          },
        },
        {
          title: '时间',
          dataIndex: 'operTime',
          width: 170,
          render: (value: string) => formatDateTime(value, false),
        },
        statusColumn,
        detailColumn,
      ];
    }

    return [
      {
        title: '用户',
        dataIndex: 'operName',
        width: 160,
        render: (value: string) => value || '-',
      },
      {
        title: '时间',
        dataIndex: 'operTime',
        width: 190,
        render: (value: string) => formatDateTime(value, true),
      },
      {
        title: 'IP',
        dataIndex: 'operIp',
        width: 150,
        render: (value: string) => value || '-',
      },
      {
        title: '操作内容',
        key: 'content',
        ellipsis: true,
        render: (_, row) => operContent(row),
      },
      statusColumn,
      detailColumn,
    ];
  }, [tab]);

  const onTableChange = (pagination: TablePaginationConfig) => {
    setPage(pagination.current ?? 1);
    setPageSize(pagination.pageSize ?? 20);
  };

  return (
    <div className="oper-logs-page">
      <section className="oper-logs-section">
        <Tabs
          className="oper-logs-tabs"
          activeKey={tab}
          onChange={onTabChange}
          items={[
            { key: 'all', label: '全部操作' },
            { key: 'login', label: '登录日志' },
            { key: 'export', label: '导出日志' },
            { key: 'delete', label: '删除日志' },
          ]}
        />

        <div className="oper-logs-toolbar">
          <div className="oper-logs-toolbar-filters">
            <Select
              allowClear
              showSearch
              placeholder="选择用户"
              className="oper-logs-filter-user"
              value={operName}
              options={userOptions}
              loading={userLoading}
              filterOption={false}
              onSearch={(value) => {
                void loadUsers(value);
              }}
              onChange={(value) => setOperName(value)}
              notFoundContent={userLoading ? '加载中…' : '无匹配用户'}
            />
            <Input
              allowClear
              placeholder="内容关键字"
              className="oper-logs-filter-keyword"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onPressEnter={onSearch}
            />
            <DatePicker.RangePicker
              allowClear
              value={dateRange}
              onChange={(values) => {
                if (values?.[0] && values?.[1]) {
                  setDateRange([values[0], values[1]]);
                } else {
                  setDateRange(null);
                }
              }}
              format="YYYY-MM-DD"
              placeholder={['年 / 月 / 日', '年 / 月 / 日']}
              className="oper-logs-filter-range"
            />
            <Button
              type="primary"
              icon={<SearchOutlined />}
              onClick={onSearch}
            >
              查询
            </Button>
            <Button icon={<ReloadOutlined />} onClick={onReset}>
              重置
            </Button>
          </div>
        </div>

        <div className="oper-logs-table-head">
          <span className="oper-logs-table-title">
            {tab === 'login'
              ? '登录日志'
              : tab === 'export'
                ? '导出日志'
                : tab === 'delete'
                  ? '删除日志'
                  : '全部操作'}
          </span>
          <span className="oper-logs-table-meta">
            <InfoCircleOutlined style={{ marginRight: 4 }} />
            共 {data?.total ?? 0} 条 · 只读，保留至少 180 天
          </span>
        </div>

        <div className="oper-logs-table-wrap" ref={tableWrapRef}>
          <Table
            rowKey="id"
            size="middle"
            loading={loading}
            columns={columns}
            dataSource={data?.items ?? []}
            className="oper-logs-table"
            scroll={{ x: 960, y: scrollY }}
            pagination={{
              current: page,
              pageSize,
              total: data?.total ?? 0,
              showSizeChanger: true,
              showTotal: (total) => `共 ${total} 条`,
              position: ['bottomRight'],
            }}
            onChange={onTableChange}
          />
        </div>
      </section>

      <Modal
        {...withFormModal({
          title: (
            <Space>
              <FileSearchOutlined />
              <span>操作日志详情</span>
            </Space>
          ),
          open: Boolean(detail) || detailLoading,
          width: FORM_MODAL_WIDTH_LG,
          footer: null,
          onCancel: () => setDetail(null),
        })}
        confirmLoading={detailLoading}
      >
        {detail ? (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            <Descriptions bordered size="small" column={2}>
              <Descriptions.Item label="操作内容" span={2}>
                {detail.title || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="操作状态">
                {resultTag(detail.status)}
              </Descriptions.Item>
              <Descriptions.Item label="请求方式">
                {detail.requestMethod || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="操作人员">
                {detail.operName || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="操作时间">
                {formatDateTime(detail.operTime, true)}
              </Descriptions.Item>
              <Descriptions.Item label="请求地址" span={2}>
                {detail.operUrl || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="主机地址">
                {detail.operIp || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="操作地点">
                {detail.operLocation || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="方法名称" span={2}>
                {detail.method || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="消耗时间">
                {detail.costTime} ms
              </Descriptions.Item>
              <Descriptions.Item label="错误消息" span={2}>
                {detail.errorMsg || '-'}
              </Descriptions.Item>
            </Descriptions>

            <div>
              <Typography.Text strong>请求参数</Typography.Text>
              <pre className="oper-log-json">
                {formatJsonBlock(detail.operParam)}
              </pre>
            </div>
            <div>
              <Typography.Text strong>返回参数</Typography.Text>
              <pre className="oper-log-json">
                {formatJsonBlock(detail.jsonResult)}
              </pre>
            </div>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
