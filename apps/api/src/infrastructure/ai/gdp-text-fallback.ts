import type { ResearchQueryPlan } from '../../modules/search/research-query-plan';
import type {
  ExtractedIndicatorValue,
  IndicatorCatalogForExtraction,
} from './deepseek-chat.service';
import { validateExtractedIndicator } from './indicator-extraction-validation';
import { normalizeWorldBankEntity, parseWorldBankGdpEvidence } from './world-bank-gdp-evidence';

const NOMINAL_GDP_CODE_RE =
  /^(?:gdp_current_usd|gdp_current|gdp_nominal|ny_gdp_mktp_cd)$/i;
const EXCLUDED_CONTEXT_RE =
  /不变价|可比价|固定(?:基期)?价格|人均|预测|预计|预估|有望达到|forecast|projected|per\s*capita/i;
const GDP_AMOUNT_RE =
  /(?<period>[12]\d{3})\s*年[^。！？；;\n]{0,50}?(?:(?:国内|地区)生产总值\s*(?:[（(]\s*GDP\s*[）)])?|GDP)\s*(?:为|达(?:到)?|实现|总量(?:为|达(?:到)?)?)?\s*(?<value>\d[\d，,]*(?:\.\d+)?)\s*(?<unit>万亿美元|亿美元|十亿美元|百万美元|万美元|美元|万亿元(?:人民币)?|亿元(?:人民币)?)/gi;

/**
 * Deterministic fallback for explicit nominal-GDP sentences.
 * Every candidate still passes the same evidence and statistical-scope
 * validation as model output before it can become an observation.
 */
export function extractNominalGdpFallback(
  document: string,
  indicators: IndicatorCatalogForExtraction[],
  plan?: ResearchQueryPlan,
): ExtractedIndicatorValue[] {
  const nominalIndicators = indicators.filter((indicator) =>
    NOMINAL_GDP_CODE_RE.test(indicator.code),
  );
  if (!document.trim() || nominalIndicators.length === 0) return [];

  const items: ExtractedIndicatorValue[] = [];
  const seen = new Set<string>();
  for (const row of parseWorldBankGdpEvidence(document)) {
    if (!row.entity) continue;
    for (const indicator of nominalIndicators) {
      const candidate: ExtractedIndicatorValue = {
        indicatorCode: indicator.code,
        value: row.value,
        unit: row.unit,
        period: row.period,
        entity: normalizeWorldBankEntity(row.entity),
        evidence: row.evidence,
      };
      if (!validateExtractedIndicator(candidate, indicator, document, plan)) continue;
      const key = [candidate.indicatorCode, candidate.period, candidate.entity, candidate.value, candidate.unit].join('\u0001');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(candidate);
    }
  }
  for (const match of document.matchAll(GDP_AMOUNT_RE)) {
    const groups = match.groups;
    if (!groups?.period || !groups.value || !groups.unit) continue;
    const evidence = sentenceAt(document, match.index ?? 0, match[0].length);
    const matchOffset = evidence.indexOf(match[0]);
    const decisiveContext = evidence.slice(
      0,
      Math.max(0, matchOffset) + match[0].length,
    );
    if (EXCLUDED_CONTEXT_RE.test(decisiveContext)) continue;

    const numericValue = Number(groups.value.replace(/[，,]/g, ''));
    if (!Number.isFinite(numericValue)) continue;
    const entity = inferEntity(evidence, plan);

    for (const indicator of nominalIndicators) {
      const candidate: ExtractedIndicatorValue = {
        indicatorCode: indicator.code,
        value: numericValue,
        unit: groups.unit,
        period: groups.period,
        ...(entity ? { entity } : {}),
        evidence: match[0].trim(),
      };
      if (!validateExtractedIndicator(candidate, indicator, document, plan)) {
        continue;
      }
      const key = [
        candidate.indicatorCode,
        candidate.period,
        candidate.entity ?? '',
        candidate.value,
        candidate.unit,
      ].join('\u0001');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(candidate);
    }
  }
  return items;
}

function sentenceAt(document: string, start: number, length: number): string {
  const leftBoundary = Math.max(
    document.lastIndexOf('。', start - 1),
    document.lastIndexOf('！', start - 1),
    document.lastIndexOf('？', start - 1),
    document.lastIndexOf('\n', start - 1),
  );
  const candidates = ['。', '！', '？', '\n']
    .map((separator) => document.indexOf(separator, start + length))
    .filter((index) => index >= 0);
  const rightBoundary = candidates.length
    ? Math.min(...candidates)
    : document.length;
  return document.slice(leftBoundary + 1, rightBoundary + 1).trim();
}

function inferEntity(
  evidence: string,
  plan?: ResearchQueryPlan,
): string | undefined {
  if (/中国|我国|全国|China/i.test(evidence)) return '中国';
  if (/美国|United States|USA/i.test(evidence)) return '美国';
  if (plan?.entities.length === 1) return plan.entities[0];
  return undefined;
}
