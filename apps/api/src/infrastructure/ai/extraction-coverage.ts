import type {
  ExtractedIndicatorValue,
  IndicatorCatalogForExtraction,
} from './deepseek-chat.service';
import type { ResearchQueryPlan } from '../../modules/search/research-query-plan';
import { containsSearchTerm } from '../../research/research-filtering';

/** Retry only targets actually mentioned in this passage, never invent missing data. */
export function missingExtractionTargets(
  content: string,
  items: ExtractedIndicatorValue[],
  indicators: IndicatorCatalogForExtraction[],
  plan?: ResearchQueryPlan,
): string[] {
  if (!/\d/.test(content)) return [];
  const periods = plan?.periods.length
    ? plan.periods.filter((period) => containsSearchTerm(content, period))
    : [''];
  return indicators.flatMap((indicator) => {
    const family = indicator.code.match(/^(gdp|cpi|ppi|pmi)(?:_|$)/i)?.[1];
    if (
      ![
        indicator.name,
        ...(indicator.aliases ?? []),
        ...(family ? [family] : []),
      ].some((term) => containsSearchTerm(content, term))
    )
      return [];
    return periods
      .filter(
        (period) =>
          !items.some(
            (item) =>
              item.indicatorCode === indicator.code &&
              (!period || item.period?.match(/[12]\d{3}/)?.[0] === period),
          ),
      )
      .map((period) => `${indicator.code}${period ? ` × ${period}` : ''}`);
  });
}
