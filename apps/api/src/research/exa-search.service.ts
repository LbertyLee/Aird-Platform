import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExaResult } from './research.types';
import { DeepSeekWebService } from './deepseek-web.service';
import {
  browsableExternalUrl,
  externalSearchDomain,
  publicResearchWebsite,
} from '../common/utils/external-search-domain';

interface ExaSearchResponse {
  results?: Array<{
    title?: string | null;
    url?: string | null;
    score?: number | null;
    text?: string | null;
    highlights?: string[] | null;
  }>;
}

interface ExaContentsResponse {
  results?: Array<{
    title?: string | null;
    url?: string | null;
    id?: string | null;
    text?: string | null;
  }>;
}

/** Full-text length when user selects a source for analysis (not at search time). */
export const EXA_FULL_TEXT_MAX_CHARACTERS = 50_000;

type SourceSearchResult = {
  sourceId: string;
  sourceName: string;
  results: ExaResult[];
};

export type ExaSourceSearchSummary = {
  results: SourceSearchResult[];
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

@Injectable()
export class ExaSearchService {
  private readonly deepseek: DeepSeekWebService;
  private readonly logger = new Logger(ExaSearchService.name);
  private readonly apiKey?: string;
  private readonly count: number;
  private readonly sourceDomainBatchSize: number;
  private readonly sourceSearchConcurrency: number;

  constructor(config: ConfigService) {
    this.deepseek = new DeepSeekWebService(config);
    this.apiKey = config.get<string>('EXA_API_KEY') || undefined;
    // Fetch a larger candidate set, then keep the highest-relevance results
    // after cross-source de-duplication.
    // Keep enough candidates for the relevance pass to distinguish similar
    // pages. The previous default of 20 was also the final display limit,
    // which made broad multi-year questions look artificially sparse.
    this.count = config.get<number>('EXA_SEARCH_COUNT') ?? 40;
    // Smaller batches → each domain competes with fewer peers for the same
    // numResults quota when searching all configured sources.
    this.sourceDomainBatchSize = config.get<number>('EXA_SOURCE_DOMAIN_BATCH_SIZE') ?? 20;
    this.sourceSearchConcurrency =
      config.get<number>('EXA_SOURCE_SEARCH_CONCURRENCY') ?? 4;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  get provider(): 'deepseek' | 'exa' {
    return 'exa';
  }

  isConfigured(provider: 'deepseek' | 'exa'): boolean {
    return provider === 'deepseek' ? this.deepseek.configured : this.configured;
  }

  /**
   * Runs a whitelist-bound Exa query. Callers must provide configured domains;
   * returning no result is safer than accidentally falling back to web-wide search.
   *
   * Search requests bounded excerpts for relevance checks.
   * Full page text is fetched later via {@link getContents} when the user
   * selects sources for analysis — that keeps search storage small.
   */
  async search(query: string, domains: string[], provider: 'deepseek' | 'exa' = 'exa', allowDiscovery = false): Promise<ExaResult[]> {
    if (provider === 'deepseek') return this.deepseek.search(query, domains, allowDiscovery);
    if (!this.apiKey || (domains.length === 0 && !allowDiscovery)) return [];

    const payload = {
      query,
      numResults: this.count,
      ...(domains.length ? { includeDomains: domains } : {}),
      contents: {
        text: { maxCharacters: 1500 },
        highlights: { query, numSentences: 3, highlightsPerUrl: 3 },
      },
    };
    this.logger.log(
      `Exa search request query=${JSON.stringify(query)} numResults=${this.count} domainCount=${domains.length} domainsSample=${JSON.stringify(domains.slice(0, 8))}${domains.length > 8 ? '…' : ''}`,
    );

    let response: Response;
    try {
      response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `Exa Search 连接失败：${this.errorMessage(error)}`,
      );
    }

    if (!response.ok) {
      const details = await response.text();
      throw new ServiceUnavailableException(
        this.rejectedResponseMessage(response.status, details),
      );
    }

    const body = (await response.json()) as ExaSearchResponse;
    const mapped = (body.results ?? [])
      .filter((result) => result.title && result.url)
      .map((result) => ({
        title: result.title ?? '未命名来源',
        url: browsableExternalUrl(result.url ?? ''),
        // This is Exa's search excerpt, not the page body. Keeping it makes
        // re-ranking assess the actual topic while full text is still fetched
        // only after the user selects a source.
        description: [result.text ?? '', ...(result.highlights ?? [])]
          .map((text) => text.trim()).filter(Boolean).join('\n').slice(0, 1_500),
        extraSnippets: (result.highlights ?? [])
          .map((snippet) => snippet.trim())
          .filter(Boolean)
          .slice(0, 6),
        ...(typeof result.score === 'number' ? { score: result.score } : {}),
      }));
    this.logger.log(
      `Exa search response resultCount=${mapped.length} topUrls=${JSON.stringify(mapped.slice(0, 3).map((item) => item.url))}`,
    );
    return mapped;
  }

  /**
   * Fetches full page text for selected URLs (Exa Contents API).
   * Used when the user opts sources into analysis — not during search listing.
   */
  async getContents(
    urls: string[],
    maxCharacters = EXA_FULL_TEXT_MAX_CHARACTERS,
    provider: 'deepseek' | 'exa' = 'exa',
  ): Promise<Map<string, { title?: string; text: string; url: string }>> {
    if (provider === 'deepseek') return this.deepseek.getContents(urls, maxCharacters);
    const unique = [
      ...new Set(
        urls.map((url) => browsableExternalUrl(url.trim())).filter(Boolean),
      ),
    ];
    const byUrl = new Map<
      string,
      { title?: string; text: string; url: string }
    >();
    if (!this.apiKey || unique.length === 0) return byUrl;

    const batchSize = 10;
    for (let index = 0; index < unique.length; index += batchSize) {
      const batch = unique.slice(index, index + batchSize);
      let response: Response;
      try {
        response = await fetch('https://api.exa.ai/contents', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify({
            urls: batch,
            text: { maxCharacters },
          }),
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        this.logger.warn(
          `Exa Contents 连接失败（batch ${index / batchSize + 1}）：${this.errorMessage(error)}`,
        );
        continue;
      }
      if (!response.ok) {
        const details = await response.text();
        this.logger.warn(
          `Exa Contents 返回 ${response.status}（batch ${index / batchSize + 1}）：${details.slice(0, 240)}`,
        );
        continue;
      }
      const payload = (await response.json()) as ExaContentsResponse;
      for (const result of payload.results ?? []) {
        const url = browsableExternalUrl(
          (result.url ?? result.id ?? '').trim(),
        );
        const text = result.text?.trim() ?? '';
        if (!url || !text) continue;
        byUrl.set(url, {
          url,
          text,
          ...(result.title ? { title: result.title } : {}),
        });
        // Also index by requested URL when Exa normalizes trailing slashes etc.
        const matched = batch.find(
          (candidate) =>
            candidate === url ||
            this.normalizeUrlKey(candidate) === this.normalizeUrlKey(url),
        );
        if (matched && matched !== url) {
          byUrl.set(matched, byUrl.get(url)!);
        }
      }
    }
    return byUrl;
  }

  private normalizeUrlKey(value: string): string {
    try {
      const parsed = new URL(browsableExternalUrl(value));
      parsed.hash = '';
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
    } catch {
      return value.trim().toLowerCase();
    }
  }

  /**
   * Deduplicate configured domains and query them in bounded concurrent batches.
   */
  async searchSources(
    query: string,
    sources: Array<{ id: string; name: string; websiteUrl?: string | null }>,
    provider: 'deepseek' | 'exa' = 'exa',
  ): Promise<ExaSourceSearchSummary> {
    const uniqueDomains = new Set<string>();
    const sourceByDomain = new Map<string, { id: string; name: string }>();
    for (const source of sources) {
      const parsed = externalSearchDomain(source.websiteUrl);
      if (parsed.domain) {
        uniqueDomains.add(parsed.domain);
        sourceByDomain.set(parsed.domain, { id: source.id, name: source.name });
      }
    }

    const domains = [...uniqueDomains];
    this.logger.log(
      `Exa searchSources query=${JSON.stringify(query)} configuredSources=${sources.length} uniqueDomains=${domains.length} domains=${JSON.stringify(domains.slice(0, 12))}${domains.length > 12 ? '…' : ''}`,
    );
    const batches: string[][] = [];
    const batchSize = provider === 'deepseek' ? 1 : this.sourceDomainBatchSize;
    for (
      let index = 0;
      index < domains.length;
      index += batchSize
    ) {
      batches.push(domains.slice(index, index + batchSize));
    }
    const settled = await this.settleWithConcurrency(
      batches.map((domainBatch) => async () => ({
        sourceId: '',
        sourceName: '',
        results: await this.search(query, domainBatch, provider),
      })),
    );
    const results: SourceSearchResult[] = [];
    let failed = 0;
    settled.forEach((item, index) => {
      if (item.status === 'fulfilled') {
        const grouped = new Map<string, SourceSearchResult>();
        for (const result of item.value.results) {
          const domain = this.domainFromUrl(result.url);
          const source = domain ? sourceByDomain.get(domain) : undefined;
          const key = source?.id ?? '';
          const group = grouped.get(key) ?? {
            sourceId: source?.id ?? '',
            sourceName: source?.name ?? '',
            results: [],
          };
          group.results.push(result);
          grouped.set(key, group);
        }
        results.push(...grouped.values());
        return;
      }
      failed += 1;
      this.logger.warn(
        `Exa source search failed for domain batch ${index + 1}/${batches.length}: ${this.errorMessage(item.reason)}`,
      );
    });

    return {
      results,
      attempted: batches.length,
      succeeded: batches.length - failed,
      failed,
      skipped: sources.length - domains.length,
    };
  }

  /** Explicit discovery path; normal configured-source calls remain scoped. */
  async discoverSources(query: string, websites: string[], provider: 'deepseek' | 'exa' = 'exa'): Promise<ExaSourceSearchSummary> {
    const sources = [...new Set(websites.flatMap((website) => {
      const { domain } = externalSearchDomain(publicResearchWebsite(website));
      // Model suggestions are untrusted; only public DNS names are candidates.
      if (!domain || !/^[a-z\d.-]+\.[a-z]{2,}$/i.test(domain)
        || /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(domain)) return [];
      return [domain];
    }))].slice(0, 5).map((domain) => ({ id: '', name: '', websiteUrl: `https://${domain}` }));
    const scoped = await this.searchSources(query, sources, provider);
    if (scoped.results.some((group) => group.results.length)) return scoped;
    try {
      const results = await this.search(query, [], provider, true);
      return {
        ...scoped,
        attempted: scoped.attempted + 1,
        succeeded: scoped.succeeded + 1,
        results: [{ sourceId: '', sourceName: '', results }],
      };
    } catch (error) {
      if (!scoped.succeeded) throw error;
      return { ...scoped, attempted: scoped.attempted + 1, failed: scoped.failed + 1 };
    }
  }

  private domainFromUrl(value?: string | null): string | undefined {
    return externalSearchDomain(value).domain;
  }

  private rejectedResponseMessage(status: number, body: string): string {
    try {
      const payload = JSON.parse(body) as { error?: unknown; tag?: unknown };
      const error = typeof payload.error === 'string' ? payload.error : '';
      const tag = typeof payload.tag === 'string' ? payload.tag : '';
      if (error) {
        return `Exa Search 返回 ${status}${tag ? `（${tag}）` : ''}：${error}`;
      }
    } catch {
      // The status remains useful when Exa returns a non-JSON body.
    }
    return `Exa Search 返回 ${status}。`;
  }

  private async settleWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
  ): Promise<PromiseSettledResult<T>[]> {
    const settled = new Array<PromiseSettledResult<T>>(tasks.length);
    let next = 0;
    const worker = async () => {
      while (next < tasks.length) {
        const index = next++;
        try {
          settled[index] = { status: 'fulfilled', value: await tasks[index]() };
        } catch (reason) {
          settled[index] = { status: 'rejected', reason };
        }
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(this.sourceSearchConcurrency, tasks.length) },
        () => worker(),
      ),
    );
    return settled;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
