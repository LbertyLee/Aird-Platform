import { Injectable, Logger } from '@nestjs/common';
import { ExaSearchService } from './exa-search.service';
import { ResearchRepository } from './research.repository';
import type { SourceEntity } from './research.types';
import {
  decodeExternalHtml,
  hasEncodingDamage,
} from '../common/utils/external-text-quality';
import {
  browsableExternalUrl,
  externalUrlFetchCandidates,
} from '../common/utils/external-search-domain';

/**
 * Lazily hydrates Exa ResearchSource rows with full page text.
 * Search stores title/url only; preview and analysis call this on demand.
 * Falls back to a direct HTTP fetch when Exa Contents returns nothing
 * (common for some .gov.cn pages).
 */
@Injectable()
export class ExaContentHydrationService {
  private readonly logger = new Logger(ExaContentHydrationService.name);

  constructor(
    private readonly exa: ExaSearchService,
    private readonly repository: ResearchRepository,
  ) {}

  async ensureFullText(sources: SourceEntity[]): Promise<SourceEntity[]> {
    const pending = sources.filter((source) => needsFullText(source));
    if (!pending.length) return sources;

    const byId = new Map(sources.map((source) => [source.id, source]));
    const urls = pending
      .map((source) =>
        source.sourceUrl ? browsableExternalUrl(source.sourceUrl) : null,
      )
      .filter((url): url is string => typeof url === 'string' && Boolean(url));

    // Persisted provenance controls Fetch even after the user changes modes.
    const deepseekUrls = new Set(pending.filter((source) =>
      source.metadata?.provider === 'deepseek-search' ||
      source.metadata?.contentProvider === 'deepseek-fetch',
    ).map((source) => browsableExternalUrl(source.sourceUrl!)));
    const loadContents = async (requested: string[]) => {
      const contents = new Map<string, { title?: string; text: string; url: string }>();
      const legacy = requested.filter((url) => !deepseekUrls.has(url));
      const ai = requested.filter((url) => deepseekUrls.has(url));
      if (legacy.length && this.exa.configured) {
        for (const [url, page] of await this.exa.getContents(legacy)) contents.set(url, page);
      }
      if (ai.length && this.exa.isConfigured('deepseek')) {
        for (const [url, page] of await this.exa.getContents(ai, 50_000, 'deepseek')) contents.set(url, page);
      }
      return contents;
    };
    const initialContents = await loadContents(urls);

    if (!this.exa.configured && !deepseekUrls.size) {
      this.logger.warn('Exa 未配置，将尝试直连抓取选中网站正文。');
    }

    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(6, pending.length) }, async () => {
        while (next < pending.length) {
          const source = pending[next++];
          const sourceStartedAt = Date.now();
          try {
            const url = browsableExternalUrl(source.sourceUrl!);
            let hydrated = false;
            for (let attempt = 1; attempt <= 2 && !hydrated; attempt += 1) {
              const contents =
                attempt === 1
                  ? initialContents
                  : await loadContents([url]);
              let text =
                contents.get(url)?.text ??
                contents.get(source.sourceUrl!)?.text ??
                [...contents.entries()].find(([key]) =>
                  urlsMatch(key, url),
                )?.[1]?.text ??
                '';
              let provider = deepseekUrls.has(url) ? 'deepseek-fetch' : 'exa-contents';

              // Exa may flatten HTML tables into one-cell-per-line text. Fetch
              // the page HTML again so preview and analysis retain column pairs.
              const flattenedTables = hasFlattenedTableText(text);
              if (
                !text.trim() ||
                isLowQualityPageText(source.title, text) ||
                flattenedTables
              ) {
                const direct = (await this.fetchPageText(url)) ?? '';
                if (
                  direct.trim() &&
                  !isLowQualityPageText(source.title, direct) &&
                  (hasMarkdownTable(direct) ||
                    !text.trim() ||
                    isLowQualityPageText(source.title, text) ||
                    direct.length > text.length * 1.2)
                ) {
                  text = direct;
                  provider = 'direct-http';
                }
              }

              if (!hasMarkdownTable(text)) {
                const reconstructed = reconstructFlattenedTables(text);
                if (reconstructed !== text) text = reconstructed;
              }

              if (
                !text.trim() ||
                isTitleOnly(source.title, text) ||
                isLowQualityPageText(source.title, text)
              ) {
                if (attempt === 1) {
                  this.logger.warn(
                    `正文首次补全无效，自动重试：${source.title} (${url})`,
                  );
                }
                continue;
              }

              const updated = await this.repository.updateSourceFullText(
                source.id,
                text,
                {
                  contentMode: 'full',
                  contentProvider: provider,
                  extractionUnavailable: false,
                },
              );
              if (updated) byId.set(source.id, updated);
              hydrated = true;
            }
            if (!hydrated) {
              this.logger.warn(
                `未能拉取可用正文：${source.title} (${url})；禁止将标题作为正文送入指标抽取。`,
              );
              // Persist the failure state so later analysis attempts do not
              // repeatedly treat the title placeholder as extractable text.
              await this.repository.updateSourceMetadata(source.id, {
                contentMode: 'unavailable',
                contentProvider: 'none',
                extractionUnavailable: true,
              });
              byId.set(source.id, {
                ...source,
                metadata: {
                  ...source.metadata,
                  contentMode: 'unavailable',
                  extractionUnavailable: true,
                },
              });
            }
            this.logger.log(
              `analysis_timing phase=ensureFullText.source sourceId=${source.id} elapsedMs=${Date.now() - sourceStartedAt} hydrated=${hydrated}`,
            );
          } catch (error) {
            this.logger.warn(
              `analysis_timing phase=ensureFullText.source sourceId=${source.id} elapsedMs=${Date.now() - sourceStartedAt} failed=true error=${String(error).slice(0, 240)}`,
            );
          }
        }
      }),
    );

    return sources.map((source) => byId.get(source.id) ?? source);
  }

  /** Best-effort HTML → plain text when Exa Contents is empty. */
  private async fetchPageText(url: string): Promise<string | null> {
    for (const candidate of externalUrlFetchCandidates(url)) {
      const text = await this.fetchSinglePageText(candidate);
      if (text) return text;
    }
    return null;
  }

  private async fetchSinglePageText(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(12_000),
        headers: {
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
          // Prefer a normal browser UA — many *.gov.cn sites reject bot UAs.
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
      });
      if (!response.ok) {
        this.logger.warn(`直连抓取失败 ${response.status}: ${url}`);
        return null;
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (
        contentType &&
        !/text\/html|application\/xhtml|text\/plain/i.test(contentType)
      ) {
        this.logger.warn(`直连抓取跳过非 HTML: ${contentType} (${url})`);
        return null;
      }
      const html = decodeExternalHtml(
        await response.arrayBuffer(),
        contentType,
      );
      const text = htmlToPlainText(html);
      return text.length >= 20 ? text.slice(0, 50_000) : null;
    } catch (error) {
      this.logger.warn(`直连抓取异常 ${url}: ${String(error)}`);
      return null;
    }
  }
}

