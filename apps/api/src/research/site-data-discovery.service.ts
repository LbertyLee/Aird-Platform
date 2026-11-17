import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentParserService } from './document-parser.service';
import type { CreateSourceInput, SourceEntity } from './research.types';

type CrawlLink = { url: string; label: string; depth: number };

/**
 * Finds structured downloads hidden behind a site's catalogue pages. Search
 * providers remain responsible for source discovery; this service only follows
 * same-site, high-signal links and returns parsed datasets.
 */
@Injectable()
export class SiteDataDiscoveryService {
  private readonly logger = new Logger(SiteDataDiscoveryService.name);
  private readonly cache = new Map<string, { expiresAt: number; inputs: CreateSourceInput[] }>();
  private readonly maxPages: number;
  private readonly maxDepth: number;
  private readonly timeoutMs: number;
  private readonly rootBudgetMs: number;
  private readonly maxBytes: number;

  constructor(
    private readonly parser: DocumentParserService,
    config: ConfigService,
  ) {
    this.maxPages = Math.max(1, config.get<number>('SITE_DISCOVERY_MAX_PAGES') ?? 8);
    this.maxDepth = Math.max(0, config.get<number>('SITE_DISCOVERY_MAX_DEPTH') ?? 2);
    this.timeoutMs = Math.max(1_000, config.get<number>('SITE_DISCOVERY_TIMEOUT_MS') ?? 7_000);
    this.rootBudgetMs = Math.max(5_000, config.get<number>('SITE_DISCOVERY_ROOT_BUDGET_MS') ?? 20_000);
    this.maxBytes = Math.max(256_000, config.get<number>('SITE_DISCOVERY_MAX_BYTES') ?? 8_000_000);
  }

