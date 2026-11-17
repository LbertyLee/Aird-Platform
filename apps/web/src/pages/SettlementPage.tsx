import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Crown } from 'lucide-react';
import { Modal } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import type { LoginResponse } from '@agent/contracts';
import {
  fetchMembershipStatus,
  fetchMyOrders,
  payMembershipOrder,
  syncMembershipOrder,
  cancelMembershipOrder,
  type MembershipStatus,
  type UserOrderItem,
} from '../api/membership';
import { apiErrorMessage } from '../api/research';
import ResearchLayout, {
  notifyMembershipUpdated,
} from '../layouts/ResearchLayout';
import { notifyNotificationsUpdated } from '../components/NotificationCenter';
import './SettlementPage.css';

const ORDER_STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: '待支付', tone: 'warn' },
  paid: { label: '已支付', tone: 'ok' },
  cancelled: { label: '已关闭', tone: 'muted' },
  refunded: { label: '已退款', tone: 'muted' },
  failed: { label: '异常', tone: 'danger' },
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

function paymentSecondsLeft(order: UserOrderItem | undefined, now: number) {
  if (!order) return null;
  const deadline = Date.parse(order.expiresAt);
  return Number.isFinite(deadline)
    ? Math.max(0, Math.ceil((deadline - now) / 1000))
    : null;
}

