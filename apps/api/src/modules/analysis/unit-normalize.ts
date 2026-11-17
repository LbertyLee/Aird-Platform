/**
 * Unit normalization for analysis observations.
 * Same-currency scale factors (亿元→元) plus CNY↔USD via yearly average FX.
 */

export type NormalizationStatus = 'same' | 'converted' | 'unknown';

export type NormalizedObservationFields = {
  originalUnit?: string;
  normalizedValue: number | null;
  value: number | null;
  normalizationStatus: NormalizationStatus;
};

/** CNY per 1 USD — annual averages (approx. SAFE / market). */
const CNY_PER_USD_BY_YEAR: Record<string, number> = {
  '2018': 6.6174,
  '2019': 6.8985,
  '2020': 6.8976,
  '2021': 6.4515,
  '2022': 6.7261,
  '2023': 7.0809,
  '2024': 7.1957,
  '2025': 7.2,
};

export function yearlyCnyPerUsd(period?: string): number | null {
  if (!period) return null;
  const year = period.match(/(20\d{2})/)?.[1];
  if (!year) return null;
  return CNY_PER_USD_BY_YEAR[year] ?? null;
}

export function normalizeObservationUnits(input: {
  value: number | null;
  originalUnit?: string;
  targetUnit: string;
  period?: string;
}): NormalizedObservationFields {
  const originalUnit = input.originalUnit?.trim();
  const from = normalizeUnit(originalUnit);
  const to = normalizeUnit(input.targetUnit);
  if (input.value == null) {
    return {
      ...(originalUnit ? { originalUnit } : {}),
      normalizedValue: null,
      value: null,
      normalizationStatus: !from || !to || from === to ? 'same' : 'unknown',
    };
  }
  if (from === to) {
    return {
      ...(originalUnit ? { originalUnit } : {}),
      normalizedValue: input.value,
      value: input.value,
      normalizationStatus: 'same',
    };
  }

  const converted = convertUnit(input.value, from, to, input.period);
  if (converted == null) {
    return {
      ...(originalUnit ? { originalUnit } : {}),
      normalizedValue: null,
      value: null,
      normalizationStatus: 'unknown',
    };
  }
  return {
    ...(originalUnit ? { originalUnit } : {}),
    normalizedValue: converted,
    value: converted,
    normalizationStatus: 'converted',
  };
}

export function convertUnit(
  value: number,
  fromRaw: string,
  toRaw: string,
  period?: string,
): number | null {
  const from = normalizeUnit(fromRaw);
  const to = normalizeUnit(toRaw);
  if (!from || !to) return null;
  if (from === to) return value;

  const fromDim = unitDimension(from);
  const toDim = unitDimension(to);

  if (fromDim === toDim && fromDim !== 'unknown') {
    const fromFactor = unitFactor(from);
    const toFactor = unitFactor(to);
    if (fromFactor == null || toFactor == null) return null;
    return (value * fromFactor) / toFactor;
  }

  // Cross-currency: reduce both sides to base 元 / 美元, then apply yearly FX.
  if (
    (fromDim === 'currency-cny' && toDim === 'currency-usd') ||
    (fromDim === 'currency-usd' && toDim === 'currency-cny')
  ) {
    const rate = yearlyCnyPerUsd(period);
    if (rate == null || rate <= 0) return null;
    const fromFactor = unitFactor(from);
    const toFactor = unitFactor(to);
    if (fromFactor == null || toFactor == null) return null;
    const base = value * fromFactor;
    const inTargetBase = fromDim === 'currency-cny' ? base / rate : base * rate;
    return inTargetBase / toFactor;
  }

  return null;
}

export function unitFactor(unit: string): number | null {
  const factors: Record<string, number> = {
    元: 1,
    千元: 1e3,
    万元: 1e4,
    百万元: 1e6,
    亿元: 1e8,
    万亿元: 1e12,
    美元: 1,
    千美元: 1e3,
    万美元: 1e4,
    百万美元: 1e6,
    十亿美元: 1e9,
    亿美元: 1e8,
    万亿美元: 1e12,
    万人: 1e4,
    万人次: 1e4,
    百万人: 1e6,
    '%': 0.01,
    百分比: 0.01,
    比例: 1,
    percent: 0.01,
    ratio: 1,
  };
  return factors[unit] ?? null;
}

export function unitDimension(
  unit: string,
): 'currency-cny' | 'currency-usd' | 'count' | 'ratio' | 'unknown' {
  if (/美元$/.test(unit) || unit === 'usd') return 'currency-usd';
  if (/元$/.test(unit) || unit === 'cny' || unit === 'rmb')
    return 'currency-cny';
  if (
    unit === '%' ||
    unit === '百分比' ||
    unit === '比例' ||
    unit === 'percent' ||
    unit === 'ratio'
  ) {
    return 'ratio';
  }
  if (/人$/.test(unit) || /人次$/.test(unit)) return 'count';
  return 'unknown';
}

export function normalizeUnit(value: string | undefined): string {
  const normalized = (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s,]/g, '')
    // Traditional / variant forms used by HK/TW and some .gov.cn mirrors.
    .replace(/億/g, '亿')
    .replace(/萬/g, '万')
    .replace(/圓/g, '元')
    .replace(/￥/g, '元')
    .replace(/^人民币$/, '元')
    .replace(/^rmb$/, '元')
    .replace(/^cny$/, '元')
    .replace(/^usd$/, '美元')
    .replace(/^us\$/, '美元')
    .replace(/^＄/, '美元')
    .replace(/^％$/, '%');

  // Sources put the currency before or after the scale ("人民币亿元",
  // "万亿元人民币", "USD million"). Canonicalize them before factor lookup.
  const cny = normalized.replace(/人民币|rmb|cny/g, '');
  if (/^(?:千|万|亿|万亿|百万)?元$/.test(cny)) return cny;

  const usd = normalized
    .replace(/u\.?s\.?\$|us\$|美元|usd|\$/g, '')
    .replace(/^m(?:illion)?$/i, '百万')
    .replace(/^bn?$/i, '十亿')
    .replace(/^billion$/i, '十亿')
    .replace(/^tn?$/i, '万亿')
    .replace(/^trillion$/i, '万亿');
  if (
    /^(?:千|万|亿|十亿|百万|万亿)?$/.test(usd) &&
    /美元|usd|\$/i.test(normalized)
  ) {
    return `${usd}美元`;
  }
  return normalized;
}
