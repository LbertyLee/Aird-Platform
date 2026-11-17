export type ExternalSearchDomainStatus = {
  eligible: boolean;
  domain?: string;
  reason?: string;
};

/** Model-proposed sites must be public DNS names, without credentials or ports. */
export function publicResearchWebsite(value: string): string | undefined {
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port
      || host.length > 253 || !/^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(host)
      || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host)) return undefined;
    return `${url.protocol}//${host}`;
  } catch {
    return undefined;
  }
}

/**
 * Converts a configured website into the hostname accepted by Exa's
 * includeDomains filter.  Exa rejects intranet hosts such as `localhost`,
 * so they must never be allowed to invalidate a whole search batch.
 */
export function externalSearchDomain(
  websiteUrl?: string | null,
): ExternalSearchDomainStatus {
  if (!websiteUrl?.trim()) {
    return { eligible: false, reason: '未配置网站链接' };
  }

  try {
    const value = websiteUrl.trim();
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return { eligible: false, reason: '仅支持 HTTP/HTTPS 网站链接' };
    }

    const domain = url.hostname.replace(/^www\./i, '');
    if (!domain.includes('.')) {
      return { eligible: false, reason: '域名缺少顶级域名' };
    }
    return { eligible: true, domain };
  } catch {
    return { eligible: false, reason: '网站链接格式无效' };
  }
}

function parseExternalWebsite(value: string): URL | null {
  try {
    const trimmed = value.trim();
    return new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
    );
  } catch {
    return null;
  }
}

export function externalWebsiteApex(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./i, '');
}

/**
 * Make external result URLs openable / fetchable.
 * - Bare apex hosts like `stats.gov.cn` often only resolve as `www.stats.gov.cn`.
 * - Some municipal `*.*.gov.cn` sites (e.g. szzklm.sz.gov.cn) hang on HTTPS
 *   while HTTP works — downgrade those to http.
 */
export function browsableExternalUrl(value: string): string {
  const parsed = parseExternalWebsite(value);
  if (!parsed) return value;
  let host = parsed.hostname.toLowerCase();

  // apex*.gov.cn (e.g. stats.gov.cn) commonly only resolve with www.
  if (
    !host.startsWith('www.') &&
    /(^|\.)gov\.cn$/i.test(host) &&
    host.split('.').length <= 3
  ) {
    parsed.hostname = `www.${host}`;
    host = parsed.hostname.toLowerCase();
  }

  // Multi-label municipal gov.cn hosts often have broken/unreachable HTTPS.
  if (shouldPreferHttpForGovCn(host) && parsed.protocol === 'https:') {
    parsed.protocol = 'http:';
  }
  return parsed.toString();
}

/** e.g. szzklm.sz.gov.cn — not www.stats.gov.cn / stats.gov.cn. */
export function shouldPreferHttpForGovCn(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!/(^|\.)gov\.cn$/i.test(host)) return false;
  const labels = host.split('.').filter(Boolean);
  // www.stats.gov.cn stays on HTTPS; municipal subdomains use HTTP.
  if (labels.length === 4 && labels[0] === 'www') return false;
  return labels.length >= 4;
}

/** Try https then http (or reverse when municipal http is preferred). */
export function externalUrlFetchCandidates(value: string): string[] {
  const primary = browsableExternalUrl(value);
  const parsed = parseExternalWebsite(primary);
  if (!parsed) return [value, primary].filter(Boolean);
  const alternate = new URL(parsed.toString());
  alternate.protocol = parsed.protocol === 'https:' ? 'http:' : 'https:';
  return [...new Set([primary, alternate.toString(), value].filter(Boolean))];
}

/** URL variants used when looking up an already-persisted ResearchSource. */
export function externalUrlLookupVariants(value: string): string[] {
  const browsable = browsableExternalUrl(value);
  const parsed = parseExternalWebsite(browsable);
  if (!parsed) return [...new Set([value, browsable].filter(Boolean))];
  const withWww = parsed.toString();
  const without = new URL(parsed.toString());
  without.hostname = externalWebsiteApex(parsed.hostname);
  return [...new Set([value, withWww, without.toString()].filter(Boolean))];
}

/**
 * Build apex → preferred hostname from configured source website URLs.
 * Prefer hosts that keep `www.` when that is how the official site is published
 * (e.g. www.stats.gov.cn resolves, bare stats.gov.cn often does not).
 */
export function preferredHostsByApex(
  sources: Array<{ websiteUrl?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) {
    const parsed = source.websiteUrl
      ? parseExternalWebsite(source.websiteUrl)
      : null;
    if (!parsed) continue;
    const apex = externalWebsiteApex(parsed.hostname);
    const current = map.get(apex);
    if (!current || /^www\./i.test(parsed.hostname)) {
      map.set(apex, parsed.hostname);
    }
  }
  return map;
}

/**
 * Rewrite an Exa hit URL onto the configured official hostname when they share
 * the same apex domain. Dedup keys may strip www; browsable links must not.
 */
export function alignExternalResultUrl(
  resultUrl: string,
  preferredHosts: Map<string, string> = new Map(),
): string {
  const parsed = parseExternalWebsite(resultUrl);
  if (!parsed) return browsableExternalUrl(resultUrl);
  const apex = externalWebsiteApex(parsed.hostname);
  const preferred = preferredHosts.get(apex);
  if (preferred && preferred.toLowerCase() !== parsed.hostname.toLowerCase()) {
    parsed.hostname = preferred;
  }
  return browsableExternalUrl(parsed.toString());
}