export function needsFullText(source: SourceEntity): boolean {
  if (source.origin !== 'exa' || !source.sourceUrl) return false;
  if (hasStructuredRows(source.structuredData)) return false;
  if (
    source.metadata?.contentProvider === 'exa-contents' &&
    hasFlattenedTableText(source.textContent)
  ) {
    return true;
  }
  if (
    source.metadata?.contentMode === 'full' &&
    !isTitleOnly(source.title, source.textContent) &&
    !isLowQualityPageText(source.title, source.textContent)
  ) {
    return false;
  }
  return true;
}

export function hasFlattenedTableText(text: string): boolean {
  if (!text || hasMarkdownTable(text)) return false;
  return /(?:^|\n)\s*(?:表\s*[一二三四五六七八九十\d]+|table\s*\d+)\s*[^\n]{0,100}/im.test(
    text,
  );
}

export function reconstructFlattenedTables(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const title = lines[index]?.trim() ?? '';
    if (!/^表\s*[一二三四五六七八九十\d]+\s*\S/.test(title)) {
      output.push(lines[index]!);
      continue;
    }

    let cursor = index + 1;
    while (cursor < lines.length && !lines[cursor]!.trim()) cursor += 1;
    const headerStart = cursor;
    let firstDataLabel = -1;
    for (; cursor + 1 < lines.length; cursor += 1) {
      if (isNumericTableValue(lines[cursor + 1]!)) {
        firstDataLabel = cursor;
        break;
      }
      if (!lines[cursor]!.trim() || isTableSectionTitle(lines[cursor]!)) break;
    }
    if (firstDataLabel <= headerStart) {
      output.push(lines[index]!);
      continue;
    }

    const headerLines = lines
      .slice(headerStart, firstDataLabel)
      .map((line) => line.trim());
    const hasLabelHeader = /^(指标|项目|类别|名称|地区|分类)$/.test(
      headerLines[0] ?? '',
    );
    const valueColumns = headerLines.length - (hasLabelHeader ? 1 : 0);
    if (valueColumns < 1 || valueColumns > 8) {
      output.push(lines[index]!);
      continue;
    }

    const headers = hasLabelHeader ? headerLines : ['指标', ...headerLines];
    const rows: string[][] = [];
    cursor = firstDataLabel;
    while (cursor + valueColumns < lines.length) {
      const label = lines[cursor]!.trim();
      if (!label || isTableSectionTitle(label)) break;
      const values = lines
        .slice(cursor + 1, cursor + valueColumns + 1)
        .map((line) => line.trim());
      if (!values.every(isNumericTableValue)) break;
      rows.push([label, ...values]);
      cursor += valueColumns + 1;
      while (cursor < lines.length && !lines[cursor]!.trim()) cursor += 1;
    }
    if (!rows.length) {
      output.push(lines[index]!);
      continue;
    }

    output.push(
      title,
      '',
      `| ${headers.map(escapeMarkdownCell).join(' | ')} |`,
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...rows.map((row) => `| ${row.map(escapeMarkdownCell).join(' | ')} |`),
    );
    index = cursor - 1;
  }
  return output.join('\n').replace(/\n{3,}/g, '\n\n');
}

