/**
 * Make Exa result URLs openable in the browser.
 * - Bare apex hosts like `stats.gov.cn` often only resolve as `www.stats.gov.cn`.
 * - Some municipal `*.*.gov.cn` sites (e.g. szzklm.sz.gov.cn) hang on HTTPS
 *   while HTTP works.
 */
export function browsableExternalUrl(value: string): string {
  try {
    const url = new URL(value);
    let host = url.hostname.toLowerCase();

    if (
      !host.startsWith('www.') &&
      /(^|\.)gov\.cn$/i.test(host) &&
      host.split('.').length <= 3
    ) {
      url.hostname = `www.${host}`;
      host = url.hostname.toLowerCase();
    }

    if (shouldPreferHttpForGovCn(host) && url.protocol === 'https:') {
      url.protocol = 'http:';
    }
    return url.toString();
  } catch {
    return value;
  }
}

/** e.g. szzklm.sz.gov.cn — not www.stats.gov.cn. */
export function shouldPreferHttpForGovCn(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (!/(^|\.)gov\.cn$/i.test(host)) return false;
  const labels = host.split('.').filter(Boolean);
  if (labels.length === 4 && labels[0] === 'www') return false;
  return labels.length >= 4;
}
