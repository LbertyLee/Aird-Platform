import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ExaResult } from './research.types';

type SearchResponse = {
  results: Array<{
    title: string;
    url: string;
    summary?: string;
    snippet?: string;
    rerank_score?: number;
  }>;
};

/** DeepSeek tools adapter; retains the existing external-evidence contract. */
export class DeepSeekWebService {
  private readonly apiKey: string;
  private readonly count: number;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('DEEPSEEK_SEARCH_API_KEY')?.trim() ?? '';
    this.count = config.get<number>('EXA_SEARCH_COUNT') ?? 40;
    this.timeoutMs = config.get<number>('DEEPSEEK_SEARCH_TIMEOUT_MS') ?? 30_000;
  }

  get configured(): boolean {
    return Boolean(this.apiKey);
  }

  async search(query: string, domains: string[], allowDiscovery = false): Promise<ExaResult[]> {
    if (!this.configured || (!domains.length && !allowDiscovery)) return [];
    // One site expression per request avoids ambiguous OR precedence and the
    // provider's 128-Unicode-character limit on long domain batches.
    const results: ExaResult[] = [];
    for (const domain of domains.length ? domains : ['']) {
      const suffix = domain ? ` site:${domain}` : '';
      const available = 128 - Array.from(suffix).length;
      if (available < 1) throw new BadRequestException('搜索来源域名过长');
      const scopedQuery =
        Array.from(query.trim()).slice(0, available).join('') + suffix;
      const body = await this.post<SearchResponse>('search', {
        query: scopedQuery,
        count: this.count,
        need_content: false,
      });
      if (!Array.isArray(body.results)) {
        throw new ServiceUnavailableException('DeepSeek Search 响应格式无效');
      }
      for (const item of body.results) {
        if (!item.title || !item.url) continue;
        let url: URL;
        try {
          url = new URL(item.url);
        } catch {
          continue;
        }
        const host = url.hostname.toLowerCase();
        if (
          !['http:', 'https:'].includes(url.protocol) ||
          url.username ||
          url.password ||
          (domain && !(host === domain || host.endsWith(`.${domain}`)))
        )
          continue;
        results.push({
          title: item.title,
          url: item.url,
          description: (item.summary || item.snippet || '').slice(0, 1500),
          extraSnippets: item.snippet ? [item.snippet] : [],
          ...(typeof item.rerank_score === 'number'
            ? { score: Math.max(0, Math.min(1, item.rerank_score / 3)) }
            : {}),
        });
      }
    }
    return [...new Map(results.map((item) => [item.url, item])).values()];
  }

  async getContents(urls: string[], maxCharacters: number) {
    const contents = new Map<
      string,
      { title?: string; text: string; url: string }
    >();
    if (!this.configured) return contents;
    // Sequential calls keep a single batch below the account Fetch QPS limit.
    for (const url of new Set(urls)) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        continue;
      }
      if (
        url.length > 8192 ||
        !['http:', 'https:'].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        continue;
      try {
        const page = await this.post<{ title: string; content: string }>(
          'fetch',
          { url },
        );
        if (typeof page.content === 'string' && page.content.trim()) {
          contents.set(url, {
            url,
            title: page.title || '',
            text: page.content.slice(0, maxCharacters),
          });
        }
      } catch {
        // Preserve partial batches and let hydration use its existing fallback.
      }
    }
    return contents;
  }

  private async post<T>(tool: 'search' | 'fetch', payload: object): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Response;
      try {
        response = await fetch(`https://api.deepseek.com/v1/tools/${tool}`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch {
        throw new ServiceUnavailableException(
          `DeepSeek ${tool} 连接失败或超时`,
        );
      }
      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch {
          throw new ServiceUnavailableException(
            `DeepSeek ${tool} 响应格式无效`,
          );
        }
      }
      const retryable =
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;
      await response.body?.cancel();
      if (!retryable || attempt === 2) {
        const hint =
          response.status === 401
            ? 'API Key 无效'
            : response.status === 402
              ? '账号余额不足'
              : '请求失败';
        throw new ServiceUnavailableException(
          `DeepSeek ${tool} 返回 ${response.status}：${hint}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    }
    throw new ServiceUnavailableException('DeepSeek 请求失败');
  }
}