  async discover(sources: SourceEntity[], query: string): Promise<CreateSourceInput[]> {
    if (!needsStructuredDiscovery(query)) return [];
    const roots = [...new Map(
      sources
        .map((source) => source.sourceUrl)
        .filter((url): url is string => Boolean(url))
        .map((url) => [this.originKey(url), url]),
    ).values()];
    const results = (await Promise.all(roots.slice(0, 4).map(async (root) => {
      const cacheKey = `${root}|${query.trim().toLowerCase()}`;
      const cached = this.cache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) return cached.inputs;
      const inputs = await this.discoverRoot(root, query);
      this.cache.set(cacheKey, { expiresAt: Date.now() + 60 * 60_000, inputs });
      return inputs;
    }))).flat();
    return [...new Map(results.map((input) => [input.sourceUrl ?? input.title, input])).values()];
  }

  private async discoverRoot(root: string, query: string): Promise<CreateSourceInput[]> {
    const rootUrl = this.safeUrl(root);
    if (!rootUrl) return [];
    const deadline = Date.now() + this.rootBudgetMs;
    const hostname = rootUrl.hostname.toLowerCase();
    const queue: CrawlLink[] = [{ url: rootUrl.toString(), label: 'search result', depth: 0 }];
    const visited = new Set<string>();
    const candidates = new Map<string, CrawlLink>();
    let pages = 0;
    while (queue.length && pages < this.maxPages) {
      const current = queue.shift()!;
      const normalized = this.normalizeUrl(current.url);
      if (visited.has(normalized)) continue;
      visited.add(normalized);
      if (!this.sameHost(normalized, hostname)) continue;
      const response = await this.fetchBytes(normalized, 'text/html,application/xhtml+xml', deadline);
      pages += 1;
      if (!response) continue;
      const contentType = response.headers.get('content-type') ?? '';
      if (!isHtml(contentType) || isStructuredUrl(normalized)) {
        if (isStructuredUrl(normalized)) candidates.set(normalized, current);
        continue;
      }
      const html = response.buffer.toString('utf8');
      for (const link of extractLinks(html, normalized)) {
        if (!this.sameHost(link.url, hostname)) continue;
        const item = { ...link, depth: current.depth + 1 };
        if (isStructuredUrl(link.url)) {
          candidates.set(link.url, item);
          continue;
        }
        if (item.depth <= this.maxDepth && isNavigationLink(item.label, link.url)) queue.push(item);
      }
    }
    const ordered = [...candidates.values()].sort((a, b) => linkScore(b) - linkScore(a)).slice(0, 6);
    const inputs = (await Promise.all(
      ordered.map((candidate) => this.download(candidate.url, query, root, deadline)),
    )).filter((input): input is CreateSourceInput => Boolean(input));
    return inputs;
  }

  private async download(url: string, query: string, discoveredFrom: string, deadline: number): Promise<CreateSourceInput | undefined> {
    const response = await this.fetchBytes(url, 'application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel', deadline);
    if (!response) return undefined;
    try {
      const parsed = await this.parser.parseBuffer(
        fileNameFromUrl(url),
        response.headers.get('content-type') ?? mimeFromUrl(url),
        response.buffer,
        { query },
      );
      if (parsed.storageType !== 'structured' || !parsed.structuredData) return undefined;
      return {
        title: fileNameFromUrl(url),
        origin: 'exa',
        storageType: 'structured',
        sourceUrl: url,
        mimeType: response.headers.get('content-type') ?? mimeFromUrl(url),
        textContent: parsed.textContent,
        searchText: `${fileNameFromUrl(url)}\n${parsed.textContent}`,
        structuredData: parsed.structuredData,
        metadata: {
          ...parsed.metadata,
          provider: 'site-navigation',
          discoveryQuery: query,
          discoveredFrom,
          contentMode: 'structured',
        },
        recordCount: parsed.recordCount,
      };
    } catch (error) {
      this.logger.debug(`structured site download skipped for ${url}: ${this.errorMessage(error)}`);
      return undefined;
    }
  }

  private async fetchBytes(url: string, accept: string, deadline: number): Promise<{ buffer: Buffer; headers: Headers } | undefined> {
    try {
      let currentUrl = url;
      let response: Response | undefined;
      for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) return undefined;
        const safe = this.safeUrl(currentUrl);
        if (!safe) return undefined;
        const next = await fetch(currentUrl, {
        headers: { Accept: accept },
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, remainingMs)),
        redirect: 'manual',
        });
        if (next.status < 300 || next.status >= 400) {
          response = next;
          break;
        }
        const location = next.headers.get('location');
        if (!location || redirectCount === 3) return undefined;
        const redirected = new URL(location, currentUrl);
        if (redirected.hostname.toLowerCase() !== safe.hostname.toLowerCase()) return undefined;
        currentUrl = redirected.toString();
      }
      if (!response) return undefined;
      if (!response.ok) return undefined;
      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > this.maxBytes) return undefined;
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > this.maxBytes) return undefined;
      return { buffer, headers: response.headers };
    } catch {
      return undefined;
    }
  }

  private safeUrl(value: string): URL | undefined {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
      const host = url.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        /^(127\.|10\.|192\.168\.|169\.254\.)/.test(host) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host === '::1' ||
        host.startsWith('fc') ||
        host.startsWith('fd')
      ) return undefined;
      return url;
    } catch {
      return undefined;
    }
  }

  private sameHost(value: string, hostname: string) {
    const url = this.safeUrl(value);
    return Boolean(url && url.hostname.toLowerCase() === hostname);
  }

  private originKey(value: string) {
    const url = this.safeUrl(value);
    return url ? `${url.protocol}//${url.hostname}` : value;
  }

  private normalizeUrl(value: string) {
    try {
      const url = new URL(value);
      url.hash = '';
      return url.toString();
    } catch {
      return value;
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function needsStructuredDiscovery(query: string): boolean {
  const text = query.trim();
  const years = text.match(/(?:19|20|21)\d{2}/g) ?? [];
  const metrics = text.match(/人口|生育率|出生|迁移|移民|数据|逐年|每年|population|fertility|birth|migration|dataset|annual|yearly/gi) ?? [];
  return years.length >= 2 && metrics.length >= 2 || /下载|数据集|database|csv|excel|xlsx|api/i.test(text);
}

function extractLinks(html: string, baseUrl: string): Array<{ url: string; label: string }> {
  const links: Array<{ url: string; label: string }> = [];
  const pattern = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a\s*>/gi;
  for (const match of html.matchAll(pattern)) {
    try {
      const url = new URL(match[1], baseUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      url.hash = '';
      links.push({ url: url.toString(), label: stripHtml(match[2]) });
    } catch {
      // Ignore malformed or javascript links.
    }
  }
  return links;
}

function isNavigationLink(label: string, url: string) {
  return /download|data|dataset|indicator|database|catalog|statistics|report|publication|下载|数据|指标|数据库|统计|报告/i.test(`${label} ${url}`);
}

function isStructuredUrl(url: string) {
  return /\.(csv|json|xlsx?|zip)(?:$|[?#])/i.test(url);
}

function linkScore(link: CrawlLink) {
  return (isStructuredUrl(link.url) ? 100 : 0) + (/download|data|dataset|indicator|excel|csv|下载|数据|指标/i.test(`${link.label} ${link.url}`) ? 30 : 0) - link.depth;
}

function isHtml(contentType: string) {
  return !contentType || /html|xhtml/i.test(contentType);
}

function stripHtml(value: string) {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function fileNameFromUrl(url: string) {
  try {
    const value = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'dataset');
    return value.includes('.') ? value : `${value}.bin`;
  } catch {
    return 'dataset.bin';
  }
}

function mimeFromUrl(url: string) {
  if (/\.csv(?:$|[?#])/i.test(url)) return 'text/csv';
  if (/\.json(?:$|[?#])/i.test(url)) return 'application/json';
  if (/\.xlsx(?:$|[?#])/i.test(url)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (/\.xls(?:$|[?#])/i.test(url)) return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}
