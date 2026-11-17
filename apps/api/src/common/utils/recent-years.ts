/** Calendar year used for relative phrases like 「近5年」 (local timezone). */
export function currentCalendarYear(now = new Date()): number {
  return now.getFullYear();
}

/** Last calendar year with a full statistical year (exclude in-progress current year). */
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

/** Parse 「近5年 / 最近五年 / 近 5 年」 → N, or null. */
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

/** Recent N completed calendar years, e.g. 2026 + N=5 → 2021…2025. */
export function recentCompletedCalendarYears(
  count: number,
  now = new Date(),
): string[] {
  const n = Math.min(50, Math.max(1, count));
  const end = lastCompletedCalendarYear(now);
  const years: string[] = [];
  for (let year = end - n + 1; year <= end; year += 1) {
    years.push(String(year));
  }
  return years;
}

export function recentCompletedYearRange(
  count: number,
  now = new Date(),
): { start: string; end: string } {
  const years = recentCompletedCalendarYears(count, now);
  return { start: years[0]!, end: years[years.length - 1]! };
}

export function recentCompletedRangeLabel(
  count: number,
  now = new Date(),
): string {
  const { start, end } = recentCompletedYearRange(count, now);
  return `${start}-${end}`;
}

/** When the question says 「近N年」, that wins over stored search plan ranges. */
export function periodsFromRecentYearPhrase(
  query: string,
  now = new Date(),
): string[] | null {
  const count = parseRecentYearCount(query);
  if (count == null) return null;
  return recentCompletedCalendarYears(count, now);
}

export function sortYearStrings(years: string[]): string[] {
  return [...years].sort(
    (left, right) => Number(left) - Number(right) || left.localeCompare(right),
  );
}

export function parseRecentYearCountFromTexts(
  ...texts: string[]
): number | null {
  for (const text of texts) {
    const count = parseRecentYearCount(text);
    if (count != null) return count;
  }
  return null;
}

/** Prefer the user's original wording over LLM-optimized retrieval text. */
export function recentYearRangeForQueries(
  ...queries: string[]
): { start: string; end: string } | null {
  const count = parseRecentYearCountFromTexts(...queries);
  if (count == null) return null;
  return recentCompletedYearRange(count);
}

export function timeRangeLabelsForPlan(
  originalQuery: string,
  optimizedQuery: string,
  fallbackRange?: { start?: string; end?: string; year?: number },
): string[] {
  const anchored = recentYearRangeForQueries(originalQuery, optimizedQuery);
  if (anchored) return [`${anchored.start}-${anchored.end}`];
  if (fallbackRange?.year != null) return [String(fallbackRange.year)];
  if (fallbackRange?.start && fallbackRange?.end) {
    return [`${fallbackRange.start}-${fallbackRange.end}`];
  }
  return [];
}

/** Explicit annual intervals override edition years and stale semantic time hints. */
export function explicitYearRangePeriods(query: string): string[] | null {
  const ranges = [...query.matchAll(/(?<!\d)([12]\d{3})\s*年?\s*[-–—~～至到]\s*([12]\d{3})(?!\d)\s*年?/g)];
  if (!ranges.length) return null;
  const years = new Set<string>();
  for (const range of ranges) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end < start || end - start > 500) continue;
    for (let year = start; year <= end; year += 1) years.add(String(year));
  }
  return years.size ? sortYearStrings([...years]) : null;
}
