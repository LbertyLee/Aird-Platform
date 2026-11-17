import {
  addDays,
  eachDateInclusive,
  formatInTimeZone,
  isDateOnly,
  normalizeDashboardTimezone,
  zonedDayRangeUtc,
  zonedToday,
} from './dashboard-timezone.util';

describe('dashboard-timezone.util', () => {
  it('normalizes timezone whitelist', () => {
    expect(normalizeDashboardTimezone('Asia/Shanghai')).toBe('Asia/Shanghai');
    expect(normalizeDashboardTimezone('Invalid/Zone')).toBe('Asia/Shanghai');
  });

  it('validates date-only strings', () => {
    expect(isDateOnly('2026-09-01')).toBe(true);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('2026-9-1')).toBe(false);
  });

  it('builds inclusive date series', () => {
    expect(eachDateInclusive('2026-08-30', '2026-09-01')).toEqual([
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
    ]);
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('maps Shanghai midnight to previous UTC evening', () => {
    const { start, endExclusive } = zonedDayRangeUtc(
      '2026-09-01',
      'Asia/Shanghai',
    );
    expect(start.toISOString()).toBe('2026-08-31T16:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-09-01T16:00:00.000Z');
    expect(formatInTimeZone(start, 'Asia/Shanghai')).toBe('2026-09-01');
  });

  it('returns zoned today as YYYY-MM-DD', () => {
    const today = zonedToday('UTC', new Date('2026-09-01T10:00:00.000Z'));
    expect(today).toBe('2026-09-01');
  });
});