function isNumericTableValue(value: string): boolean {
  return /^\s*[+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)(?:\s*(?:%|％|‰|万|亿|万人|亿元|吨|万吨|元|美元))?\s*$/.test(
    value,
  );
}

function isTableSectionTitle(value: string): boolean {
  return /^(?:表\s*[一二三四五六七八九十\d]+|注[：:]|资料来源[：:]|数据来源[：:])/.test(
    value.trim(),
  );
}

function hasMarkdownTable(text: string): boolean {
  return /^\s*\|.+\|\s*\n\s*\|\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m.test(
    text,
  );
}

export function isTitleOnly(title: string, text: string): boolean {
  const body = normalizeTitleText(text);
  if (!body) return true;
  const titleVariants = normalizedTitleVariants(title);
  return titleVariants.some(
    (candidate) =>
      body === candidate ||
      (body.startsWith(`${candidate}\n`) &&
        body.length < candidate.length + 40),
  );
}

function normalizedTitleVariants(title: string): string[] {
  const normalized = normalizeTitleText(title);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  const colonIndex = normalized.indexOf('：');
  if (colonIndex >= 0 && colonIndex < normalized.length - 1) {
    variants.add(normalized.slice(colonIndex + 1).trim());
  }
  return [...variants].filter(Boolean);
}

