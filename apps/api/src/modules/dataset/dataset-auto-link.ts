export type AutoLinkIndicatorCandidate = {
  id: string;
  name: string;
  code: string;
};

export type AutoLinkDictionaryCandidate = {
  id: string;
  name: string;
  code: string;
  aliases?: string[];
};

export type AutoLinkMatch = {
  id: string;
  term: string;
};

const MAX_AUTO_INDICATORS = 40;
const MAX_AUTO_DICTIONARIES = 60;

/**
 * 转义正则特殊字符。
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 判断词条是否在正文中出现（短英文走词边界，中文/长串走包含）。
 */
export function textContainsTerm(haystack: string, term: string): boolean {
  const raw = term.trim();
  if (raw.length < 2) return false;

  const lowerHay = haystack.toLowerCase();
  const lowerTerm = raw.toLowerCase();
  const hasCjk = /[\u4e00-\u9fff]/.test(raw);

  if (!hasCjk && raw.length <= 3) {
    const pattern = new RegExp(
      `(^|[^a-z0-9_])${escapeRegExp(lowerTerm)}([^a-z0-9_]|$)`,
      'i',
    );
    return pattern.test(haystack);
  }

  if (hasCjk) {
    return haystack.includes(raw);
  }
  return lowerHay.includes(lowerTerm);
}

function collectTerms(
  ...parts: Array<string | null | undefined>
): string[] {
  return [
    ...new Set(
      parts
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part && part.length >= 2)),
    ),
  ].sort((a, b) => b.length - a.length);
}

/**
 * 从正文识别应自动关联的指标。
 */
export function matchIndicatorsInText(
  text: string,
  candidates: AutoLinkIndicatorCandidate[],
  limit = MAX_AUTO_INDICATORS,
): AutoLinkMatch[] {
  if (!text.trim() || !candidates.length) return [];
  const ordered = [...candidates].sort(
    (a, b) => Math.max(b.name.length, b.code.length) - Math.max(a.name.length, a.code.length),
  );
  const hits: AutoLinkMatch[] = [];
  for (const item of ordered) {
    const terms = collectTerms(item.name, item.code);
    const term = terms.find((candidate) => textContainsTerm(text, candidate));
    if (term) hits.push({ id: item.id, term });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * 从正文识别应自动关联的字典项。
 */
export function matchDictionariesInText(
  text: string,
  candidates: AutoLinkDictionaryCandidate[],
  limit = MAX_AUTO_DICTIONARIES,
): AutoLinkMatch[] {
  if (!text.trim() || !candidates.length) return [];
  const ordered = [...candidates].sort((a, b) => {
    const aLen = Math.max(
      a.name.length,
      a.code.length,
      ...(a.aliases ?? []).map((alias) => alias.length),
    );
    const bLen = Math.max(
      b.name.length,
      b.code.length,
      ...(b.aliases ?? []).map((alias) => alias.length),
    );
    return bLen - aLen;
  });
  const hits: AutoLinkMatch[] = [];
  for (const item of ordered) {
    const terms = collectTerms(item.name, item.code, ...(item.aliases ?? []));
    const term = terms.find((candidate) => textContainsTerm(text, candidate));
    if (term) hits.push({ id: item.id, term });
    if (hits.length >= limit) break;
  }
  return hits;
}
