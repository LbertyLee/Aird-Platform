import { Injectable, Logger } from '@nestjs/common';
import type { ResearchQueryPlan } from '@agent/contracts';
import { periodsFromRecentYearPhrase } from '../common/utils/recent-years';
import { QUERY_COUNTRIES } from '../common/utils/query-countries';
import { OfficialObservationCache } from './official-observation-cache';
import type { SourceEntity } from './research.types';

export interface OfficialStructuredDataset {
  title: string;
  sourceUrl: string;
  textContent: string;
  structuredData: Array<Record<string, unknown>>;
  metadata: Record<string, unknown>;
}

export interface WorldBankQueryCriteria {
  countries: string[];
  indicatorCodes: string[];
  start: number;
  end: number;
}

interface WorldBankObservation {
  indicator?: { id?: string; value?: string };
  country?: { id?: string; value?: string };
  countryiso3code?: string;
  date?: string;
  value?: number | null;
}

const REQUEST_TIMEOUT_MS = 8_000;
const REQUEST_ATTEMPTS = 3;

const COUNTRY_CODES: Record<string, string> = Object.fromEntries(
  QUERY_COUNTRIES.flatMap(([code, ...aliases]) =>
    [code, ...aliases].map((alias) => [alias.toLowerCase(), code]),
  ),
);

const INDICATORS = [
  {
    code: 'SP.DYN.CBRT.IN',
    catalogCode: 'crude_birth_rate',
    unit: '‰',
    label: 'Birth rate, crude (per 1,000 people)',
    pattern: /出生率|birth rate/i,
  },
  {
    code: 'SP.POP.GROW',
    catalogCode: 'population_growth',
    unit: '%',
    label: 'Population growth (annual %)',
    pattern: /人口增长率|population growth/i,
  },
  {
    code: 'NY.GDP.PCAP.CD',
    catalogCode: 'gdp_per_capita',
    unit: '美元/人',
    label: 'GDP per capita (current US$)',
    pattern: /人均\s*(gdp|国内生产总值)|gdp\s*per\s*capita/i,
  },
  {
    code: 'NY.GDP.MKTP.KD.ZG',
    catalogCode: 'gdp_real_growth',
    unit: '%',
    label: 'GDP growth (annual %)',
    pattern:
      /(?:gdp|国内生产总值).{0,8}(?:增长|增速|growth)|(?:growth).{0,8}gdp/i,
  },
  {
    code: 'NY.GDP.MKTP.CD',
    catalogCode: 'gdp_current_usd',
    unit: '美元',
    label: 'GDP (current US$)',
    pattern: /\bgdp\b|国内生产总值|gross domestic product/i,
  },
  {
    code: 'SP.POP.TOTL',
    catalogCode: 'population_total',
    unit: '人',
    label: 'Population, total',
    pattern: /人口|population/i,
  },
  {
    code: 'SL.UEM.TOTL.ZS',
    catalogCode: 'unemployment_rate',
    unit: '%',
    label: 'Unemployment, total (% of total labor force)',
    pattern: /失业率|unemployment/i,
  },
  {
    code: 'FP.CPI.TOTL.ZG',
    catalogCode: 'cpi_inflation',
    unit: '%',
    label: 'Inflation, consumer prices (annual %)',
    pattern: /通货膨胀|cpi|inflation/i,
  },
];

@Injectable()
export class WorldBankDataService {
  private readonly logger = new Logger(WorldBankDataService.name);
  private readonly observationCache = new OfficialObservationCache(
    undefined,
    undefined,
    (message) => this.logger.warn(message),
  );

