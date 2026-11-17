import {
  convertUnit,
  normalizeObservationUnits,
  yearlyCnyPerUsd,
} from './unit-normalize';

describe('unit-normalize', () => {
  it('converts 亿元 CNY GDP to USD with yearly FX', () => {
    // 2022: 1,204,724 亿元 ≈ 1.204724e14 元 / 6.7261 ≈ 1.791e13 USD
    const usd = convertUnit(1_204_724, '亿元', '美元', '2022');
    expect(usd).not.toBeNull();
    expect(usd!).toBeGreaterThan(1.7e13);
    expect(usd!).toBeLessThan(1.9e13);
  });

  it('marks observation as converted and keeps original unit', () => {
    const result = normalizeObservationUnits({
      value: 1_149_237,
      originalUnit: '亿元',
      targetUnit: '美元',
      period: '2021',
    });
    expect(result.normalizationStatus).toBe('converted');
    expect(result.originalUnit).toBe('亿元');
    expect(result.value).toBe(convertUnit(1_149_237, '亿元', '美元', '2021'));
  });

  it('keeps unknown when FX year is missing', () => {
    const result = normalizeObservationUnits({
      value: 100,
      originalUnit: '亿元',
      targetUnit: '美元',
      period: '1999',
    });
    expect(result.normalizationStatus).toBe('unknown');
    expect(result.value).toBeNull();
    expect(result.normalizedValue).toBeNull();
  });

  it('does not label values with missing source units as normalized', () => {
    expect(normalizeObservationUnits({ value: 100, targetUnit: '万亿美元' }))
      .toMatchObject({ value: null, normalizedValue: null, normalizationStatus: 'unknown' });
  });

  it('converts traditional 億元 CNY to 万亿美元', () => {
    const result = normalizeObservationUnits({
      value: 1_349_084,
      originalUnit: '億元',
      targetUnit: '万亿美元',
      period: '2024',
    });
    expect(result.normalizationStatus).toBe('converted');
    expect(result.originalUnit).toBe('億元');
    expect(result.value!).toBeGreaterThan(18);
    expect(result.value!).toBeLessThan(20);
  });

  it.each([
    ['万亿元人民币', '万亿美元', 121.02, 2023, 17, 19],
    ['人民币亿元', 'USD billion', 1_204_724, 2022, 17_000, 19_000],
  ])(
    'recognizes common currency-scale spellings: %s → %s',
    (from, to, value, year, min, max) => {
      const converted = convertUnit(value, from, to, String(year));
      expect(converted).not.toBeNull();
      expect(converted!).toBeGreaterThan(min);
      expect(converted!).toBeLessThan(max);
    },
  );
});
