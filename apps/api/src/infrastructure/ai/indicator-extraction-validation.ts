import type {
  ExtractedIndicatorValue,
  IndicatorCatalogForExtraction,
} from './deepseek-chat.service';
import { normalizeUnit } from '../../modules/analysis/unit-normalize';
import { parseWorldBankGdpEvidence, sameWorldBankEntity } from './world-bank-gdp-evidence';
import { containsSearchTerm } from '../../research/research-filtering';
import type { ResearchQueryPlan } from '../../modules/search/research-query-plan';
import {
  entityMatchesPlan,
  periodMatchesPlan,
} from '../../modules/search/research-query-plan';

const REAL_PRICE_RE =
  /不变价|可比价|固定(?:基期)?价格|按照?\s*\d{4}\s*年价格|以\s*\d{4}\s*年价格|实际(?:gdp|国内生产总值)/i;
const GROWTH_RE =
  /增速|增长率|同比|环比|实际增长|增长\s*\d|下降|下降率|growth|declin|decreas/i;
const PER_CAPITA_RE = /人均|每人|per\s*capita/i;
const SHARE_RE = /占比|比重|占\s*(?:gdp|国内生产总值)|share|ratio/i;
const FORECAST_RE =
  /预测|预计|预估|有望达到|预期目标|目标为|目标值|计划达到|力争|争取|forecast|projected|estimated to reach/i;

/** Repair inline numeric spacing from HTML/PDF without joining table cells. */
export function normalizeEvidenceNumbers(text: string): string {
  return text
    .replace(/(\d)\.[ \t\u00a0]+(?=\d)/g, '$1.')
    .replace(/\b([12]\d{2})[ \t\u00a0]+(\d)(?=\s*年)/g, '$1$2');
}

function compact(text: string): string {
  return text.replace(/\s+/g, '').replace(/[，,]/g, '').toLowerCase();
}

function metricTerms(indicator: IndicatorCatalogForExtraction): string[] {
  const family = indicator.code
    .match(/^(gdp|cpi|ppi|pmi)(?:_|$)/i)?.[1]
    ?.toLowerCase();
  const families: Record<string, string[]> = {
    gdp: ['GDP', '国内生产总值', '地区生产总值', 'gross domestic product'],
    cpi: ['CPI', '居民消费价格指数', '消费者价格指数', 'consumer price index'],
    ppi: ['PPI', '工业生产者出厂价格指数', 'producer price index'],
    pmi: ['PMI', '采购经理指数', 'purchasing managers index'],
  };
  return [
    indicator.name,
    indicator.code,
    ...(indicator.aliases ?? []),
    ...(families[family ?? ''] ?? []),
  ].filter(Boolean);
}

function numberTokens(text: string) {
  return [
    ...text.matchAll(/(?<![\d.+-])[+-]?\d+(?:[，,]\d{3})*(?:\.\d+)?(?![\d.])/g),
  ];
}

