/**
 * 字段名 ↔ 指标 自动匹配（纯函数，便于单测）。
 */

export type FieldMappingMatchCandidate = {
  id: string;
  code: string;
  name: string;
  aliases: string[];
};

export type FieldMappingFieldInput = {
  id: string;
  fieldName: string;
  displayName?: string | null;
  dataType: string;
  semanticType?: string | null;
};

export type FieldMappingScoredMatch = {
  indicatorId: string;
  datasetFieldId: string;
  confidence: number;
  matchTerm: string;
  aggregation: 'NONE' | 'SUM';
};

const HIGH = 0.85;
const MEDIUM = 0.55;
/** 仅「指标名 ↔ 字段」归一化全等才允许 1.0；别名/code 最高到此值，必须走 LLM */
const ALIAS_EXACT_CAP = 0.99;

const DIMENSION_HINTS =
  /^(国家|地区|区域|省份|城市|年份|年|年月|日期|时间|country|region|area|province|city|year|date|time|period)$/i;

const UNIT_PATTERN =
  /[(（]\s*(元|万元|亿元|美元|美[元圓]|usd|cny|rmb|%|％|万人|人|个|台|吨|千克|kg|亿元人民币)\s*[)）]/gi;

const SYNONYM_FOLDS: Array<[RegExp, string]> = [
  [/人均国内生产总值/g, '人均gdp'],
  [/国内生产总值/g, 'gdp'],
  [/gdppercapita/g, '人均gdp'],
  [/gdppc/g, '人均gdp'],
];

/** 比率 / 增速类概念 */
const RATE_CONCEPT =
  /增速|增长率|同比|环比|占比|比重|比例|百分|rate|growth|ratio|share|percent|pct|yoy|qoq/i;

/** 绝对金额 / 水平值概念（字段侧） */
const ABSOLUTE_AMOUNT =
  /亿元|万元|千元|美元|美圓|usd|cny|rmb|金额|总量|总额|(?<![增速增长率同比环比占比比重])元(?![均])/i;

/**
 * 归一化字段/指标名：去空白、单位括号、全半角差异，同义词折叠。
 */
export function normalizeFieldLabel(raw: string): string {
  let text = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（(]/g, '(')
    .replace(/[）)]/g, ')')
    .replace(/［/g, '[')
    .replace(/］/g, ']')
    .replace(/＿/g, '_')
    .replace(/－|—|–/g, '-');

  text = text.replace(UNIT_PATTERN, '');
  text = text.replace(/[()[\]]/g, '');
  for (const [pattern, replacement] of SYNONYM_FOLDS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * 指标与字段是否存在明显概念冲突（如增速% vs 亿元绝对值）。
 * 冲突时不应自动映射。
 */
export function hasMetricFieldConceptConflict(
  indicator: Pick<FieldMappingMatchCandidate, 'name' | 'code'>,
  fieldLabel: string,
): boolean {
  const indText = `${indicator.name} ${indicator.code}`;
  const fieldText = fieldLabel;
  const indIsRate = RATE_CONCEPT.test(indText) || /_%$|_pct$|_ratio$|_share$|_growth$/i.test(indicator.code);
  const fieldIsRate = RATE_CONCEPT.test(fieldText) || /%|％/.test(fieldText);
  const fieldIsAbsolute = ABSOLUTE_AMOUNT.test(fieldText) && !fieldIsRate;

  // 指标是增速/占比，字段是绝对金额水平值
  if (indIsRate && fieldIsAbsolute) return true;
  // 指标名强调绝对值水平、字段是比率（较少见，也拦一下）
  if (
    !indIsRate &&
    /gdp|产值|收入|人口|金额/i.test(indText) &&
    fieldIsRate &&
    !/人均/.test(normalizeFieldLabel(indText))
  ) {
    // 仅当字段明确是比率且指标不是人均类时
    if (RATE_CONCEPT.test(fieldText)) return true;
  }
  return false;
}

function longestCommonSubstringLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const m = a.length;
  const n = b.length;
  let best = 0;
  const prev = new Array<number>(n + 1).fill(0);
  const curr = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return best;
}

function isLikelyDimension(field: FieldMappingFieldInput): boolean {
  const label = (field.displayName || field.fieldName).trim();
  if (DIMENSION_HINTS.test(label)) return true;
  if (field.semanticType === 'dimension' || field.semanticType === 'time') {
    return true;
  }
  const norm = normalizeFieldLabel(label);
  return /^(国家|地区|年份|year|country|region)$/.test(norm);
}

function isNumericField(field: FieldMappingFieldInput): boolean {
  const t = field.dataType.toLowerCase();
  return (
    t === 'decimal' ||
    t === 'number' ||
    t === 'float' ||
    t === 'double' ||
    t === 'int' ||
    t === 'integer' ||
    field.semanticType === 'metric'
  );
}

