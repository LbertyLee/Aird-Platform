/**
 * 运营看板时区与日历日工具。
 * 默认业务时区 Asia/Shanghai；日期边界按该时区切日，避免 UTC 错日。
 */

/** 默认业务时区 */
export const DASHBOARD_DEFAULT_TIMEZONE = 'Asia/Shanghai';

/** 允许的时区白名单（避免任意 IANA 注入到 SQL） */
const ALLOWED_TIMEZONES = new Set([
  'Asia/Shanghai',
  'UTC',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
]);

/**
 * 规范化时区；非法值回退默认。
 */
export function normalizeDashboardTimezone(timezone?: string): string {
  const value = (timezone ?? DASHBOARD_DEFAULT_TIMEZONE).trim();
  if (ALLOWED_TIMEZONES.has(value)) return value;
  return DASHBOARD_DEFAULT_TIMEZONE;
}

/**
 * 校验 YYYY-MM-DD。
 */
export function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * 当前时刻在指定时区的日历日 YYYY-MM-DD。
 */
export function zonedToday(timezone: string, now = new Date()): string {
  return formatInTimeZone(now, timezone);
}

/**
 * 用 Intl 格式化为时区日历日。
 */
export function formatInTimeZone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  return `${y}-${m}-${d}`;
}

/**
 * 日历日加减天数。
 */
export function addDays(dateOnly: string, days: number): string {
  const [y, m, d] = dateOnly.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + days));
  return utc.toISOString().slice(0, 10);
}

/**
 * 含首尾的日期序列。
 */
export function eachDateInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = startDate;
  while (cur <= endDate) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/**
 * 将业务时区日历日的 [00:00:00.000, 次日 00:00:00.000) 转为 UTC Date。
 */
export function zonedDayRangeUtc(
  dateOnly: string,
  timezone: string,
): { start: Date; endExclusive: Date } {
  const start = zonedLocalToUtc(dateOnly, '00:00:00.000', timezone);
  const endExclusive = zonedLocalToUtc(addDays(dateOnly, 1), '00:00:00.000', timezone);
  return { start, endExclusive };
}

/**
 * 区间 [startDate, endDate] 在业务时区下的 UTC 半开区间。
 */
export function zonedInclusiveRangeUtc(
  startDate: string,
  endDate: string,
  timezone: string,
): { start: Date; endExclusive: Date } {
  const start = zonedDayRangeUtc(startDate, timezone).start;
  const endExclusive = zonedDayRangeUtc(endDate, timezone).endExclusive;
  return { start, endExclusive };
}

/**
 * Prisma @db.Date 存储用的 UTC 正午锚定，避免时区偏移导致日期漂移。
 */
export function dateOnlyToPrismaDate(dateOnly: string): Date {
  return new Date(`${dateOnly}T00:00:00.000Z`);
}

/**
 * Prisma Date → YYYY-MM-DD。
 */
export function prismaDateToDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * 将「时区本地墙钟」转为 UTC Instant。
 * 通过迭代修正偏移，兼容固定偏移与夏令时区。
 */
function zonedLocalToUtc(
  dateOnly: string,
  time: string,
  timezone: string,
): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const [hh, mm, ssMs] = time.split(':');
  const [ss, ms = '0'] = ssMs.split('.');
  const asUtc = Date.UTC(
    year,
    month - 1,
    day,
    Number(hh),
    Number(mm),
    Number(ss),
    Number(ms.padEnd(3, '0').slice(0, 3)),
  );

  let guess = asUtc;
  for (let i = 0; i < 3; i += 1) {
    const offset = getTimeZoneOffsetMs(new Date(guess), timezone);
    const next = asUtc - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/**
 * 指定瞬间在时区下相对 UTC 的偏移（本地 = UTC + offset）。
 */
function getTimeZoneOffsetMs(date: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const asLocal = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asLocal - date.getTime();
}