/** Bind a value to its clause or table cell, rather than any number in a quote. */
function hasBoundEvidence(
  item: ExtractedIndicatorValue,
  indicator: IndicatorCatalogForExtraction,
  evidence: string,
  document: string,
): boolean {
  const expected = Number(String(item.value).replace(/[，,\s]/g, ''));
  const period = item.period?.match(/[12]\d{3}/)?.[0];
  const terms = metricTerms(indicator);
  const matchesMetric = (text: string) =>
    terms.some((term) => containsSearchTerm(text, term));
  const meaning = `${indicator.code} ${indicator.name} ${indicator.definition}`;
  const nominal = /gdp_current|gdp_nominal|ny_gdp_mktp_cd/i.test(
    indicator.code,
  );
  const worldBankRows = nominal ? parseWorldBankGdpEvidence(evidence, document) : [];
  if (worldBankRows.length) return worldBankRows.some((row) =>
    row.value === expected && row.period === period &&
    Boolean(item.entity && row.entity && sameWorldBankEntity(item.entity, row.entity))
  );
  const lines = normalizeEvidenceNumbers(evidence)
    .replace(/−/g, '-')
    .split(/\r?\n/);
  for (let rowIndex = 0; rowIndex < lines.length; rowIndex++) {
    const line = lines[rowIndex];
    for (const token of numberTokens(line)) {
      if (Number(token[0].replace(/[，,]/g, '')) !== expected) continue;
      const cellMatches = [...line.matchAll(/[^\s|]+/g)];
      const cells = cellMatches.map((cell) => cell[0]);
      const cellIndex = cellMatches.findIndex(
        (cell) =>
          (token.index ?? 0) >= cell.index! &&
          (token.index ?? 0) < cell.index! + cell[0].length,
      );
      // Numeric-only table rows require a matching column/row header.
      const isTableRow =
        cells.length > 1 &&
        /^[12]\d{3}$/.test(cells[0]) &&
        !/[年。；]/.test(line);
      const isMetricRow = cells.length > 1 && matchesMetric(cells[0]);
      const header = lines
        .slice(0, rowIndex)
        .reverse()
        .find(
          (row) =>
            !/^(?:单位|unit)\s*[:：]/i.test(row.trim()) &&
            !/^[\s|]*[12]\d{3}(?:\s|\|)/.test(row) &&
            (matchesMetric(row) || /\b[12]\d{3}\b/.test(row)),
        );
      if (
        isTableRow ||
        (isMetricRow && header && /\b[12]\d{3}\b/.test(header))
      ) {
        if (!header || cellIndex < 0) continue;
        const columns = header
          .trim()
          .split(/[\s|\t]+/)
          .filter(Boolean);
        const rowYear = cells[0].match(/^[12]\d{3}$/)?.[0];
        if (rowYear) {
          if (cellIndex === 0 || (period && rowYear !== period)) continue;
          if (!matchesMetric(columns[cellIndex] ?? '')) continue;
        } else {
          if (!isMetricRow || (period && columns[cellIndex] !== period))
            continue;
        }
        // Headers and row labels carry the statistical scope for this cell.
        const scope = `${columns[cellIndex] ?? ''} ${cells[0]}`;
        if (
          nominal &&
          (PER_CAPITA_RE.test(scope) ||
            SHARE_RE.test(scope) ||
            GROWTH_RE.test(scope))
        )
          continue;
        if (GROWTH_RE.test(meaning) && !GROWTH_RE.test(scope)) continue;
        if (PER_CAPITA_RE.test(meaning) && !PER_CAPITA_RE.test(scope)) continue;
        if (SHARE_RE.test(meaning) && !SHARE_RE.test(scope)) continue;
        return true;
      }
      // Commas between digits are thousands separators, not clause boundaries.
      const before = line.slice(0, token.index);
      const start = Math.max(
        ...[...before.matchAll(/[。；;！？]|[，,](?!\d)/g)].map(
          (m) => (m.index ?? 0) + 1,
        ),
        0,
      );
      const after = line.slice((token.index ?? 0) + token[0].length);
      const stop = after.search(/[。；;！？]|[，,](?!\d)/);
      const clause = line.slice(
        start,
        stop < 0 ? line.length : (token.index ?? 0) + token[0].length + stop,
      );
      if (!matchesMetric(clause)) continue;
      // A preceding amount ends the previous metric's binding. A later amount
      // needs its own label unless the sentence explicitly maps values in order.
      const prefix = line.slice(start, token.index);
      const previousAmounts = [
        ...prefix.matchAll(
          /\d+(?:[，,]\d{3})*(?:\.\d+)?\s*(?:亿元|万亿元|美元|元|%|％|trillion|billion|million)/gi,
        ),
      ];
      const previous = previousAmounts.at(-1);
      if (
        previous &&
        !/分别/.test(clause) &&
        !matchesMetric(prefix.slice((previous.index ?? 0) + previous[0].length))
      )
        continue;
      if (nominal && (PER_CAPITA_RE.test(clause) || SHARE_RE.test(clause)))
        continue;
      if (!PER_CAPITA_RE.test(meaning) && PER_CAPITA_RE.test(clause)) continue;
      if (GROWTH_RE.test(meaning) && !GROWTH_RE.test(clause)) continue;
      if (PER_CAPITA_RE.test(meaning) && !PER_CAPITA_RE.test(clause)) continue;
      const years = [
        ...clause.matchAll(/([12]\d{3})\s*年|\b([12]\d{3})\b/g),
      ].map((m) => m[1] ?? m[2]);
      if (period && years.length) {
        if (/分别/.test(clause)) {
          const amounts = numberTokens(clause.split('分别')[1] ?? '');
          const index = amounts.findIndex(
            (m) => Number(m[0].replace(/[，,]/g, '')) === expected,
          );
          if (index < 0 || years[index] !== period) continue;
        } else if (years[0] !== period) continue;
      }
      // Do not accept a year token itself as an observation.
      if (/^\s*年/.test(after)) continue;
      return true;
    }
  }
  return false;
}

function evidenceContainsValue(
  evidence: string,
  value: number | string,
): boolean {
  const expected = Number(String(value).replace(/[，,\s]/g, ''));
  if (!Number.isFinite(expected)) return false;
  return [
    ...normalizeEvidenceNumbers(evidence)
      .replace(/−/g, '-')
      .matchAll(/(?<![\d.+-])[+-]?\d+(?:[，,]\d{3})*(?:\.\d+)?(?![\d.])/g),
  ].some((match) => Number(match[0].replace(/[，,]/g, '')) === expected);
}

