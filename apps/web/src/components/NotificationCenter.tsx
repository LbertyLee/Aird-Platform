import {
  ArrowLeft,
  ArrowUpFromLine,
  Bell,
  BookOpenCheck,
  Check,
  CheckCheck,
  Crown,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  fetchMessageCenter,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  type Announcement,
  type UserNotification,
} from '../api/messages';

export const NOTIFICATIONS_UPDATED_EVENT = 'aird:notifications-updated';

export function notifyNotificationsUpdated() {
  window.dispatchEvent(new Event(NOTIFICATIONS_UPDATED_EVENT));
}

const TYPE_OPTIONS = [
  { value: 'all', label: '全部类型' },
  { value: 'announcement', label: '平台公告' },
  { value: 'payment_success', label: '支付成功' },
  { value: 'membership_activated', label: '会员开通' },
  { value: 'refund', label: '退款成功' },
  { value: 'report_ready', label: '报告生成' },
  { value: 'renewal', label: '续费提醒' },
  { value: 'knowledge_index', label: '索引更新' },
  { value: 'file_learned', label: '文件学习' },
] as const;

const TIME_OPTIONS = [
  { value: 'all', label: '全部时间' },
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
] as const;

const BIZ_META: Record<string, { title: string; icon: ReactNode }> = {
  announcement: { title: '平台公告', icon: <Bell size={16} /> },
  payment_success: { title: '支付成功', icon: <Check size={16} /> },
  membership_activated: { title: '会员开通成功', icon: <Crown size={16} /> },
  refund: { title: '退款成功', icon: <RotateCcw size={16} /> },
  report_ready: { title: '报告生成完成', icon: <Check size={16} /> },
  renewal: { title: '会员续费提醒', icon: <Bell size={16} /> },
  knowledge_index: { title: '知识库索引更新', icon: <RefreshCw size={16} /> },
  file_learned: { title: '文件学习完成', icon: <BookOpenCheck size={16} /> },
  import: { title: '数据接入审核结果', icon: <ArrowUpFromLine size={16} /> },
  order: { title: '订单提醒', icon: <Bell size={16} /> },
  general: { title: '系统通知', icon: <Bell size={16} /> },
};

type DetailView = {
  kind: string;
  title: string;
  content: string;
  time?: string | null;
};

function formatNotifyTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `今天 ${hm}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${hm}`;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${hm}`;
}

/** 解析 fan-out 内容「【标题】正文」 */
function parseAnnouncementContent(raw: string): { title: string; content: string } {
  const matched = raw.match(/^【([^】]{1,60})】(.*)$/s);
  if (matched) {
    return {
      title: matched[1].trim() || '平台公告',
      content: matched[2].trim() || raw,
    };
  }
  return { title: '平台公告', content: raw };
}

function previewText(text: string, max = 72) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export default function NotificationCenter({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [bizType, setBizType] = useState('all');
  const [timeRange, setTimeRange] = useState('all');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadHint, setUnreadHint] = useState(0);
  const [markingAll, setMarkingAll] = useState(false);
  const [detail, setDetail] = useState<DetailView | null>(null);

  async function load(filters?: { bizType?: string; timeRange?: string }) {
    if (!enabled) return;
    setLoading(true);
    try {
      const data = await fetchMessageCenter({
        bizType: filters?.bizType ?? bizType,
        timeRange: filters?.timeRange ?? timeRange,
      });
      setAnnouncements(data.announcements);
      setNotifications(data.notifications);
      if ((filters?.bizType ?? bizType) === 'all' && (filters?.timeRange ?? timeRange) === 'all') {
        setUnreadHint(
          data.notifications.filter((item) => item.status === 'unread').length,
        );
      }
    } catch {
      // Message center is supplemental and should not block research.
    } finally {
      setLoading(false);
    }
  }

  async function refreshUnreadBadge() {
    if (!enabled) return;
    try {
      const data = await fetchMessageCenter({ bizType: 'all', timeRange: 'all' });
      setUnreadHint(
        data.notifications.filter((item) => item.status === 'unread').length,
      );
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void refreshUnreadBadge();
  }, [enabled]);

  useEffect(() => {
    function onUpdated() {
      void refreshUnreadBadge();
      if (open) void load();
    }
    window.addEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(NOTIFICATIONS_UPDATED_EVENT, onUpdated);
  }, [enabled, open, bizType, timeRange]);

  useEffect(() => {
    if (!open || !enabled) return;
    void load();
  }, [open, enabled, bizType, timeRange]);

  useEffect(() => {
    if (!open) {
      setDetail(null);
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      if (detail) {
        setDetail(null);
        return;
      }
      setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, detail]);

  async function markRead(item: UserNotification) {
    if (item.status === 'read') return;
    try {
      const updated = await markUserNotificationRead(item.id);
      setNotifications((current) =>
        current.map((row) => (row.id === item.id ? updated : row)),
      );
      setUnreadHint((n) => Math.max(0, n - 1));
    } catch {
      /* keep the item unread when the request fails */
    }
  }

  async function openNotificationDetail(item: UserNotification) {
    void markRead(item);
    const meta = BIZ_META[item.bizType] ?? BIZ_META.general;
    if (item.bizType === 'announcement') {
      const parsed = parseAnnouncementContent(item.content);
      setDetail({
        kind: meta.title,
        title: parsed.title,
        content: parsed.content,
        time: item.sentAt,
      });
      return;
    }
    setDetail({
      kind: meta.title,
      title: meta.title,
      content: item.content,
      time: item.sentAt,
    });
  }

  function openAnnouncementDetail(item: Announcement) {
    setDetail({
      kind: '平台公告',
      title: item.title,
      content: item.content,
      time: item.publishedAt,
    });
  }

  async function markAllRead() {
    if (markingAll || unreadHint <= 0) return;
    setMarkingAll(true);
    try {
      await markAllUserNotificationsRead();
      setNotifications((current) =>
        current.map((row) =>
          row.status === 'unread' ? { ...row, status: 'read' } : row,
        ),
      );
      setUnreadHint(0);
      notifyNotificationsUpdated();
    } catch {
      /* keep unread state when the request fails */
    } finally {
      setMarkingAll(false);
    }
  }

  const drawer =
    open &&
    createPortal(
      <div className="notification-drawer-root" role="presentation">
        <button
          type="button"
          className="notification-drawer-mask"
          aria-label="关闭消息通知"
          onClick={() => setOpen(false)}
        />
        <aside
          className="notification-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="消息通知"
        >
          <header className="notification-drawer-head">
            {detail ? (
              <>
                <button
                  type="button"
                  className="notification-back"
                  onClick={() => setDetail(null)}
                >
                  <ArrowLeft size={16} />
                  返回
                </button>
                <strong>消息详情</strong>
                <button
                  type="button"
                  className="notification-close"
                  title="关闭"
                  onClick={() => setOpen(false)}
                >
                  <X size={16} />
                </button>
              </>
            ) : (
              <>
                <strong>消息通知</strong>
                <div className="notification-drawer-actions">
                  <button
                    type="button"
                    className="notification-mark-all"
                    title="一键已读"
                    disabled={markingAll || unreadHint <= 0}
                    onClick={() => void markAllRead()}
                  >
                    {markingAll ? (
                      <LoaderCircle className="spin" size={14} />
                    ) : (
                      <CheckCheck size={14} />
                    )}
                    一键已读
                  </button>
                  <button
                    type="button"
                    className="notification-close"
                    title="关闭"
                    onClick={() => setOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
              </>
            )}
          </header>

          {detail ? (
            <div className="notification-detail">
              <span className="notification-detail-kind">{detail.kind}</span>
              <h2>{detail.title}</h2>
              {detail.time ? (
                <time>{formatNotifyTime(detail.time)}</time>
              ) : null}
              <p>{detail.content}</p>
            </div>
          ) : (
            <>
              <div className="notification-drawer-filters">
                <label>
                  <span>类型</span>
                  <select
                    value={bizType}
                    onChange={(e) => setBizType(e.target.value)}
                    aria-label="按类型筛选"
                  >
                    {TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>时间</span>
                  <select
                    value={timeRange}
                    onChange={(e) => setTimeRange(e.target.value)}
                    aria-label="按时间筛选"
                  >
                    {TIME_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="notification-drawer-body">
                {loading ? (
                  <div className="notification-empty">
                    <LoaderCircle className="spin" size={18} />
                  </div>
                ) : (
                  <>
                    {bizType === 'all' &&
                      timeRange === 'all' &&
                      announcements.length > 0 && (
                        <section className="notification-section">
                          <h3>平台公告</h3>
                          {announcements.map((item) => (
                            <button
                              type="button"
                              key={item.id}
                              className="notification-card"
                              onClick={() => openAnnouncementDetail(item)}
                            >
                              <span className="notification-icon">
                                <Bell size={16} />
                              </span>
                              <div className="notification-body">
                                <strong>{item.title}</strong>
                                <p>{previewText(item.content)}</p>
                                {item.publishedAt ? (
                                  <time>{formatNotifyTime(item.publishedAt)}</time>
                                ) : null}
                              </div>
                            </button>
                          ))}
                        </section>
                      )}

                    {notifications.length > 0 ? (
                      <section className="notification-section">
                        {bizType === 'all' &&
                        timeRange === 'all' &&
                        announcements.length > 0 ? (
                          <h3>我的通知</h3>
                        ) : null}
                        {notifications.map((item) => {
                          const meta = BIZ_META[item.bizType] ?? BIZ_META.general;
                          const listTitle =
                            item.bizType === 'announcement'
                              ? parseAnnouncementContent(item.content).title
                              : meta.title;
                          const listBody =
                            item.bizType === 'announcement'
                              ? parseAnnouncementContent(item.content).content
                              : item.content;
                          return (
                            <button
                              type="button"
                              className={`notification-card ${item.status}`}
                              key={item.id}
                              onClick={() => void openNotificationDetail(item)}
                            >
                              <span className="notification-icon">{meta.icon}</span>
                              <div className="notification-body">
                                <strong>
                                  {listTitle}
                                  {item.status === 'unread' ? (
                                    <em className="notification-unread-dot" />
                                  ) : null}
                                </strong>
                                <p>{previewText(listBody)}</p>
                                <time>{formatNotifyTime(item.sentAt)}</time>
                              </div>
                            </button>
                          );
                        })}
                      </section>
                    ) : (
                      <div className="notification-empty">暂无符合条件的消息</div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </aside>
      </div>,
      document.body,
    );

  return (
    <div className="notification-center">
      <button
        type="button"
        className="nav-icon-button"
        title={enabled ? '消息通知' : '登录后查看通知'}
        aria-label="消息通知"
        onClick={() => enabled && setOpen(true)}
        disabled={!enabled}
      >
        <Bell size={17} />
        {unreadHint > 0 && (
          <span className="notification-count">
            {unreadHint > 99 ? '99+' : unreadHint}
          </span>
        )}
      </button>
      {drawer}
    </div>
  );
}