  /** Enrich the selected pages in the session snapshot; keep their IDs and access scope. */
  async hydrateSources(
    sources: SourceEntity[],
    plan: ResearchQueryPlan,
    query: string,
    enabledIndicatorCodes: string[],
  ): Promise<SourceEntity[]> {
    const candidates = sources.filter((source) => {
      if (Array.isArray(source.structuredData) && source.structuredData.length)
        return false;
      if (source.structuredData && !Array.isArray(source.structuredData))
        return false;
      try {
        const url = new URL(source.sourceUrl ?? '');
        return (
          url.protocol === 'https:' &&
          (url.hostname === 'worldbank.org' ||
            url.hostname.endsWith('.worldbank.org'))
        );
      } catch {
        return false;
      }
    });
    if (!candidates.length) return sources;
    const officialPlan = { ...plan, sources: ['World Bank'] };
    const criteria = this.getCriteria(officialPlan, query);
    if (!criteria) return sources;
    const datasets = await this.fetch(officialPlan, query);
    const rowsBySource = new Map<string, Array<Record<string, unknown>>>();
    for (const dataset of datasets) {
      const owner =
        candidates.find((source) => {
          const code = new URL(source.sourceUrl!).pathname.match(
            /\/indicator\/([^/]+)/i,
          )?.[1];
          return code === dataset.metadata.indicatorCode;
        }) ?? candidates[0];
      const rows = dataset.structuredData.flatMap((row) => {
        if (
          plan.timeRanges.length &&
          plan.timeRanges.every((period) => /^\d{4}$/.test(period)) &&
          !plan.timeRanges.includes(String(row.year))
        )
          return [];
        // Match only known catalog contracts, never a fuzzy GDP label (level vs growth).
        const code = [
          row.indicatorCode,
          row.catalogIndicatorCode,
          ...(row.indicatorCode === 'SP.POP.TOTL' && row.countryCode === 'WLD'
            ? ['world_population']
            : []),
        ].find(
          (value): value is string =>
            typeof value === 'string' && enabledIndicatorCodes.includes(value),
        );
        return code
          ? [
              {
                ...row,
                worldBankIndicatorCode: row.indicatorCode,
                indicatorCode: code,
              },
            ]
          : [];
      });
      rowsBySource.set(owner.id, [
        ...(rowsBySource.get(owner.id) ?? []),
        ...rows,
      ]);
    }
    const count = [...rowsBySource.values()].reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    this.logger.log(
      `World Bank analysis hydration: ${candidates.length} selected pages, ${count} official observations`,
    );
    if (!datasets.length) {
      this.logger.warn(
        'World Bank API returned no usable observations for the requested countries, indicators and years',
      );
    }
    return sources.map((source) => {
      const rows = rowsBySource.get(source.id);
      if (!rows?.length) return source;
      return {
        ...source,
        storageType: 'structured',
        mimeType: 'application/json',
        structuredData: rows,
        recordCount: rows.length,
        metadata: { ...source.metadata, analysisProvider: 'world-bank-api' },
      };
    });
  }

  isRequested(plan: ResearchQueryPlan, query: string): boolean {
    return (
      [...plan.sources, query]
        .join(' ')
        .toLowerCase()
        .match(/world\s*bank|worldbank|世界银行/) !== null
    );
  }