function evidenceContainsAmount(
  evidence: string,
  value: number | string,
): boolean {
  const expected = Number(String(value).replace(/[，,\s]/g, ''));
  return [
    ...evidence.matchAll(
      /(?<![\d.+-])[+-]?\d+(?:[，,]\d{3})*(?:\.\d+)?\s*(?:万亿|亿元|亿美元|万亿美元|元|美元|trillion|billion|million|usd|us\$|rmb)(?![\d])/gi,
    ),
  ].some(
    (match) =>
      Number(match[0].match(/^[+-]?[\d，,.]+/)?.[0].replace(/[，,]/g, '')) ===
      expected,
  );
}

/**
 * The model must preserve the unit that appears next to the extracted number.
 * Without this check, a CNY value labelled as USD bypasses later conversion.
 */
export function evidenceUnitForValue(
  evidence: string,
  value: number | string,
): string | null {
  evidence = normalizeEvidenceNumbers(evidence);
  const expected = Number(String(value).replace(/[，,\s]/g, ''));
  if (!Number.isFinite(expected)) return null;
  const worldBankUnits = new Set(parseWorldBankGdpEvidence(evidence).filter((row) => row.value === expected).map((row) => row.unit));
  if (worldBankUnits.size === 1) return [...worldBankUnits][0];
  const amount =
    /(?<![\d.+-])([+-]?\d+(?:[，,]\d{3})*(?:\.\d+)?)\s*(万亿美元|亿美元|十亿美元|百万美元|万美元|千美元|美元|万亿元(?:人民币)?|亿元(?:人民币)?|百万元|万元|千元|元|trillion\s*(?:usd|us\$|\$)?|billion\s*(?:usd|us\$|\$)?|million\s*(?:usd|us\$|\$)?|usd|us\$)(?![\d])/gi;
  for (const match of evidence.matchAll(amount)) {
    if (Number(match[1].replace(/[，,]/g, '')) === expected) return match[2];
  }
  const header = evidence.match(
    /(?:单位|unit)\s*[:：]\s*(万亿美元|亿美元|十亿美元|百万美元|美元|万亿元(?:人民币)?|亿元(?:人民币)?|百万元|万元|元|%|％)/i,
  )?.[1];
  if (
    header &&
    evidence.split(/\r?\n/).some((line) => {
      const numbers = [
        ...line.matchAll(
          /(?<![\d.+-])[+-]?\d+(?:[，,]\d{3})*(?:\.\d+)?(?![\d.])/g,
        ),
      ];
      return numbers
        .slice(1)
        .some((match) => Number(match[0].replace(/[，,]/g, '')) === expected);
    })
  )
    return header;
  return null;
}

/** Fill missing unit from the quoted evidence (table header or adjacent unit text). */
export function enrichExtractedUnitFromEvidence(
  item: ExtractedIndicatorValue,
): ExtractedIndicatorValue {
  if (item.unit?.trim() || item.value == null || !item.evidence?.trim()) {
    return item;
  }
  const inferred = evidenceUnitForValue(item.evidence, item.value);
  return inferred ? { ...item, unit: inferred } : item;
}

