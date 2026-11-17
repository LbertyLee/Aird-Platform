import './DashboardPage.css';
import {
  CrownOutlined,
  ReloadOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import {
  Alert,
  Button,
  Card,
  Empty,
  Radio,
  Spin,
  Table,
  Tag,
  message,
} from 'antd';
import type { EChartsOption } from 'echarts';
import dayjs from 'dayjs';
import ReactECharts from 'echarts-for-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardTrends, PlatformOverview } from '@agent/contracts';
import {
  fetchDashboardTrends,
  fetchLevels,
  fetchOrders,
  fetchOverview,
} from '../api/admin';

const DEFAULT_TIMEZONE = 'Asia/Shanghai';

type PeriodKey = 'today' | '7d' | '30d';

const PERIOD_LABEL: Record<PeriodKey, string> = {
  today: '今日',
  '7d': '近 7 日',
  '30d': '近 30 日',
};

function periodRange(key: PeriodKey): { startDate: string; endDate: string } {
  const end = dayjs();
  if (key === 'today') {
    return { startDate: end.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') };
  }
  if (key === '30d') {
    return {
      startDate: end.subtract(29, 'day').format('YYYY-MM-DD'),
      endDate: end.format('YYYY-MM-DD'),
    };
  }
  return {
    startDate: end.subtract(6, 'day').format('YYYY-MM-DD'),
    endDate: end.format('YYYY-MM-DD'),
  };
}

function formatChartDate(date: string) {
  const parts = date.split('-');
  if (parts.length !== 3) return date;
  return `${parts[1]}-${parts[2]}`;
}

function metricValue(
  value: number | string | null | undefined,
  available = true,
): ReactNode {
  if (!available || value === null || value === undefined) return '—';
  return value;
}

function buildTrendOption(
  name: string,
  color: string,
  dates: string[],
  data: Array<number | null>,
): EChartsOption {
  const hasData = data.some((item) => item !== null);
  return {
    color: [color],
    tooltip: { trigger: 'axis' },
    grid: { left: 16, right: 24, top: 32, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates,
      axisLabel: { color: '#909399' },
      axisLine: { lineStyle: { color: '#e4e7ed' } },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: 1,
      axisLabel: { color: '#909399' },
      splitLine: { lineStyle: { type: 'dashed', color: '#e5e6eb' } },
    },
    series: [
      {
        name,
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        connectNulls: false,
        data,
        lineStyle: { width: 2, color },
        itemStyle: { color },
        areaStyle: { opacity: 0.12, color },
      },
    ],
    graphic: hasData
      ? undefined
      : {
          type: 'text',
          left: 'center',
          top: 'middle',
          style: {
            text: '暂无趋势数据',
            fill: '#a8abb2',
            fontSize: 14,
          },
        },
  };
}

/**
 * 平台总览 / 运营看板。
 */
export function DashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<PeriodKey>('7d');
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [trends, setTrends] = useState<DashboardTrends | null>(null);
  const [levelCount, setLevelCount] = useState(0);
  const [levelNote, setLevelNote] = useState('—');
  const [orderTotal, setOrderTotal] = useState(0);
  const [pendingOrderNo, setPendingOrderNo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState('更新时间 --:--:--');

  const queryParams = useMemo(() => {
    const range = periodRange(period);
    return {
      ...range,
      timezone: DEFAULT_TIMEZONE,
    };
  }, [period]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [overviewRes, trendsRes, levelsRes, ordersRes] = await Promise.all([
        fetchOverview(queryParams),
        fetchDashboardTrends(queryParams),
        fetchLevels({ page: 1, pageSize: 1 }),
        fetchOrders({ page: 1, pageSize: 20 }),
      ]);
      setOverview(overviewRes);
      setTrends(trendsRes);
      setLevelCount(levelsRes.total);
      const preferred =
        levelsRes.items.find((item) => item.code === 'pro') ??
        levelsRes.items[0];
      setLevelNote(preferred?.name ?? `${levelsRes.total} 档等级`);
      setOrderTotal(ordersRes.total);
      const pending = ordersRes.items.find((item) => item.status === 'pending');
      setPendingOrderNo(pending?.orderNo ?? null);
      setLastRefresh(
        `更新时间 ${dayjs(overviewRes.generatedAt).format('HH:mm:ss')}`,
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : '加载运营看板失败';
      setError(msg);
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }, [queryParams]);

  useEffect(() => {
    void load();
  }, [load]);

  const onPeriodChange = (next: PeriodKey) => {
    setPeriod(next);
    message.success(`已切换统计周期：${PERIOD_LABEL[next]}`);
  };

  const onRefresh = () => {
    void load();
    message.success('已手动刷新统计数据');
  };

  const periodLabel = PERIOD_LABEL[period];
  const points = trends?.points ?? [];
  const chartDates = points.map((p) => formatChartDate(p.date));
  const userSeries = points.map((p) => p.newUserCount ?? p.userTotal);
  const searchSeries = points.map((p) => p.searchCount);

  const userChartOption = useMemo(
    () => buildTrendOption('活跃用户', '#2563eb', chartDates, userSeries),
    [chartDates, userSeries],
  );

  const searchChartOption = useMemo(
    () => buildTrendOption('检索次数', '#3b82f6', chartDates, searchSeries),
    [chartDates, searchSeries],
  );

  const pendingOrders =
    overview?.alerts?.find((item) => item.code === 'PENDING_ORDERS')?.count ?? 0;

  const expiringSubs =
    overview?.alerts?.find((item) => item.code === 'SUB_EXPIRING')?.count ?? 0;

  const todos = useMemo(() => {
    const items: Array<{
      key: string;
      title: string;
      desc: string;
      action: string;
      path: string;
      dot: string;
    }> = [];

    if (expiringSubs > 0) {
      items.push({
        key: 'expiring',
        title: `7 天内到期会员 ${expiringSubs} 人`,
        desc: '建议向即将到期会员发起续费提醒',
        action: '去查看',
        path: '/membership/orders',
        dot: 'dashboard-todo-dot',
      });
    }
    if (pendingOrders > 0) {
      items.push({
        key: 'pending-order',
        title: `待支付订单 ${pendingOrders} 笔`,
        desc: pendingOrderNo
          ? `${pendingOrderNo} 待支付`
          : '请尽快跟进会员订单支付状态',
        action: '去查看',
        path: '/membership/orders',
        dot: 'dashboard-todo-dot dashboard-todo-dot--warning',
      });
    }

    overview?.alerts?.forEach((alert) => {
      if (alert.code === 'SUB_EXPIRING' || alert.code === 'PENDING_ORDERS') {
        return;
      }
      items.push({
        key: alert.code,
        title: alert.title,
        desc: alert.message,
        action: '去查看',
        path:
          alert.code === 'DISABLED_USERS'
            ? '/users'
            : alert.code === 'PENDING_INVOICES'
              ? '/membership/orders'
              : '/',
        dot:
          alert.level === 'error'
            ? 'dashboard-todo-dot dashboard-todo-dot--error'
            : alert.level === 'warning'
              ? 'dashboard-todo-dot dashboard-todo-dot--warning'
              : 'dashboard-todo-dot dashboard-todo-dot--info',
      });
    });

    return items;
  }, [expiringSubs, overview?.alerts, pendingOrderNo, pendingOrders]);

  const overviewRows = [
    {
      key: 'users',
      label: '用户账号',
      value: `${metricValue(overview?.userTotal, overview?.available?.userTotal)} 个`,
    },
    {
      key: 'levels',
      label: '会员等级',
      value: `${levelCount || '—'} 档`,
    },
    {
      key: 'orders',
      label: '缴费订单',
      value: `${orderTotal || '—'} 笔（含待支付 ${pendingOrders}）`,
    },
  ];

  return (
    <div className="dashboard-page">
      <section className="dashboard-section dashboard-section--header">
        <div className="dashboard-toolbar">
          <h2 className="dashboard-title">平台总览</h2>
          <div className="dashboard-toolbar-actions">
            <Radio.Group
              className="dashboard-period-group"
              value={period}
              size="small"
              buttonStyle="solid"
              onChange={(e) => onPeriodChange(e.target.value as PeriodKey)}
            >
              <Radio.Button value="today">今日</Radio.Button>
              <Radio.Button value="7d">近 7 日</Radio.Button>
              <Radio.Button value="30d">近 30 日</Radio.Button>
            </Radio.Group>
            <Button
              size="small"
              icon={<ReloadOutlined />}
              style={{ marginLeft: 8 }}
              onClick={onRefresh}
            >
              刷新
            </Button>
          </div>
        </div>
      </section>

      {error ? (
        <Alert
          type="error"
          showIcon
          message="看板数据加载失败"
          description={error}
          action={
            <Button size="small" onClick={() => void load()}>
              重试
            </Button>
          }
        />
      ) : null}

      <Spin spinning={loading}>
        <section className="dashboard-section">
          <div className="dashboard-kpi-grid">
            <Card className="dashboard-kpi-card" bordered={false}>
              <div className="dashboard-kpi-row">
                <div>
                  <div className="dashboard-kpi-label">平台用户总量</div>
                  <div className="dashboard-kpi-value">
                    {metricValue(
                      overview?.userTotal,
                      overview?.available?.userTotal,
                    )}
                  </div>
                  <div className="dashboard-kpi-note">
                    当前共有{' '}
                    {metricValue(
                      overview?.userTotal,
                      overview?.available?.userTotal,
                    )}{' '}
                    个账号
                  </div>
                </div>
                <UserOutlined className="dashboard-kpi-icon" style={{ fontSize: 28 }} />
              </div>
            </Card>

            <Card className="dashboard-kpi-card" bordered={false}>
              <div className="dashboard-kpi-row">
                <div>
                  <div className="dashboard-kpi-label">会员等级</div>
                  <div className="dashboard-kpi-value">{levelCount || '—'}</div>
                  <div className="dashboard-kpi-note">{levelNote}</div>
                </div>
                <CrownOutlined className="dashboard-kpi-icon" style={{ fontSize: 28 }} />
              </div>
            </Card>

            <Card className="dashboard-kpi-card" bordered={false}>
              <div className="dashboard-kpi-row">
                <div>
                  <div className="dashboard-kpi-label">待支付订单</div>
                  <div className="dashboard-kpi-value">
                    {pendingOrders || '—'}
                  </div>
                  <div className="dashboard-kpi-note">
                    {pendingOrderNo
                      ? `${pendingOrderNo} 待支付`
                      : '暂无待支付订单'}
                  </div>
                </div>
                <WalletOutlined className="dashboard-kpi-icon" style={{ fontSize: 28 }} />
              </div>
            </Card>
          </div>
        </section>

        <section className="dashboard-section">
          <div className="dashboard-chart-grid">
            <div className="dashboard-chart-block">
              <div className="dashboard-chart-head">
                <div>
                  <span className="dashboard-chart-title">用户活跃趋势</span>
                  <span className="dashboard-chart-sub">
                    {periodLabel} · 活跃用户
                  </span>
                </div>
                <Tag className="dashboard-refresh-tag">{lastRefresh}</Tag>
              </div>
              {points.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无趋势数据"
                />
              ) : (
                <ReactECharts
                  option={userChartOption}
                  style={{ height: 260, width: '100%' }}
                  notMerge
                  lazyUpdate
                />
              )}
            </div>

            <div className="dashboard-chart-block">
              <div className="dashboard-chart-head">
                <div>
                  <span className="dashboard-chart-title">检索量趋势</span>
                  <span className="dashboard-chart-sub">
                    {periodLabel} · 检索次数
                  </span>
                </div>
              </div>
              {points.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="暂无趋势数据"
                />
              ) : (
                <ReactECharts
                  option={searchChartOption}
                  style={{ height: 260, width: '100%' }}
                  notMerge
                  lazyUpdate
                />
              )}
            </div>
          </div>
        </section>

        <div className="dashboard-bottom-grid">
          <Card className="dashboard-panel-card" bordered={false}>
            <div className="dashboard-panel-head">
              <span className="dashboard-panel-title">待办提醒</span>
              <span className="dashboard-panel-sub">运营看板</span>
            </div>
            {todos.length === 0 ? (
              <div className="dashboard-todo-empty">当前无待办提醒，系统运行正常</div>
            ) : (
              todos.map((item) => (
                <div key={item.key} className="dashboard-todo-item">
                  <div className="dashboard-todo-left">
                    <span className={item.dot} />
                    <div>
                      <div className="dashboard-todo-title">{item.title}</div>
                      <div className="dashboard-todo-desc">{item.desc}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="dashboard-todo-action"
                    onClick={() => navigate(item.path)}
                  >
                    {item.action}
                  </button>
                </div>
              ))
            )}
          </Card>

          <Card className="dashboard-panel-card" bordered={false}>
            <div className="dashboard-panel-head">
              <span className="dashboard-panel-title">运营概览</span>
              <span className="dashboard-panel-sub">汇总</span>
            </div>
            <Table
              className="dashboard-overview-table"
              size="small"
              pagination={false}
              showHeader
              columns={[
                { title: '指标', dataIndex: 'label', key: 'label' },
                { title: '数值', dataIndex: 'value', key: 'value', align: 'right' },
              ]}
              dataSource={overviewRows}
            />
            <div className="dashboard-overview-foot">
              统计数据按当前筛选周期展示；刷新后更新时间。
            </div>
          </Card>
        </div>
      </Spin>
    </div>
  );
}