  async fetch(
    plan: ResearchQueryPlan,
    query: string,
  ): Promise<OfficialStructuredDataset[]> {
    if (!this.isRequested(plan, query)) return [];

    const criteria = this.getCriteria(plan, query);
    if (!criteria) return [];
    const indicators = this.resolveIndicators(plan, query);
    const { countries, start, end } = criteria;
    const filterContext = [
      ...plan.countries.filter((country) =>
        Boolean(COUNTRY_CODES[country.trim().toLowerCase()]),
      ),
      ...plan.indicators,
      ...plan.timeRanges,
      ...plan.sources,
    ].join(' ');

    const settled = await Promise.allSettled(
      indicators.map(
        async (indicator, index): Promise<OfficialStructuredDataset> => {
          // Keep a small gap between requests; the public endpoint throttles
          // bursts when several indicators and countries are selected together.
          if (index > 0)
            await new Promise((resolve) => setTimeout(resolve, index * 250));
          const url = new URL(
            `https://api.worldbank.org/v2/country/${countries.join(';')}/indicator/${indicator.code}`,
          );
          url.searchParams.set('format', 'json');
          url.searchParams.set('date', `${start}:${end}`);
          url.searchParams.set('per_page', '20000');
          const observations = await this.observationCache.get(url, (request) =>
            this.requestObservations(request),
          );
          const rows: Array<Record<string, unknown>> = observations
            .filter(
              (item) =>
                typeof item.value === 'number' &&
                Number.isFinite(item.value) &&
                /^\d{4}$/.test(item.date ?? '') &&
                Number(item.date) >= start &&
                Number(item.date) <= end &&
                countries.includes(item.countryiso3code ?? '') &&
                item.indicator?.id === indicator.code,
            )
            .map((item) => ({
              country: item.country?.value ?? item.countryiso3code ?? '',
              countryCode: item.countryiso3code ?? item.country?.id ?? '',
              year: Number(item.date),
              indicator: item.indicator?.value ?? indicator.label,
              indicatorCode: item.indicator?.id ?? indicator.code,
              catalogIndicatorCode: indicator.catalogCode,
              unit: indicator.unit,
              value: item.value,
              source: 'World Bank / 世界银行',
              sourceUrl: item.sourceUrl ?? url.toString(),
              retrievedAt: item.retrievedAt ?? new Date().toISOString(),
              cacheHit: item.cacheHit ?? false,
            }));
          return {
            title: `World Bank / 世界银行 · ${indicator.label}`,
            sourceUrl: url.toString(),
            textContent: [
              filterContext,
              ...rows.map(
                (row) =>
                  `${row.country} ${row.year} ${row.indicator} ${row.value}`,
              ),
            ]
              .filter(Boolean)
              .join('\n'),
            structuredData: rows,
            metadata: {
              provider: 'world-bank-api',
              indicatorCode: indicator.code,
              countries,
              period: `${start}-${end}`,
            },
          };
        },
      ),
    );
    const datasets = settled
      .filter(
        (result): result is PromiseFulfilledResult<OfficialStructuredDataset> =>
          result.status === 'fulfilled',
      )
      .map((result) => result.value)
      .filter((dataset) => dataset.structuredData.length > 0);
    settled.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(
          `World Bank ${indicators[index].code} request failed: ${result.reason instanceof Error ? result.reason.message : 'unknown error'}`,
        );
      }
    });
    if (datasets.length > 0) return datasets;

    return [];
  }

  /** Bound the complete response, including its body, and retry transient failures. */
  private async requestObservations(url: URL): Promise<WorldBankObservation[]> {
    const started = Date.now();
    for (let attempt = 1; attempt <= REQUEST_ATTEMPTS; attempt += 1) {
      let retryable = true;
      let retryDelay = 500 * 2 ** (attempt - 1);
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) {
          retryable =
            response.status === 408 ||
            response.status === 429 ||
            response.status >= 500;
          const retryAfter = Number(response.headers.get('retry-after'));
          if (Number.isFinite(retryAfter) && retryAfter > 0)
            retryDelay = Math.min(
              2_000,
              Math.max(retryDelay, retryAfter * 1_000),
            );
          // Release the connection before retrying; error bodies are not data.
          await response.body?.cancel();
          throw new Error(`World Bank API returned ${response.status}`);
        }
        // Body timeouts/truncated JSON must retry too, not escape the retry loop.
        const payload: unknown = await response.json();
        if (
          Array.isArray(payload) &&
          payload.length === 2 &&
          payload[1] === null &&
          payload[0]?.total === 0
        )
          return [];
        if (
          !Array.isArray(payload) ||
          payload.length !== 2 ||
          !Array.isArray(payload[1]) ||
          payload[1].some(
            (row) => !row || typeof row !== 'object' || Array.isArray(row),
          )
        )
          throw new Error(
            'World Bank API returned an invalid observation payload',
          );
        if (attempt > 1)
          this.logger.log(
            `World Bank API recovered on attempt ${attempt}/${REQUEST_ATTEMPTS} after ${Date.now() - started}ms: ${url.pathname}`,
          );
        return payload[1] as WorldBankObservation[];
      } catch (error) {
        this.logger.warn(
          `World Bank API attempt ${attempt}/${REQUEST_ATTEMPTS} failed after ${Date.now() - started}ms: ${url.pathname}: ${error instanceof Error ? error.message : 'unknown error'}`,
        );
        if (!retryable || attempt === REQUEST_ATTEMPTS) throw error;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
    throw new Error('World Bank API unavailable');
  }

  getCriteria(
    plan: ResearchQueryPlan,
    query: string,
  ): WorldBankQueryCriteria | undefined {
    if (!this.isRequested(plan, query)) return undefined;
    // Country-level series cannot satisfy a province/city query.
    if (plan.regions.length) return undefined;
    const indicators = this.resolveIndicators(plan, query);
    if (indicators.length === 0) return undefined;
    const { start, end } = this.resolvePeriod(plan.timeRanges, query);
    const countries = this.resolveCountries(plan.countries, query);
    // Never silently substitute world totals for an unrecognized country.
    if (!countries.length || start > end || end - start >= 100)
      return undefined;
    return {
      countries,
      indicatorCodes: indicators.map((indicator) => indicator.code),
      start,
      end,
    };
  }

  private resolveIndicators(plan: ResearchQueryPlan, query: string) {
    // Keep the original question in scope: a planner can return a broad alias
    // such as "GDP" even when the user explicitly asked for growth.
    const texts = [...plan.indicators, query];
    const asksForGrowth = /增速|增长率|同比|growth|real\s+gdp/i.test(query);
    const asksForLevel = /总量|现价|名义|金额|current\s+us\$|gdp\s+level/i.test(
      query,
    );
    const codes = new Set(
      texts.flatMap((text) => {
        const matches = INDICATORS.filter((indicator) =>
          indicator.pattern.test(text),
        );
        return matches
          .filter((indicator) => {
            if (indicator.code === 'NY.GDP.MKTP.CD')
              return (
                (!asksForGrowth || asksForLevel) &&
                !/人均|per\s*capita|增长|增速|growth|不变价|constant|实际|real/i.test(
                  text,
                )
              );
            if (indicator.code === 'NY.GDP.MKTP.KD.ZG')
              return asksForGrowth || !asksForLevel;
            if (indicator.code === 'SP.POP.TOTL')
              return !/增长|出生|自然|growth|birth/i.test(text);
            return true;
          })
          .map((indicator) => indicator.code);
      }),
    );
    return INDICATORS.filter((indicator) => codes.has(indicator.code));
  }

  private resolveCountries(countries: string[], query: string): string[] {
    const codes = countries
      .map((country) => {
        const name = country.trim();
        if (/^(全球|世界|world|global|wld)$/i.test(name)) return 'WLD';
        return (
          COUNTRY_CODES[name.toLowerCase()] ??
          Object.values(COUNTRY_CODES).find(
            (code) => code === name.toUpperCase(),
          )
        );
      })
      .filter((code): code is string => Boolean(code));
    if (codes.length) return [...new Set(codes)];
    // Explicit unsupported countries must not be replaced using page text.
    if (countries.length) return [];
    const inferred = Object.entries(COUNTRY_CODES)
      .filter(([name]) =>
        /[\u4e00-\u9fff]/.test(name)
          ? query.includes(name)
          : new RegExp(`\\b${name}\\b`, 'i').test(query),
      )
      .map(([, code]) => code);
    if (inferred.length) return [...new Set(inferred)];
    return /全球|世界|\bworld\b|\bglobal\b/i.test(
      query.replace(/world\s*bank|世界银行/gi, ''),
    )
      ? ['WLD']
      : [];
  }

  private resolvePeriod(timeRanges: string[], query: string) {
    const recent = periodsFromRecentYearPhrase(query);
    if (recent) return { start: Number(recent[0]), end: Number(recent.at(-1)) };
    const match = timeRanges
      .map((value) => value.match(/(20\d{2})\D+(20\d{2})/))
      .find((value): value is RegExpMatchArray => Boolean(value));
    if (match) return { start: Number(match[1]), end: Number(match[2]) };
    const years = (timeRanges.length ? timeRanges : [query]).flatMap(
      (value) => value.match(/[12]\d{3}/g) ?? [],
    );
    if (years.length)
      return {
        start: Math.min(...years.map(Number)),
        end: Math.max(...years.map(Number)),
      };
    const year = new Date().getUTCFullYear();
    return { start: year - 4, end: year };
  }
}