function scoreTermAgainstField(
  term: string,
  fieldLabel: string,
  field: FieldMappingFieldInput,
  kind: 'name' | 'code' | 'alias',
): number {
  const nTerm = normalizeFieldLabel(term);
  const nField = normalizeFieldLabel(fieldLabel);
  if (!nTerm || nTerm.length < 2 || !nField) return 0;

  if (nTerm === nField) {
    // 只有「指标正式名称」归一化全等才给满分；短别名/code 一律交给 LLM
    if (kind === 'name') return 1;
    if (nTerm.length <= 4) return 0.72; // GDP、CPI 等过短
    return ALIAS_EXACT_CAP;
  }

  const numeric = isNumericField(field);
  // 避免 cab_gdp ⊃ gdp 这类「短字段被长 code 包含」误伤
  if (numeric && nField.includes(nTerm) && nTerm.length >= 3) {
    if (nField.length - nTerm.length <= 8) return 0.9;
    return 0.82;
  }
  if (numeric && nTerm.includes(nField) && nField.length >= 3) {
    // 「GDP实际增速」包含「gdp」：覆盖率低，压到需 LLM，且仍可能被概念冲突清零
    const coverage = nField.length / nTerm.length;
    if (coverage < 0.55) return 0.6;
    if (nTerm.length - nField.length <= 8) return 0.88;
    return 0.8;
  }

  const lcs = longestCommonSubstringLength(nTerm, nField);
  const minLen = Math.min(nTerm.length, nField.length);
  const maxLen = Math.max(nTerm.length, nField.length);
  if (lcs >= 4 && lcs / minLen >= 0.7) {
    const ratio = lcs / maxLen;
    if (ratio >= 0.75) return 0.75;
    if (ratio >= 0.55) return 0.62;
    if (numeric && lcs >= 5) return 0.58;
  }
  return 0;
}

/**
 * 为单个数据集字段列表匹配指标映射建议。
 * 每个指标最多一条；字段冲突同分时降为中置信（由调用方标 pending）。
 */
export function matchFieldsToIndicators(
  fields: FieldMappingFieldInput[],
  indicators: FieldMappingMatchCandidate[],
): FieldMappingScoredMatch[] {
  const metricFields = fields.filter((f) => !isLikelyDimension(f));
  if (!metricFields.length || !indicators.length) return [];

  type Best = {
    fieldId: string;
    confidence: number;
    matchTerm: string;
    tied: boolean;
  };
  const bestByIndicator = new Map<string, Best>();

  for (const indicator of indicators) {
    const terms = [
      { term: indicator.name, kind: 'name' as const },
      { term: indicator.code, kind: 'code' as const },
      ...indicator.aliases.map((alias) => ({
        term: alias,
        kind: 'alias' as const,
      })),
    ].filter((t) => t.term.trim().length >= 2);

    for (const field of metricFields) {
      const labels = [field.fieldName, field.displayName ?? ''].filter(Boolean);
      // 概念冲突：增速/占比 vs 亿元绝对值 → 直接跳过
      if (
        labels.some((label) =>
          hasMetricFieldConceptConflict(indicator, label),
        )
      ) {
        continue;
      }

      let fieldBest = 0;
      let fieldTerm = '';
      for (const label of labels) {
        for (const { term, kind } of terms) {
          let score = scoreTermAgainstField(term, label, field, kind);
          if (score <= 0) continue;
          if (score > fieldBest) {
            fieldBest = score;
            fieldTerm = term;
          }
        }
      }
      if (fieldBest < MEDIUM) continue;

      const prev = bestByIndicator.get(indicator.id);
      if (!prev || fieldBest > prev.confidence + 1e-9) {
        bestByIndicator.set(indicator.id, {
          fieldId: field.id,
          confidence: fieldBest,
          matchTerm: fieldTerm,
          tied: false,
        });
      } else if (
        prev &&
        Math.abs(fieldBest - prev.confidence) < 1e-9 &&
        prev.fieldId !== field.id
      ) {
        bestByIndicator.set(indicator.id, { ...prev, tied: true });
      }
    }
  }

  // 同一字段被多个指标抢走时：保留最高分，其余降权
  const fieldWinners = new Map<
    string,
    { indicatorId: string; confidence: number }
  >();
  for (const [indicatorId, best] of bestByIndicator) {
    if (best.tied) {
      best.confidence = Math.min(best.confidence, ALIAS_EXACT_CAP);
    }
    const win = fieldWinners.get(best.fieldId);
    if (!win || best.confidence > win.confidence) {
      fieldWinners.set(best.fieldId, {
        indicatorId,
        confidence: best.confidence,
      });
    }
  }

  const results: FieldMappingScoredMatch[] = [];
  for (const [indicatorId, best] of bestByIndicator) {
    const winner = fieldWinners.get(best.fieldId);
    let confidence = best.confidence;
    if (winner && winner.indicatorId !== indicatorId) {
      confidence = Math.min(confidence, ALIAS_EXACT_CAP);
    }
    if (confidence < MEDIUM) continue;
    results.push({
      indicatorId,
      datasetFieldId: best.fieldId,
      confidence,
      matchTerm: best.matchTerm,
      aggregation: 'NONE',
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}

/**
 * 仅归一化后完全相等（1.0）可自动启用；其余候选需 LLM 判定。
 */
export function classifyMatchConfidence(
  confidence: number,
): 'exact' | 'needs_llm' | 'low' {
  if (confidence >= EXACT) return 'exact';
  if (confidence >= MEDIUM) return 'needs_llm';
  return 'low';
}

const EXACT = 1;

export const FIELD_MAPPING_AUTO_THRESHOLDS = { EXACT, HIGH, MEDIUM } as const;