function normalizeTitleText(value: string): string {
  return value
    .trim()
    .replace(/^#+\s*/, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ');
}

/**
 * Detect portal chrome / login shells that look like "full text" but are not
 * the article body (common on municipal *.gov.cn CMS templates).
 */
export function isLowQualityPageText(title: string, text: string): boolean {
  if (hasEncodingDamage(text)) return true;
  const body = text.replace(/\s+/g, ' ').trim();
  if (!body) return true;
  if (isTitleOnly(title, text)) return true;
  const hasData = /\d+(?:\.\d+)?\s*(?:亿元|万亿|%|％|美元|万人)/.test(body);
  if (body.length < 200 && !hasData) return true;

  const chromeHits = [
    /用户登录/,
    /立即注册/,
    /忘记密码/,
    /登录注册/,
    /请输入验证码/,
    /会员登录/,
    /新用户注册/,
    /Sign\s*in/i,
    /Log\s*in/i,
  ].filter((pattern) => pattern.test(body)).length;

  const articleHints = [
    /信息来源/,
    /发布时间/,
    /来源[:：]/,
    /记者/,
    /摘编/,
    /根据/,
    /指出/,
    /表示/,
    /\d{4}\s*年/,
    /GDP|亿元|万亿|同比|环比|ＧＤＰ/,
  ].filter((pattern) => pattern.test(body)).length;

  if (chromeHits >= 2 && articleHints < 2 && !hasData) return true;
  if (articleHints === 0 && !hasData && body.length < 800) return true;
  return false;
}

/** Prefer article containers before falling back to the full document. */
export function extractMainHtml(html: string): string {
  // Balance container tags: a lazy </div> regex cuts off nested tables.
  html = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const stack: Array<{
    tag: string;
    start: number;
    eligible: boolean;
    priority: number;
  }> = [];
  const candidates: Array<{ text: string; priority: number }> = [];
  for (const match of html.matchAll(/<\/?(div|article|main)\b[^>]*>/gi)) {
    const tag = match[1].toLowerCase();
    if (!match[0].startsWith('</')) {
      const className =
        match[0].match(/class\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
      const id = match[0].match(/id\s*=\s*["']([^"']*)["']/i)?.[1] ?? '';
      const eligible =
        tag !== 'div' ||
        /^(zoom|TRS_Editor|article_content|articleContent|contentText)$/i.test(
          id,
        ) ||
        /(?:^|\s)(sub-text|article-content|article_content|news-content|detail-content|post-content|entry-content|TRS_Editor)(?:\s|$)/i.test(
          className,
        );
      stack.push({
        tag,
        start: match.index! + match[0].length,
        eligible,
        priority: tag === 'main' ? 1 : 0,
      });
    } else {
      const index = stack.map((item) => item.tag).lastIndexOf(tag);
      if (index < 0) continue;
      const [container] = stack.splice(index);
      if (container.eligible)
        candidates.push({
          text: html.slice(container.start, match.index),
          priority: container.priority,
        });
    }
  }
  candidates.sort(
    (a, b) => a.priority - b.priority || b.text.length - a.text.length,
  );
  const best = candidates[0]?.text ?? '';
  if (best.trim().length >= 20) {
    const titleMatch =
      /<div[^>]*class=["'][^"']*sub-text-biaoti[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
        html,
      );
    const metaMatch =
      /<div[^>]*class=["'][^"']*sub-text-zhushi[^"']*["'][^>]*>([\s\S]*?)<\/div>/i.exec(
        html,
      );
    return [titleMatch?.[1], metaMatch?.[1], best].filter(Boolean).join('\n');
  }
  return html;
}

/**
 * Some *.gov.cn visualization templates embed the readable article in a JS
 * config object (articleData.content) instead of server-rendered HTML.
 */
export function extractEmbeddedArticlePlainText(html: string): string | null {
  const block = extractBalancedJsObject(html, 'articleData');
  if (!block) return null;

  const titleLiteral = readJsObjectStringField(block, 'title');
  const contentLiteral = readJsObjectStringField(block, 'content');
  if (!contentLiteral) return null;

  const contentHtml = unescapeJsStringLiteral(contentLiteral);
  const body = fragmentHtmlToPlainText(contentHtml);
  if (!body.trim()) return null;

  const title = titleLiteral ? unescapeJsStringLiteral(titleLiteral) : '';
  if (title.trim() && !body.includes(title.trim())) {
    return `${title.trim()}\n\n${body}`.trim();
  }
  return body.trim();
}

function extractBalancedJsObject(
  html: string,
  fieldName: string,
): string | null {
  const marker = new RegExp(`\\b${fieldName}\\s*:\\s*\\{`, 'i').exec(html);
  if (!marker || marker.index === undefined) return null;
  const openBrace = html.indexOf('{', marker.index);
  if (openBrace < 0) return null;

  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escaped = false;
  for (let index = openBrace + 1; index < html.length; index += 1) {
    const char = html[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      if (depth === 0) return html.slice(openBrace + 1, index);
      depth -= 1;
    }
  }
  return null;
}

function readJsObjectStringField(block: string, field: string): string | null {
  const match = new RegExp(
    `${field}\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')`,
    'i',
  ).exec(block);
  if (!match?.[1]) return null;
  const literal = match[1];
  return literal.slice(1, -1);
}

export function unescapeJsStringLiteral(value: string): string {
  return value
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/')
    .replace(/\\\\/g, '\\');
}

function fragmentHtmlToPlainText(fragment: string): string {
  const main = extractMainHtml(fragment);
  return applyPlainTextReplacements(main);
}

function applyPlainTextReplacements(main: string): string {
  return preserveHtmlTables(main)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|table|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : ' ';
    })
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Keep article tables as Markdown so previews and indicator extraction retain row/column meaning. */
function preserveHtmlTables(html: string): string {
  return html.replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const rows = parseHtmlTableRows(table);
    if (!rows.length) return table;

    const headerSections = [
      ...table.matchAll(/<thead\b[^>]*>([\s\S]*?)<\/thead>/gi),
    ];
    const headerRowCount = headerSections.reduce(
      (count, section) => count + [...section[1].matchAll(/<tr\b/gi)].length,
      0,
    );
    const headerRows = rows.slice(0, headerRowCount);
    const columnCount = Math.max(...rows.map((row) => row.length));
    const headers = headerRows.length
      ? Array.from({ length: columnCount }, (_, column) =>
          [
            ...new Set(headerRows.map((row) => row[column]).filter(Boolean)),
          ].join(' / '),
        )
      : rows[0];
    const bodyRows = headerRows.length
      ? rows.slice(headerRowCount)
      : rows.slice(1);
    const formatRow = (row: string[]) =>
      `| ${headers.map((_, index) => escapeMarkdownCell(row[index] ?? '')).join(' | ')} |`;
    return [
      formatRow(headers),
      `| ${headers.map(() => '---').join(' | ')} |`,
      ...bodyRows.map(formatRow),
    ].join('\n');
  });
}

