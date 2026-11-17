import type { ResearchSourcePlan } from '../semantic/semantic.types';
import { metricTranslationKey } from './research-metric-aliases';

type ResearchTermKind = 'entity' | 'metric';

/** Match metric wording variants without dropping scope from entity names. */
function translationKey(term: string, kind: ResearchTermKind): string {
  const normalized = term.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (kind !== 'metric') return normalized;
  return metricTranslationKey(normalized);
}

/** Expand translations anchored to equivalent requested terms, not every model term. */
export function bilingualResearchTerms(
  terms: string[],
  plan?: ResearchSourcePlan,
  kind: ResearchTermKind = 'entity',
): string[] {
  const normalized = new Set(terms.map((term) => translationKey(term, kind)).filter(Boolean));
  const expanded = [...terms, ...(plan?.translations ?? []).flatMap((pair) =>
    normalized.has(translationKey(pair.zh, kind)) || normalized.has(translationKey(pair.en, kind))
      ? [pair.zh, pair.en] : []),
  ];
  return [...new Set(expanded)];
}
