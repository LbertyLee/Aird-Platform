import { WPP_METRICS } from '../../research/population-metrics';
import {
  explicitYearRangePeriods,
  parseRecentYearCount,
  recentCompletedCalendarYears,
} from '../../common/utils/recent-years';
import { inferQueryRegions } from '../../common/utils/query-regions';
import { inferQueryCountries } from '../../common/utils/query-countries';

export type RankableIndicator = {
  id: string;
  code: string;
  name: string;
  unit: string;
  definition: string;
  aliases: string[];
};

export type RankedIndicator<T extends RankableIndicator = RankableIndicator> =
  T & { score: number };

const GROWTH_RE =
  /增速|增长率|同比|环比|增长幅度|actual\s*growth|real\s*growth|_growth\b/i;
const LEVEL_RE =
  /总量|绝对值|现价|规模|水平|万亿|亿元|current_usd|gdp_current|国内生产总值|生产总值/i;
const GDP_RE = /\bgdp\b|国内生产总值|生产总值/i;
const EXPLICIT_LEVEL_RE = /总量|绝对值|现价|名义|规模|水平|金额|数值|数据/;
const GDP_LEVEL_CODE_RE =
  /^(gdp_current_usd|ny_gdp_mktp_cd|gdp_nominal|gdp_current)/i;
const PER_CAPITA_RE = /人均|per\s*capita|gdp_per_capita/i;

/** Normalize query / catalog text for cheap lexical scoring. */
export function normalizeIndicatorQueryText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ｇｄｐ/g, 'gdp')
    .replace(/\bgpd\b/g, 'gdp')
    .replace(/人均gpd/g, '人均gdp')
    .replace(/\s+/g, ' ')
    .trim();
}

function indicatorHaystack(indicator: RankableIndicator): string {
  return normalizeIndicatorQueryText(
    [
      indicator.code,
      indicator.name,
      indicator.definition,
      ...indicator.aliases,
    ].join(' '),
  );
}

/**
 * Score catalog indicators against a research question.
 * "GDP数据" should prefer level series (e.g. gdp_current_usd) over growth %.
 */
