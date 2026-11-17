import {
  explicitYearRangePeriods,
  parseRecentYearCount,
  parseRecentYearCountFromTexts,
  periodsFromRecentYearPhrase,
  recentCompletedCalendarYears,
  recentCompletedRangeLabel,
  recentYearRangeForQueries,
  timeRangeLabelsForPlan,
} from './recent-years';

describe('recent-years', () => {
  const now = new Date('2026-10-13T12:00:00+08:00');

  it('parses 近5年 and 近五年', () => {
    expect(parseRecentYearCount('近5年中国GDP')).toBe(5);
    expect(parseRecentYearCount('研究近五年GDP')).toBe(5);
  });

  it('uses last N completed calendar years (2026 → 2021-2025)', () => {
    expect(recentCompletedCalendarYears(5, now)).toEqual([
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
    ]);
    expect(recentCompletedRangeLabel(5, now)).toBe('2021-2025');
  });

  it('periodsFromRecentYearPhrase overrides conflicting plan labels', () => {
    expect(periodsFromRecentYearPhrase('美国近5年GDP趋势', now)).toEqual([
      '2021',
      '2022',
      '2023',
      '2024',
      '2025',
    ]);
  });

  it('anchors time from original query when optimized text dropped 近5年', () => {
    const original = '请你帮我分析分析一下 美国 近5年的GDP趋势';
    const optimized = '美国 GDP 趋势 2019-2023';
    expect(parseRecentYearCountFromTexts(optimized, original)).toBe(5);
    expect(recentYearRangeForQueries(original, optimized)).toEqual({
      start: '2021',
      end: '2025',
    });
    expect(
      timeRangeLabelsForPlan(original, optimized, {
        start: '2019',
        end: '2023',
      }),
    ).toEqual(['2021-2025']);
  });
});

import { inferQueryDimensionHints } from '../../modules/analysis/indicator-query-rank';
import { buildResearchQueryPlanLite } from '../../modules/search/research-query-plan';

describe('explicit annual ranges', () => {
  it.each(['1950-2100年', '1950年至2100年', '1950—2100'])('expands %s completely despite edition years and stale filter hints', (range) => {
    const query = `联合国 WPP 2024 中国美国 ${range}`;
    const expected = Array.from({ length: 151 }, (_, i) => String(1950 + i));
    expect(explicitYearRangePeriods(query)).toEqual(expected);
    expect(inferQueryDimensionHints(query).periods).toEqual(expected);
    expect(buildResearchQueryPlanLite(query, { timeRanges: ['2024-2026'] }).periods).toEqual(expected);
  });
  it('ignores reversed or excessive ranges and deduplicates overlaps', () => {
    expect(explicitYearRangePeriods('2100-1950')).toBeNull();
    expect(explicitYearRangePeriods('1000-2100')).toBeNull();
    expect(explicitYearRangePeriods('1950-1952、1951-1953')).toEqual(['1950','1951','1952','1953']);
  });
});