/** Keep only observations whose quoted evidence supports the value and catalog meaning. */
export function validateExtractedIndicator(
  item: ExtractedIndicatorValue,
  indicator: IndicatorCatalogForExtraction,
  documentExcerpt: string,
  plan?: ResearchQueryPlan,
): boolean {
  const evidence = item.evidence?.trim();
  const normalizedDocument = compact(documentExcerpt);
  const normalizedEvidence = compact(evidence ?? '');
  const evidencePosition = normalizedDocument.indexOf(normalizedEvidence);
  if (!evidence || item.value == null || evidencePosition < 0) {
    return false;
  }

  if (!evidenceContainsValue(evidence, item.value)) return false;
  if (!hasBoundEvidence(item, indicator, evidence, documentExcerpt)) return false;
  if (plan && !entityMatchesPlan(item.entity, plan)) return false;
  if (plan && !periodMatchesPlan(item.period, plan)) return false;
  const years: string[] =
    normalizeEvidenceNumbers(evidence).match(/\b[12]\d{3}\b/g) ?? [];
  const period = item.period?.match(/[12]\d{3}/)?.[0];
  if (period && years.length && !years.includes(period)) return false;
  const entityGroups = [
    ['中国', '我国', '全国', 'China'],
    ['美国', 'United States', 'USA'],
    ['日本', 'Japan'],
    ['印度', 'India'],
    ['德国', 'Germany'],
    ['法国', 'France'],
    ['英国', 'United Kingdom'],
    ...[
      '北京',
      '天津',
      '上海',
      '重庆',
      '河北',
      '山西',
      '辽宁',
      '吉林',
      '黑龙江',
      '江苏',
      '浙江',
      '安徽',
      '福建',
      '江西',
      '山东',
      '河南',
      '湖北',
      '湖南',
      '广东',
      '海南',
      '四川',
      '贵州',
      '云南',
      '陕西',
      '甘肃',
      '青海',
      '广西',
      '西藏',
      '宁夏',
      '新疆',
      '内蒙古',
    ].map((name) => [name]),
  ];
  const mentioned = entityGroups.filter((group) =>
    group.some((name) => evidence.toLowerCase().includes(name.toLowerCase())),
  );
  const expectedEntity = entityGroups.find((group) =>
    group.some((name) =>
      item.entity?.toLowerCase().includes(name.toLowerCase()),
    ),
  );
  if (expectedEntity && mentioned.length && !mentioned.includes(expectedEntity))
    return false;
  // The quote can start after a target qualifier (including across PDF lines).
  // Include the preceding sentence context so trimming the quote cannot turn a
  // government target into an actual observation.
  const sentenceStart = Math.max(
    ...['。', '；', ';', '！', '？', '!', '?'].map((separator) =>
      normalizedDocument.lastIndexOf(separator, evidencePosition - 1),
    ),
  );
  const evidenceContext = normalizedDocument.slice(
    sentenceStart + 1,
    evidencePosition + normalizedEvidence.length,
  );
  if (
    FORECAST_RE.test(evidenceContext) &&
    !FORECAST_RE.test(`${indicator.name} ${indicator.definition}`)
  ) {
    return false;
  }

  const meaning = `${indicator.code} ${indicator.name} ${indicator.definition}`;
  const isGrowth = GROWTH_RE.test(meaning);
  const isShare = SHARE_RE.test(meaning);
  const isPerCapita = PER_CAPITA_RE.test(meaning);
  const isPercent = /%|％|百分/.test(indicator.unit);
  const evidencePercent = /%|％|百分/.test(evidence);

  if (isGrowth && (!GROWTH_RE.test(evidence) || !evidencePercent)) return false;
  if (isShare && (!SHARE_RE.test(evidence) || !evidencePercent)) return false;
  if (isPerCapita && !PER_CAPITA_RE.test(evidence)) return false;
  if (isPercent && !evidencePercent) return false;
  if (!isPercent && /%|％|百分/.test(item.unit ?? '')) return false;
  if (
    /gdp_current|gdp_nominal|ny_gdp_mktp_cd/i.test(indicator.code) &&
    !evidenceContainsAmount(evidence, item.value) &&
    !evidenceUnitForValue(evidence, item.value)?.match(/元|usd|\$/i)
  )
    return false;
  const evidenceUnit = evidenceUnitForValue(evidence, item.value);
  if (
    item.unit?.trim() &&
    evidenceUnit &&
    normalizeUnit(item.unit) !== normalizeUnit(evidenceUnit)
  ) {
    return false;
  }
  if (
    /gdp_current|gdp_nominal|ny_gdp_mktp_cd/i.test(indicator.code) &&
    item.unit?.trim() &&
    evidenceUnit &&
    normalizeUnit(item.unit) === normalizeUnit(indicator.unit) &&
    normalizeUnit(item.unit) !== normalizeUnit(evidenceUnit)
  ) {
    return false;
  }

  // A real-price level is a different statistical series from nominal GDP.
  // Real GDP amounts must never be stored under a current-price catalog code.
  if (/gdp_current|gdp_nominal|ny_gdp_mktp_cd/i.test(indicator.code)) {
    const paragraphStart = Math.max(
      normalizedDocument.lastIndexOf('。', evidencePosition - 1),
      normalizedDocument.lastIndexOf('；', evidencePosition - 1),
    );
    const context = normalizedDocument.slice(
      paragraphStart + 1,
      evidencePosition + normalizedEvidence.length,
    );
    const realMarker = context.search(REAL_PRICE_RE);
    const currentMarker = Math.max(
      context.lastIndexOf('现价'),
      context.lastIndexOf('名义'),
    );
    if (
      REAL_PRICE_RE.test(evidence) ||
      (realMarker >= 0 && realMarker > currentMarker)
    )
      return false;
  }
  if (/gdp_real_growth/i.test(indicator.code) && /名义增|现价增/.test(evidence))
    return false;
  return true;
}