function countdownLabel(seconds: number) {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export default function SettlementPage({
  session,
  onLogout,
}: {
  session: LoginResponse | null;
  onLogout: () => void;
}) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const focusOrderId = searchParams.get('orderId');
  const returnOrderNo = searchParams.get('orderNo');

  const [status, setStatus] = useState<MembershipStatus | null>(null);
  const [orders, setOrders] = useState<UserOrderItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cashier, setCashier] = useState<{
    order: UserOrderItem;
    html?: string;
    qrCode?: string;
    channel: 'alipay' | 'wechat';
  } | null>(null);
  const [now, setNow] = useState(Date.now);
  const [selectedChannel, setSelectedChannel] = useState<
    'alipay' | 'wechat' | null
  >(null);

  async function reload() {
    const [nextStatus, orderPage] = await Promise.all([
      fetchMembershipStatus(),
      fetchMyOrders({ page: 1, pageSize: 50 }),
    ]);
    setStatus(nextStatus);
    setOrders(orderPage.items);
    notifyMembershipUpdated(nextStatus);
  }

  useEffect(() => {
    if (!session) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError('');
      try {
        await reload();
      } catch (err) {
        if (!cancelled) setError(apiErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken]);

  const pendingOrders = useMemo(
    () => orders.filter((o) => o.status === 'pending'),
    [orders],
  );

  const activePending = useMemo(() => {
    if (focusOrderId) {
      return (
        pendingOrders.find((o) => o.id === focusOrderId) ?? pendingOrders[0]
      );
    }
    return pendingOrders[0];
  }, [focusOrderId, pendingOrders]);

  useEffect(() => {
    setNow(Date.now());
    if (!activePending && !cashier) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activePending?.id, cashier?.order.id]);

  const secondsLeft = paymentSecondsLeft(activePending, now);
  const orderExpired = secondsLeft === 0;
  const cashierSecondsLeft = paymentSecondsLeft(cashier?.order, now);

  useEffect(() => {
    const channel = activePending?.paymentChannel;
    setSelectedChannel(
      channel === 'alipay' || channel === 'wechat' ? channel : null,
    );
  }, [activePending?.id, activePending?.paymentChannel]);

  const isMember = Boolean(status?.isMember);
  const remainingTrials = status?.remainingTrials ?? 0;

  function createCashierDocument(html: string) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    const form = document.querySelector('form');
    if (!form) {
      throw new Error('支付宝支付表单无效，请重试');
    }
    form.target = '_self';
    return `<!doctype html><html><head><meta charset="UTF-8"></head><body>${form.outerHTML}<script>document.forms[0].submit();</script></body></html>`;
  }

  useEffect(() => {
    if (!cashier || !session) return;
    const orderNo = cashier.order.orderNo;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const deadline = Date.now() + 10 * 60_000;
    async function checkPayment() {
      try {
        const result = await syncMembershipOrder(orderNo);
        if (cancelled) return;
        if (
          ['paid', 'cancelled', 'refunded', 'failed'].includes(result.status)
        ) {
          await reload();
          if (cancelled) return;
          setCashier(null);
          notifyNotificationsUpdated();
          setNotice(
            result.status === 'paid'
              ? '支付成功，会员已开通'
              : '订单状态已更新，请查看订单',
          );
          return;
        }
      } catch {
        // 网络暂时失败时继续查询，支付结果以服务端为准。
      }
      if (!cancelled && Date.now() < deadline) {
        timer = setTimeout(() => void checkPayment(), 3000);
      } else if (!cancelled) {
        setNotice('自动查询已暂停，完成支付后请点击“我已支付，查询结果”。');
      }
    }
    timer = setTimeout(() => void checkPayment(), 3000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cashier, session?.accessToken]);

  async function handlePay(orderId: string) {
    if (paying) return;
    const targetOrder = orders.find((item) => item.id === orderId);
    if (!selectedChannel) {
      setError('请先选择支付方式');
      return;
    }
    if (paymentSecondsLeft(targetOrder, Date.now()) === 0) {
      setNow(Date.now());
      setError('订单支付时间已结束，请重新下单；如已付款，可查询支付结果。');
      return;
    }
    setPaying(true);
    setError('');
    setNotice('');
    try {
      const result = await payMembershipOrder(orderId, selectedChannel, 'page');
      if (result.payMode === 'wechat_native' && result.qrCode) {
        if (!targetOrder) throw new Error('订单不存在，请刷新后重试');
        setOrders((items) =>
          items.map((item) =>
            item.id === orderId ? { ...item, paymentChannel: 'wechat' } : item,
          ),
        );
        setCashier({
          order: targetOrder,
          qrCode: result.qrCode,
          channel: 'wechat',
        });
        setNotice('请在弹窗内使用微信扫码完成支付，支付结果将自动更新。');
        return;
      }
      if (selectedChannel === 'wechat') {
        throw new Error('微信支付二维码未生成，请查询订单状态后重试');
      }
      if (result.payMode === 'alipay_page' && result.payForm) {
        const order = orders.find((item) => item.id === orderId);
        if (!order) throw new Error('订单不存在，请刷新页面后重试');
        setOrders((items) =>
          items.map((item) =>
            item.id === orderId ? { ...item, paymentChannel: 'alipay' } : item,
          ),
        );
        setCashier({
          order,
          html: createCashierDocument(result.payForm),
          channel: 'alipay',
        });
        setNotice('请在弹窗内使用支付宝完成支付，支付结果将自动更新。');
        return;
      }
      setStatus(result.membership);
      notifyMembershipUpdated(result.membership);
      notifyNotificationsUpdated();
      await reload();
      setNotice(
        result.membership.endAt
          ? `支付成功，会员有效期至 ${result.membership.endAt}`
          : '支付成功，会员已开通',
      );
    } catch (err) {
      setError(apiErrorMessage(err));
      // 下单超时也可能已在渠道创建交易，刷新已锁定的支付方式。
      await reload().catch(() => undefined);
    } finally {
      setPaying(false);
    }
  }

  async function handleOrderAction(
    order: UserOrderItem,
    action: 'sync' | 'cancel',
  ) {
    if (paying) return;
    setPaying(true);
    setError('');
    try {
      if (action === 'cancel') {
        await cancelMembershipOrder(order.id);
        setNotice('订单已关闭');
      } else {
        const result = await syncMembershipOrder(order.orderNo);
        if (result.status !== 'pending') setCashier(null);
        setNotice(
          result.status === 'paid'
            ? '支付成功，会员已开通'
            : '已查询最新支付结果',
        );
      }
      await reload();
      notifyNotificationsUpdated();
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setPaying(false);
    }
  }

  useEffect(() => {
    if (!returnOrderNo || !session) return;
    const returnedOrderNo = returnOrderNo;
    let cancelled = false;
    void (async () => {
      setNotice('支付结果确认中，请稍候…');
      for (let i = 0; i < 8; i += 1) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 1500));
        try {
          const hit = await syncMembershipOrder(returnedOrderNo);
          if (hit.status === 'cancelled' || hit.status === 'refunded') {
            if (!cancelled) {
              await reload();
              setNotice(
                hit.status === 'refunded' ? '订单已退款' : '订单已关闭',
              );
            }
            return;
          }
          if (hit?.status === 'paid') {
            const nextStatus = await fetchMembershipStatus();
            if (!cancelled) {
              setStatus(nextStatus);
              notifyMembershipUpdated(nextStatus);
              notifyNotificationsUpdated();
              await reload();
              setNotice(
                nextStatus.endAt
                  ? `支付成功，会员有效期至 ${nextStatus.endAt}`
                  : '支付成功，会员已开通',
              );
            }
            return;
          }
        } catch {
          /* 轮询重试 */
        }
      }
      if (!cancelled) {
        setNotice(
          '若已完成支付，会员权益将在片刻内生效；也可刷新页面或查看账单。',
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [returnOrderNo, session?.accessToken]);

  return (
    <ResearchLayout session={session} onLogout={onLogout} activeNav="home">
      <main className="settlement-page">
        <header className="settlement-hero">
          <h1>结算支付</h1>
          <p>会员升级与费用结算</p>
        </header>

        {(notice || error) && (
          <div className={`settlement-notice ${error ? 'is-error' : ''}`}>
            {error || notice}
          </div>
        )}

        <section className="settlement-status-card">
          <div className="settlement-status-left">
            <span className="settlement-crown">
              <Crown size={18} />
            </span>
            <div>
              <strong>
                {isMember
                  ? `当前为${status?.levelName || '会员'}${
                      status?.endAt ? ` · 有效期至 ${status.endAt}` : ''
                    }`
                  : `当前为非会员${
                      remainingTrials <= 0
                        ? '（免费体验已用完）'
                        : ` · 免费体验剩余 ${remainingTrials} 次`
                    }`}
              </strong>
              <p>
                {isMember
                  ? '已解锁 AI 智搜无限次与全部数据分析能力'
                  : '开通会员解锁 AI 智搜无限次与全部数据分析能力'}
              </p>
            </div>
          </div>
          {!isMember ? (
            <button
              type="button"
              className="settlement-primary-btn"
              onClick={() => navigate('/membership')}
            >
              开通会员
            </button>
          ) : (
            <button
              type="button"
              className="settlement-primary-btn is-ghost"
              onClick={() => navigate('/membership')}
            >
              续费 / 升级
            </button>
          )}
        </section>

        {activePending ? (
          <section className="settlement-pending-card">
            <div>
              <div className="settlement-pending-title">
                待支付订单 · {activePending.content.replace(/^会员缴费 · /, '')}
              </div>
              <div className="settlement-pending-price">
                {formatAmount(activePending.amount)}
              </div>
              <div className="settlement-pending-meta">
                订单号 {activePending.orderNo}
              </div>
              {secondsLeft !== null && (
                <div
                  className={`settlement-countdown ${orderExpired ? 'is-expired' : ''}`}
                  role="timer"
                  aria-label="支付剩余时间"
                >
                  {orderExpired ? (
                    '支付时间已结束，请重新下单；如已付款，请查询结果。'
                  ) : (
                    <>
                      支付剩余时间{' '}
                      <strong>{countdownLabel(secondsLeft)}</strong>
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="settlement-order-actions">
              <button
                type="button"
                className="settlement-primary-btn is-ghost"
                disabled={paying}
                onClick={() => void handleOrderAction(activePending, 'sync')}
              >
                我已支付，查询结果
              </button>
              <button
                type="button"
                className="settlement-primary-btn is-ghost"
                disabled={paying}
                onClick={() => void handleOrderAction(activePending, 'cancel')}
              >
                关闭订单
              </button>
            </div>
          </section>
        ) : (
          !loading && (
            <section className="settlement-empty-pending">
              暂无待支付订单，可前往会员中心选择套餐。
              <button type="button" onClick={() => navigate('/membership')}>
                去选套餐
              </button>
            </section>
          )
        )}

        <section className="settlement-channel-card">
          <h2>支付方式</h2>
          <div className="settlement-channel-single">
            <button
              type="button"
              className={`settlement-channel ${selectedChannel === 'alipay' ? 'active' : ''}`}
              aria-pressed={selectedChannel === 'alipay'}
              disabled={
                paying ||
                activePending?.paymentChannel === 'alipay' ||
                activePending?.paymentChannel === 'wechat'
              }
              onClick={() => setSelectedChannel('alipay')}
            >
              <img
                className="channel-logo alipay"
                src="/assets/alipay/alipay-logo.png"
                alt=""
                width={28}
                height={28}
              />
              支付宝
            </button>
            <button
              type="button"
              className={`settlement-channel ${selectedChannel === 'wechat' ? 'active' : ''}`}
              aria-pressed={selectedChannel === 'wechat'}
              disabled={
                paying ||
                activePending?.paymentChannel === 'alipay' ||
                activePending?.paymentChannel === 'wechat'
              }
              onClick={() => setSelectedChannel('wechat')}
            >
              <span className="channel-icon wechat" aria-hidden="true">
                微
              </span>
              微信支付
            </button>
          </div>
          <p className="settlement-channel-hint">
            先选择支付方式，再点击“立即支付”，即可在弹窗内完成付款。
          </p>
          {activePending && (
            <div className="settlement-checkout-actions">
              <span>
                {orderExpired
                  ? '订单已超时'
                  : selectedChannel
                    ? `应付金额 ${formatAmount(activePending.amount)}`
                    : '请选择支付方式'}
              </span>
              <button
                type="button"
                className="settlement-primary-btn"
                disabled={paying || !selectedChannel || orderExpired}
                onClick={() => void handlePay(activePending.id)}
              >
                {paying ? '处理中…' : orderExpired ? '支付已超时' : '立即支付'}
              </button>
              {orderExpired && (
                <button
                  type="button"
                  className="settlement-primary-btn is-ghost"
                  onClick={() => navigate('/membership')}
                >
                  重新下单
                </button>
              )}
            </div>
          )}
        </section>

        <section className="settlement-history-card">
          <div className="settlement-history-head">
            <h2>历史订单</h2>
            <span>订单状态实时更新</span>
          </div>
          <div className="settlement-table-wrap">
            <table className="settlement-table">
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
                    <td colSpan={6} className="settlement-empty">
                      加载中…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="settlement-empty">
                      暂无订单
                    </td>
                  </tr>
                ) : (
                  orders.map((row) => {
                    const meta = ORDER_STATUS_META[row.status] ?? {
                      label: row.status,
                      tone: 'muted',
                    };
                    return (
                      <tr key={row.id}>
                        <td className="mono">{row.orderNo}</td>
                        <td>{row.content}</td>
                        <td className="amount">{formatAmount(row.amount)}</td>
                        <td>
                          <span className="settlement-pill channel">
                            {channelLabel(row.paymentChannel)}
                          </span>
                        </td>
                        <td>
                          <span className={`settlement-pill ${meta.tone}`}>
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
        </section>
      </main>
      <Modal
        title={
          cashier
            ? `${cashier.channel === 'wechat' ? '微信支付' : '支付宝支付'} · ${formatAmount(cashier.order.amount)}`
            : '扫码支付'
        }
        open={Boolean(cashier)}
        onCancel={() => setCashier(null)}
        width={600}
        centered
        destroyOnClose
        maskClosable={false}
        footer={
          cashier && (
            <>
              <button
                type="button"
                className="settlement-primary-btn is-ghost"
                onClick={() => setCashier(null)}
              >
                稍后支付
              </button>
              <button
                type="button"
                className="settlement-primary-btn"
                disabled={paying}
                onClick={() => void handleOrderAction(cashier.order, 'sync')}
              >
                {paying ? '查询中…' : '我已支付，查询结果'}
              </button>
            </>
          )
        }
      >
        {cashier && (
          <>
            <p className="settlement-cashier-hint">
              订单号 {cashier.order.orderNo} · 请使用
              {channelLabel(cashier.channel)}
              扫码支付。关闭弹窗后仍可继续支付或查询结果。
            </p>
            {cashierSecondsLeft !== null && (
              <p className="settlement-countdown">
                {cashierSecondsLeft === 0
                  ? '支付时间已结束，如已付款请查询支付结果。'
                  : `支付剩余时间 ${countdownLabel(cashierSecondsLeft)}`}
              </p>
            )}
            {error && (
              <div className="settlement-notice is-error" role="alert">
                {error}
              </div>
            )}
            {cashierSecondsLeft !== 0 && (
              <div className="settlement-cashier-code">
                {cashier.channel === 'wechat' && cashier.qrCode ? (
                  <QRCodeSVG
                    value={cashier.qrCode}
                    size={248}
                    marginSize={4}
                    title="微信支付二维码"
                  />
                ) : (
                  <iframe
                    className="settlement-cashier-frame"
                    title="支付宝收银台"
                    scrolling="no"
                    srcDoc={cashier.html}
                    sandbox="allow-forms allow-scripts allow-same-origin"
                  />
                )}
              </div>
            )}
          </>
        )}
      </Modal>
    </ResearchLayout>
  );
}
