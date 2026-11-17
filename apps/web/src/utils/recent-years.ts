/** Keep in sync with apps/api/src/common/utils/recent-years.ts (display-only). */

export function currentCalendarYear(now = new Date()): number {
  return now.getFullYear();
}

export function lastCompletedCalendarYear(now = new Date()): number {
  return currentCalendarYear(now) - 1;
}

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

export function parseRecentYearCount(text: string): number | null {
  const recent = text.match(
    /(?:近|最近)\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*年/u,
  );
  if (!recent) return null;
  const raw = recent[1];
  let count: number;
  if (/^\d+$/.test(raw)) {
    count = Number(raw);
  } else if (raw.includes('十')) {
    count =
      (raw.startsWith('十') ? 1 : (CHINESE_DIGITS[raw[0]] ?? 0)) * 10 +
      (CHINESE_DIGITS[raw.split('十')[1] ?? ''] ?? 0);
  } else {
    count = CHINESE_DIGITS[raw] ?? 0;
  }
  const n = Math.min(50, Math.max(1, count));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function recentCompletedRangeLabel(
  count: number,
  now = new Date(),
): string {
  const end = lastCompletedCalendarYear(now);
  const start = end - count + 1;
  return `${start}-${end}`;
}

export function timeRangeLabelFromQuery(
  query: string,
  now = new Date(),
): string | null {
  const count = parseRecentYearCount(query);
  if (count == null) return null;
  return recentCompletedRangeLabel(count, now);
}