function parseHtmlTableRows(table: string): string[][] {
  const rows: string[][] = [];
  const pending = new Map<number, { value: string; remaining: number }>();
  for (const rowMatch of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row: string[] = [];
    pending.forEach((item, column) => {
      row[column] = item.value;
      item.remaining -= 1;
      if (item.remaining <= 0) pending.delete(column);
    });
    let column = 0;
    for (const cellMatch of rowMatch[1].matchAll(
      /<(t[hd])\b([^>]*)>([\s\S]*?)<\/t[hd]>/gi,
    )) {
      while (row[column] !== undefined) column += 1;
      const value = decodeHtmlCell(cellMatch[3]);
      const colspan = Math.max(
        1,
        Number(cellMatch[2].match(/\bcolspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1),
      );
      const rowspan = Math.max(
        1,
        Number(cellMatch[2].match(/\browspan\s*=\s*["']?(\d+)/i)?.[1] ?? 1),
      );
      for (let offset = 0; offset < colspan; offset += 1) {
        row[column + offset] = value;
        if (rowspan > 1)
          pending.set(column + offset, { value, remaining: rowspan - 1 });
      }
      column += colspan;
    }
    if (row.some((value) => value !== undefined)) rows.push(row);
  }
  return rows;
}

function decodeHtmlCell(value: string): string {
  return value
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([\da-f]+);/gi, (_, code: string) =>
      String.fromCharCode(parseInt(code, 16)),
    )
    .replace(/[|\s]+/g, ' ')
    .trim();
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

export function htmlToPlainText(html: string): string {
  const embedded = extractEmbeddedArticlePlainText(html);
  if (embedded && embedded.length >= 20) return embedded;

  const main = extractMainHtml(html);
  return applyPlainTextReplacements(main);
}

function urlsMatch(left: string, right: string): boolean {
  const a = browsableExternalUrl(left).replace(/\/+$/, '');
  const b = browsableExternalUrl(right).replace(/\/+$/, '');
  return a === b;
}

function hasStructuredRows(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(
      (row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row),
    );
  }
  return Boolean(value) && typeof value === 'object';
}
