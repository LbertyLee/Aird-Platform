import { Prisma, SubscriptionStatus } from '@prisma/client';

/** 管理端日期展示时区（与用户列表前端一致） */
const ADMIN_TIMEZONE = 'Asia/Shanghai';

/**
 * 当前有效个人订阅的 Prisma 过滤条件（与用户列表、权益解析一致）。
 */
export function activeUserSubscriptionWhere(
  now: Date,
): Prisma.UserSubscriptionWhereInput {
  return {
    deletedAt: null,
    status: SubscriptionStatus.active,
    startAt: { lte: now },
    endAt: { gte: now },
  };
}

/**
 * 同一用户存在多条有效订阅时，保留 endAt 最晚的一条（与用户列表一致）。
 */
export function pickLatestActiveSubscriptionPerUser<
  T extends { userId: string; endAt: Date },
>(subs: T[]): T[] {
  const latestByUser = new Map<string, T>();
  for (const sub of subs) {
    const existing = latestByUser.get(sub.userId);
    if (!existing || sub.endAt > existing.endAt) {
      latestByUser.set(sub.userId, sub);
    }
  }
  return Array.from(latestByUser.values()).sort(
    (a, b) => a.endAt.getTime() - b.endAt.getTime(),
  );
}

/**
 * 格式化为 YYYY-MM-DD（Asia/Shanghai），避免 UTC 切片导致日期偏差。
 */
export function formatAdminDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ADMIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * 格式化为 YYYY-MM-DD HH:mm:ss（Asia/Shanghai）。
 */
export function formatAdminDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ADMIN_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

/**
 * 计算距到期剩余整天数（按上海时区日历日）。
 */
export function daysUntilEnd(endAt: Date, now = new Date()): number {
  const endDay = formatAdminDate(endAt);
  const today = formatAdminDate(now);
  const endMs = new Date(`${endDay}T00:00:00+08:00`).getTime();
  const todayMs = new Date(`${today}T00:00:00+08:00`).getTime();
  return Math.ceil((endMs - todayMs) / (1000 * 60 * 60 * 24));
}