export function rankIndicatorsForQuery<T extends RankableIndicator>(
  query: string,
  indicators: T[],
): RankedIndicator<T>[] {
  const q = normalizeIndicatorQueryText(query);
  if (!q || !indicators.length) {
    return indicators.map((indicator) => ({ ...indicator, score: 0 }));
  }

  const wantsGrowth = GROWTH_RE.test(q);
  const mentionsGdp = GDP_RE.test(q);
  const wantsPerCapita = PER_CAPITA_RE.test(q);
  const wantsLevel =
    mentionsGdp &&
    !wantsPerCapita &&
    (EXPLICIT_LEVEL_RE.test(q) || !wantsGrowth);

  return indicators
    .map((indicator) => {
      const haystack = indicatorHaystack(indicator);
      let score = 0;
      const populationMetric = WPP_METRICS.find((metric) => metric.code === indicator.code);
      if (populationMetric?.pattern.test(q)) score += 12;
      const family = indicator.code.match(/^(cpi|ppi|pmi)(?:_|$)/i)?.[1];
      const explicitFamily = Boolean(
        family && q.includes(family.toLowerCase()),
      );
      if (explicitFamily) score += 12;

      const terms = [indicator.code, indicator.name, ...indicator.aliases].map(
        normalizeIndicatorQueryText,
      );

      for (const term of terms) {
        if (!term || term.length < 2) continue;
        // Avoid matching tiny fragments like bare "数据" against long names.
        if (term.length < 3 && !/^gdp$/i.test(term)) continue;
        if (q.includes(term)) score += term.length >= 4 ? 4 : 2;
      }

      if (mentionsGdp && /\bgdp\b|国内生产总值|生产总值/.test(haystack)) {
        score += 3;
      }
      if (
        mentionsGdp &&
        !explicitFamily &&
        !/\bgdp\b|国内生产总值|生产总值/.test(haystack)
      ) {
        score -= 8;
      }

      const isGrowth = GROWTH_RE.test(haystack);
      const isGdpLevel =
        GDP_LEVEL_CODE_RE.test(indicator.code) ||
        (/国内生产总值|生产总值/.test(haystack) &&
          !isGrowth &&
          !/人均|出口|进口|占比|贡献/.test(haystack));
      const isLevel = LEVEL_RE.test(haystack) || isGdpLevel;
      if (wantsPerCapita && PER_CAPITA_RE.test(haystack)) score += 12;
      if (wantsPerCapita && isGdpLevel) score -= 8;

      if (wantsLevel && !wantsGrowth && isGrowth) score -= 8;
      if (wantsLevel && isGdpLevel) score += 10;
      else if (wantsLevel && isLevel) score += 2;
      if (wantsGrowth && isGrowth) score += 8;
      if (wantsGrowth && !wantsLevel && isGdpLevel) score -= 8;

      // Bare "GDP" should not prefer per-capita / trade / population unless asked.
      if (
        mentionsGdp &&
        !/人均|per\s*capita|gdp_per_capita/.test(q) &&
        /人均|per\s*capita|gdp_per_capita/.test(haystack)
      ) {
        score -= 6;
      }
      if (
        mentionsGdp &&
        !/出口|进口|贸易|人口/.test(q) &&
        /出口|进口|贸易|人口|population|goods_export|goods_import/.test(
          haystack,
        )
      ) {
        score -= 8;
      }
      if (
        mentionsGdp &&
        !/经常账户|cab/.test(q) &&
        /cab_gdp|经常账户/.test(haystack)
      ) {
        score -= 8;
      }

      return { ...indicator, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.name.localeCompare(right.name, 'zh-CN'),
    );
}

/**
 * Choose the catalog slice sent to LLM extraction.
 * When the query clearly matches indicators, only strong matches are used.
 */
export function selectIndicatorsForExtraction<T extends RankableIndicator>(
  query: string,
  indicators: T[],
  options?: { limit?: number; minScore?: number; indicatorHints?: string[] },
): {
  ranked: RankedIndicator<T>[];
  selected: RankedIndicator<T>[];
  preferredCodes: string[];
  narrowed: boolean;
} {
  const limit = options?.limit ?? 6;
  const minScore = options?.minScore ?? 1;
  const ranked = rankIndicatorsForQuery(query, indicators);
  const positive = ranked.filter((item) => item.score >= minScore);
  // Semantic metric names are independent suggestions, not a combined query.
  // Concatenating “GDP总量、GDP实际增速、人均GDP” incorrectly makes growth win.
  if (!positive.length && options?.indicatorHints?.length) {
    const hinted = options.indicatorHints.flatMap((hint) => {
      const result = selectIndicatorsForExtraction(hint, indicators, {
        limit,
        minScore,
      });
      return result.narrowed ? result.selected : [];
    });
    const selected = [
      ...new Map(hinted.map((item) => [item.id, item])).values(),
    ].slice(0, limit);
    if (selected.length) {
      return {
        ranked,
        selected,
        preferredCodes: selected.map((item) => item.code),
        narrowed: true,
      };
    }
  }
  if (
    !positive.length &&
    /经济.*(?:报告|预测|分析)|economic.*(?:report|outlook)/i.test(query)
  ) {
    const selected = ranked
      .filter(
        (item) =>
          GDP_LEVEL_CODE_RE.test(item.code) ||
          /^gdp_real_growth$/i.test(item.code),
      )
      .slice(0, limit);
    if (selected.length) {
      return {
        ranked,
        selected,
        preferredCodes: selected.map((item) => item.code),
        narrowed: true,
      };
    }
  }
  const narrowed = positive.length > 0;
  // Keep only scores close to the best hit so "GDP数据" does not drag in trade/population.
  const topScore = positive[0]?.score ?? 0;
  const strong = positive.filter(
    (item) => item.score >= Math.max(minScore, topScore - 3),
  );
  const q = normalizeIndicatorQueryText(query);
  const mentionsGdp = GDP_RE.test(q);
  const wantsGrowth = GROWTH_RE.test(q);
  const wantsBothGdpSeries =
    GDP_RE.test(q) && GROWTH_RE.test(q) && EXPLICIT_LEVEL_RE.test(q);
  const candidates = wantsBothGdpSeries
    ? ranked.filter(
        (item) =>
          strong.includes(item) ||
          (/gdp_current|gdp_nominal|ny_gdp_mktp_cd|gdp_real_growth/i.test(
            item.code,
          ) &&
            item.score >= minScore),
      )
    : strong;
  // Score each explicitly joined request on its own so a high-scoring GDP
  // series cannot crowd out a separately requested CPI/population series.
  const clauses = query
    .split(/和|以及|及|与|、|[，,;；]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (clauses.length > 1) {
    for (const clause of clauses) {
      const local = rankIndicatorsForQuery(clause, indicators);
      const best = local[0];
      if (best && best.score >= minScore) {
        for (const item of local.filter(
          (item) => item.score >= Math.max(minScore, best.score - 3),
        )) {
          if (!candidates.some((candidate) => candidate.id === item.id))
            candidates.push(item);
        }
      }
    }
  }
  // Explicit population metrics remain independent requests even when aliases change scores.
  // In particular, splitting on 和 also splits 总和生育率; never let that drop TFR.
  for (const metric of WPP_METRICS.filter((metric) => metric.pattern.test(query))) {
    const candidate = ranked.find((item) => item.code === metric.code);
    if (candidate && !candidates.some((item) => item.id === candidate.id)) candidates.push(candidate);
  }
  // For a single metric request, do not send multiple nearby series from the
  // same family to the extractor. This is the main source of GDP level/growth
  // and per-capita mix-ups. Explicitly requested IDs remain appended by the
  // caller.
  const singleFamily =
    mentionsGdp &&
    !wantsGrowth &&
    !wantsBothGdpSeries &&
    !PER_CAPITA_RE.test(q);
  const familyCandidates = singleFamily
    ? candidates.filter((item) => {
        const haystack = indicatorHaystack(item);
        const isGdpSeries = /\bgdp\b|国内生产总值|生产总值/i.test(haystack);
        if (!isGdpSeries) return true;
        return !/增长率|增速|同比|人均|per\s*capita|占比|指数/.test(haystack);
      })
    : candidates;
  const selected = (
    narrowed
      ? familyCandidates.length
        ? familyCandidates
        : candidates
      : ranked
  ).slice(
    0,
    narrowed
      ? Math.min(limit, Math.max(1, candidates.length))
      : indicators.length,
  );
  return {
    ranked,
    selected,
    preferredCodes: selected.map((item) => item.code),
    narrowed,
  };
}

/**
 * Infer entity / period constraints from the research question so extraction
 * fills dimensions even when the page text is sparse.
 */
export function inferQueryDimensionHints(query: string): {
  entities: string[];
  periods: string[];
  promptBlock: string;
} {
  const text = query.trim();
  const entities: string[] = [...inferQueryRegions(text)];
  entities.push(...inferQueryCountries(text));
  if (/中国|全国|内地/.test(text)) entities.push('中国');
  if (/美国|美利坚/.test(text)) entities.push('美国');
  if (/日本/.test(text)) entities.push('日本');
  if (/印度(?!尼西亚)/.test(text)) entities.push('印度');
  for (const entity of [
    '德国',
    '法国',
    '英国',
    '加拿大',
    '澳大利亚',
    '韩国',
    '巴西',
    '俄罗斯',
    '墨西哥',
    '印度尼西亚',
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
    '台湾',
    '内蒙古',
    '广西',
    '西藏',
    '宁夏',
    '新疆',
    '香港',
    '澳门',
  ]) {
    if (text.includes(entity)) entities.push(entity);
  }

  const periods: string[] = [];
  const recentCount = parseRecentYearCount(text);
  if (recentCount != null) {
    periods.push(...recentCompletedCalendarYears(recentCount));
  } else {
    const range = explicitYearRangePeriods(text);
    if (range) periods.push(...range);
    else periods.push(...new Set(text.match(/(?<!\d)[12]\d{3}(?!\d)/g) ?? []));
  }

  const uniqueEntities = [...new Set(entities)];
  const lines = [
    uniqueEntities.length
      ? `期望实体/国家：${uniqueEntities.join('、')}（原文未写明时可用问题中的主体）`
      : '',
    periods.length
      ? `期望年份：${periods.join('、')}（按问题时间范围逐条抽取；原文没有的年份不要编造）`
      : '',
    '每条观测必须尽量填写 period（四位年份）与 entity；与问题主体/年份明显无关的数值不要抽取。',
  ].filter(Boolean);

  return {
    entities: uniqueEntities,
    periods,
    promptBlock: lines.join('\n'),
  };
}
