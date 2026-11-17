import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LoginResponse } from '@agent/contracts';
import {
  fetchMyOrders,
  fetchMyPayments,
  type UserOrderItem,
  type UserPaymentItem,
} from '../api/membership';
import { apiErrorMessage } from '../api/research';
import ResearchLayout from '../layouts/ResearchLayout';
import './BillingPage.css';

const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
] as const;

const ORDER_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待支付' },
  { value: 'paid', label: '已支付' },
  { value: 'cancelled', label: '已关闭' },
  { value: 'refunded', label: '已退款' },
  { value: 'failed', label: '异常' },
] as const;

const PAYMENT_STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'success', label: '成功' },
  { value: 'pending', label: '处理中' },
  { value: 'failed', label: '失败' },
  { value: 'refunded', label: '已退款' },
] as const;

const ORDER_STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: '待支付', tone: 'warn' },
  paid: { label: '已支付', tone: 'ok' },
  cancelled: { label: '已关闭', tone: 'muted' },
  refunded: { label: '已退款', tone: 'muted' },
  failed: { label: '异常', tone: 'danger' },
};

const PAYMENT_STATUS_META: Record<string, { label: string; tone: string }> = {
  success: { label: '成功', tone: 'ok' },
  pending: { label: '处理中', tone: 'warn' },
  failed: { label: '失败', tone: 'danger' },
  refunded: { label: '已退款', tone: 'muted' },
};

const CHANNEL_LABEL: Record<string, string> = {
  mock: '模拟支付',
  wechat: '微信支付',
  alipay: '支付宝',
};

function formatAmount(amount: number) {
  return `¥${Number(amount).toFixed(2)}`;
}

function channelLabel(channel: string | null | undefined) {
  if (!channel) return '—';
  return CHANNEL_LABEL[channel] ?? channel;
}

export default function BillingPage({
  session,
  onLogout,
}: {
  session: LoginResponse | null;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'orders' | 'payments'>('orders');
  const [timeRange, setTimeRange] = useState('all');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [orders, setOrders] = useState<UserOrderItem[]>([]);
  const [payments, setPayments] = useState<UserPaymentItem[]>([]);

  useEffect(() => {
    if (!session) {
      navigate('/login', { replace: true });
    }
  }, [session, navigate]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        if (tab === 'orders') {
          const result = await fetchMyOrders({
            page: 1,
            pageSize: 50,
            timeRange,
            status,
          });
          if (!cancelled) setOrders(result.items);
        } else {
          const result = await fetchMyPayments({
            page: 1,
            pageSize: 50,
            timeRange,
            status,
          });
          if (!cancelled) setPayments(result.items);
        }
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, tab, timeRange, status]);

  function switchTab(next: 'orders' | 'payments') {
    setTab(next);
    setStatus('all');
  }

  const statusOptions =
    tab === 'orders' ? ORDER_STATUS_OPTIONS : PAYMENT_STATUS_OPTIONS;

  return (
    <ResearchLayout session={session} onLogout={onLogout} activeNav="home">
      <main className="billing-page">
        <header className="billing-hero">
          <div>
            <h1>账单查询</h1>
            <p>订单列表与支付流水</p>
          </div>
          <div className="billing-filters">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              aria-label="时间范围"
            >
              {TIME_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label="状态"
            >
              {statusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </header>

        <section className="billing-card">
          <div className="billing-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'orders'}
              className={tab === 'orders' ? 'active' : ''}
              onClick={() => switchTab('orders')}
            >
              订单列表
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'payments'}
              className={tab === 'payments' ? 'active' : ''}
              onClick={() => switchTab('payments')}
            >
              支付流水
            </button>
          </div>

          {error ? <div className="billing-error">{error}</div> : null}

          {tab === 'orders' ? (
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>订单内容</th>
                    <th>金额</th>
                    <th>支付渠道</th>
                    <th>状态</th>
                    <th>下单时间</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="billing-empty">
                        加载中…
                      </td>
                    </tr>
                  ) : orders.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="billing-empty">
                        暂无订单记录
                      </td>
                    </tr>
                  ) : (
                    orders.map((row) => {
                      const meta =
                        ORDER_STATUS_META[row.status] ?? {
                          label: row.status,
                          tone: 'muted',
                        };
                      return (
                        <tr key={row.id}>
                          <td className="mono">{row.orderNo}</td>
                          <td>{row.content}</td>
                          <td className="amount">{formatAmount(row.amount)}</td>
                          <td>
                            <span className="billing-pill channel">
                              {channelLabel(row.paymentChannel)}
                            </span>
                          </td>
                          <td>
                            <span className={`billing-pill ${meta.tone}`}>
                              {meta.label}
                            </span>
                          </td>
                          <td>{row.createdAt}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="billing-table-wrap">
              <table className="billing-table">
                <thead>
                  <tr>
                    <th>流水号</th>
                    <th>渠道</th>
                    <th>订单号</th>
                    <th>金额</th>
                    <th>支付时间</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} className="billing-empty">
                        加载中…
                      </td>
                    </tr>
                  ) : payments.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="billing-empty">
                        暂无支付流水
                      </td>
                    </tr>
                  ) : (
                    payments.map((row) => {
                      const meta =
                        PAYMENT_STATUS_META[row.status] ?? {
                          label: row.status,
                          tone: 'muted',
                        };
                      return (
                        <tr key={row.id}>
                          <td className="mono">{row.tradeNo || '—'}</td>
                          <td>
                            <span className="billing-pill channel">
                              {channelLabel(row.channel)}
                            </span>
                          </td>
                          <td className="mono">{row.orderNo}</td>
                          <td className="amount">{formatAmount(row.amount)}</td>
                          <td>{row.paidAt}</td>
                          <td>
                            <span className={`billing-pill ${meta.tone}`}>
                              {meta.label}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </ResearchLayout>
  );
}
