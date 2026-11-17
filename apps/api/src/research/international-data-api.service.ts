import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parse as csvParse } from 'csv-parse/sync';
import {
  countryCode,
  inferQueryCountries,
} from '../common/utils/query-countries';
import type { ResearchQueryPlan } from '../modules/search/research-query-plan';
import type { ExaResult } from './research.types';

type PlannedSource = { websiteUrl: string; query: string };
type Provider = 'imf' | 'oecd' | 'eurostat' | 'un-comtrade' | 'un-sdg' | 'who';
type Country = { iso3: string; iso2: string; m49: string; name: string };
type Indicator = { pattern: RegExp; code: string; label: string; unit: string };

const COUNTRIES: Country[] = [
  { iso3: 'CHN', iso2: 'CN', m49: '156', name: 'China' },
  { iso3: 'USA', iso2: 'US', m49: '840', name: 'United States' },
  { iso3: 'GBR', iso2: 'UK', m49: '826', name: 'United Kingdom' },
  { iso3: 'FRA', iso2: 'FR', m49: '250', name: 'France' },
  { iso3: 'DEU', iso2: 'DE', m49: '276', name: 'Germany' },
  { iso3: 'JPN', iso2: 'JP', m49: '392', name: 'Japan' },
  { iso3: 'IND', iso2: 'IN', m49: '356', name: 'India' },
  { iso3: 'IDN', iso2: 'ID', m49: '360', name: 'Indonesia' },
  { iso3: 'KOR', iso2: 'KR', m49: '410', name: 'South Korea' },
  { iso3: 'CAN', iso2: 'CA', m49: '124', name: 'Canada' },
  { iso3: 'AUS', iso2: 'AU', m49: '036', name: 'Australia' },
  { iso3: 'BRA', iso2: 'BR', m49: '076', name: 'Brazil' },
  { iso3: 'MEX', iso2: 'MX', m49: '484', name: 'Mexico' },
  { iso3: 'ZAF', iso2: 'ZA', m49: '710', name: 'South Africa' },
  { iso3: 'ITA', iso2: 'IT', m49: '380', name: 'Italy' },
  { iso3: 'ESP', iso2: 'ES', m49: '724', name: 'Spain' },
  { iso3: 'RUS', iso2: 'RU', m49: '643', name: 'Russia' },
  { iso3: 'TUR', iso2: 'TR', m49: '792', name: 'Türkiye' },
  { iso3: 'SAU', iso2: 'SA', m49: '682', name: 'Saudi Arabia' },
  { iso3: 'SGP', iso2: 'SG', m49: '702', name: 'Singapore' },
];

const IMF_INDICATORS: Indicator[] = [
  {
    pattern: /人均.{0,8}gdp|gdp.{0,8}per capita/i,
    code: 'NGDPDPC',
    label: 'GDP per capita, current prices',
    unit: 'USD/person',
  },
  {
    pattern: /gdp.{0,10}(增长|增速|growth)|增长.{0,8}gdp/i,
    code: 'NGDP_RPCH',
    label: 'Real GDP growth',
    unit: '%',
  },
  {
    pattern: /cpi|通胀|通货膨胀|inflation|consumer price/i,
    code: 'PCPIPCH',
    label: 'Inflation, average consumer prices',
    unit: '%',
  },
  {
    pattern: /人口|population/i,
    code: 'LP',
    label: 'Population',
    unit: 'million people',
  },
  {
    pattern: /gdp|国内生产总值/i,
    code: 'NGDPD',
    label: 'GDP, current prices',
    unit: 'USD billion',
  },
];

const WHO_INDICATORS: Indicator[] = [
  {
    pattern: /预期寿命|life expectancy/i,
    code: 'WHOSIS_000001',
    label: 'Life expectancy at birth',
    unit: 'years',
  },
  {
    pattern: /健康预期寿命|healthy life expectancy/i,
    code: 'WHOSIS_000002',
    label: 'Healthy life expectancy at birth',
    unit: 'years',
  },
  {
    pattern: /五岁以下死亡|under.?five mortality/i,
    code: 'MDG_0000000007',
    label: 'Under-five mortality rate',
    unit: 'per 1,000 live births',
  },
  {
    pattern: /孕产妇死亡|maternal mortality/i,
    code: 'MDG_0000000026',
    label: 'Maternal mortality ratio',
    unit: 'per 100,000 live births',
  },
];

const SDG_INDICATORS: Indicator[] = [
  {
    pattern: /人均.{0,8}gdp|gdp.{0,8}per capita/i,
    code: 'NY_GDP_PCAP',
    label: 'Annual growth rate of real GDP per capita',
    unit: '%',
  },
  {
    pattern: /五岁以下死亡|under.?five mortality/i,
    code: 'SH_DYN_MORT',
    label: 'Under-five mortality rate',
    unit: 'per 1,000 live births',
  },
  {
    pattern: /孕产妇死亡|maternal mortality/i,
    code: 'SH_STA_MORT',
    label: 'Maternal mortality ratio',
    unit: 'per 100,000 live births',
  },
  {
    pattern: /失业率|unemployment rate/i,
    code: 'SL_UEM_TOTL',
    label: 'Unemployment rate',
    unit: '%',
  },
];

const EUROSTAT_CPI: Indicator = {
  pattern: /cpi|居民消费价格|通货膨胀|inflation|consumer price/i,
  code: 'cpi_inflation',
  label: 'Harmonised index of consumer prices, annual rate of change',
  unit: '%',
};

const ISO3_CATALOG_CODES: Record<string, string> = {
  NGDP_RPCH: 'gdp_real_growth',
  PCPIPCH: 'cpi_inflation',
  NGDPD: 'gdp_current_usd',
  NGDPDPC: 'gdp_per_capita',
  LP: 'population_total',
  WHOSIS_000001: 'life_expectancy',
  WHOSIS_000002: 'healthy_life_expectancy',
  MDG_0000000007: 'under_five_mortality',
  MDG_0000000026: 'maternal_mortality',
  NY_GDP_PCAP: 'gdp_real_growth',
  SH_DYN_MORT: 'under_five_mortality',
  SH_STA_MORT: 'maternal_mortality',
  SL_UEM_TOTL: 'unemployment_rate',
  cpi_inflation: 'cpi_inflation',
  trade_imports_usd: 'trade_imports_usd',
  trade_exports_usd: 'trade_exports_usd',
};

/** Query only APIs belonging to sources explicitly selected by the research planner. */
@Injectable()
export class InternationalDataApiService {
  private readonly logger = new Logger(InternationalDataApiService.name);
  private readonly timeoutMs: number;
  private readonly comtradeKey: string;
  private readonly oecdTemplates: Record<string, string>;
  private readonly cache = new Map<
    string,
    { expiresAt: number; data: unknown }
  >();

  constructor(private readonly config: ConfigService) {
    this.timeoutMs = Math.max(
      2_000,
      config.get<number>('INTERNATIONAL_API_TIMEOUT_MS') ?? 12_000,
    );
    this.comtradeKey = config.get<string>('UN_COMTRADE_API_KEY')?.trim() ?? '';
    this.oecdTemplates = this.parseOecdTemplates(
      config.get<string>('OECD_SDMX_QUERY_TEMPLATES_JSON'),
    );
  }

  async retrieve(
    sources: PlannedSource[],
    query: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const selected = new Map<Provider, PlannedSource[]>();
    for (const source of sources) {
      const provider = this.providerFor(source.websiteUrl);
      if (!provider) continue;
      selected.set(provider, [...(selected.get(provider) ?? []), source]);
    }
    const tasks = [...selected.entries()].map(async ([provider, planned]) => {
      const sourceQuery = planned.map((item) => item.query).join(' ');
      switch (provider) {
        case 'imf':
          return this.imf(query, sourceQuery, plan);
        case 'oecd':
          return this.oecd(query, sourceQuery, plan);
        case 'eurostat':
          return this.eurostat(query, sourceQuery, plan);
        case 'un-comtrade':
          return this.comtrade(query, sourceQuery, plan);
        case 'un-sdg':
          return this.unSdg(query, sourceQuery, plan);
        case 'who':
          return this.who(query, sourceQuery, plan);
      }
    });
    const settled = await Promise.allSettled(tasks);
    return settled.flatMap((item, index) => {
      if (item.status === 'fulfilled') return item.value;
      const provider = [...selected.keys()][index];
      this.logger.warn(
        `${provider} API retrieval failed: ${this.errorMessage(item.reason)}`,
      );
      return [];
    });
  }

  private providerFor(value: string): Provider | undefined {
    let hostname: string;
    try {
      hostname = new URL(value).hostname.toLowerCase();
    } catch {
      return undefined;
    }
    if (hostname === 'imf.org' || hostname.endsWith('.imf.org')) return 'imf';
    if (hostname === 'oecd.org' || hostname.endsWith('.oecd.org'))
      return 'oecd';
    if (hostname === 'europa.eu' || hostname.endsWith('.europa.eu'))
      return 'eurostat';
    if (
      hostname === 'un.org' ||
      hostname.endsWith('.un.org') ||
      hostname === 'comtrade.un.org'
    ) {
      if (/comtrade/i.test(value)) return 'un-comtrade';
      if (/unstats\.un\.org|sdgapi/i.test(value)) return 'un-sdg';
    }
    if (
      hostname === 'who.int' ||
      hostname.endsWith('.who.int') ||
      hostname === 'ghoapi.azureedge.net'
    )
      return 'who';
    return undefined;
  }

  private async imf(
    query: string,
    sourceQuery: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const countries = this.countries(query, plan).map(
      (country) => country.iso3,
    );
    if (!countries.length) return [];
    const years = this.years(plan);
    const requested = `${query} ${sourceQuery} ${plan.metrics.join(' ')}`;
    const indicators = this.selectIndicators(IMF_INDICATORS, requested);
    const responses = await Promise.allSettled(
      indicators.map(async (indicator) => {
        const url = `https://www.imf.org/external/datamapper/api/v1/${indicator.code}`;
        const payload = await this.json(url);
        const values =
          (
            payload as {
              values?: Record<
                string,
                Record<string, Record<string, number | null>>
              >;
            }
          )?.values?.[indicator.code] ?? {};
        const rows = countries.flatMap((countryCode) =>
          Object.entries(values[countryCode] ?? {})
            .filter(
              ([year, value]) =>
                years.includes(year) &&
                typeof value === 'number' &&
                Number.isFinite(value),
            )
            .map(([year, value]) =>
              this.row({
                provider: 'imf-api',
                countryCode,
                country: this.country(countryCode)?.name ?? countryCode,
                year: Number(year),
                indicatorCode: indicator.code,
                catalogIndicatorCode: ISO3_CATALOG_CODES[indicator.code],
                indicator: indicator.label,
                unit: indicator.unit,
                value: value as number,
              }),
            ),
        );
        return this.result(
          'imf-api',
          `IMF DataMapper · ${indicator.label}`,
          url,
          rows,
        );
      }),
    );
    return responses.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
  }

  private async oecd(
    query: string,
    sourceQuery: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const templates = this.oecdTemplates;
    if (!Object.keys(templates).length) {
      this.logger.debug(
        'OECD SDMX adapter needs OECD_SDMX_QUERY_TEMPLATES_JSON with a documented dataflow and dimension key.',
      );
      return [];
    }
    const countries = this.countries(query, plan);
    const years = this.years(plan);
    const requested =
      `${query} ${sourceQuery} ${plan.metrics.join(' ')}`.toLowerCase();
    const matching = Object.entries(templates)
      .filter(([pattern]) => requested.includes(pattern.toLowerCase()))
      .slice(0, 2);
    const responses = await Promise.allSettled(
      matching.map(async ([, template]) => {
        const url = new URL(
          template
            .replaceAll('{start}', years[0] ?? '')
            .replaceAll('{end}', years.at(-1) ?? ''),
        );
        if (
          url.protocol !== 'https:' ||
          !['sdmx.oecd.org', 'stats.oecd.org'].includes(url.hostname)
        )
          return undefined;
        const payload = await this.csv(url.toString());
        const rows = payload.flatMap((item) => {
          const row = this.normalizeCsvRow(item, countries, years, 'oecd-api');
          return row ? [row] : [];
        });
        return this.result(
          'oecd-api',
          `OECD SDMX · ${matching.find((entry) => entry[1] === template)?.[0] ?? '统计序列'}`,
          url.toString(),
          rows,
        );
      }),
    );
    return responses.flatMap((item) =>
      item.status === 'fulfilled' && item.value ? [item.value] : [],
    );
  }

  private async eurostat(
    query: string,
    sourceQuery: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const requested = `${query} ${sourceQuery} ${plan.metrics.join(' ')}`;
    if (!EUROSTAT_CPI.pattern.test(requested)) return [];
    const countries = this.countries(query, plan).filter((country) =>
      this.isEuCountry(country.iso2),
    );
    if (!countries.length) return [];
    const years = this.years(plan);
    const responses = await Promise.allSettled(
      countries.map(async (country) => {
        const url = new URL(
          'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_aind',
        );
        url.searchParams.set('freq', 'A');
        url.searchParams.set('unit', 'RCH_A_AVG');
        url.searchParams.set('coicop', 'CP00');
        url.searchParams.set('geo', country.iso2);
        url.searchParams.set('sinceTimePeriod', years[0] ?? '');
        url.searchParams.set('untilTimePeriod', years.at(-1) ?? '');
        const payload = (await this.json(url.toString())) as EurostatDataset;
        const rows = this.eurostatRows(payload, years).map((row) =>
          this.row({
            provider: 'eurostat-api',
            countryCode: country.iso3,
            country: country.name,
            year: row.year,
            indicatorCode: 'cpi_inflation',
            catalogIndicatorCode: 'cpi_inflation',
            indicator: EUROSTAT_CPI.label,
            unit: '%',
            value: row.value,
          }),
        );
        return this.result(
          'eurostat-api',
          `Eurostat · ${EUROSTAT_CPI.label}`,
          url.toString(),
          rows,
        );
      }),
    );
    return responses.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
  }

  private async comtrade(
    query: string,
    sourceQuery: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const requested = `${query} ${sourceQuery} ${plan.metrics.join(' ')}`;
    const wantsImports = /进口|进口额|imports?|import value/i.test(requested);
    const wantsExports = /出口|出口额|exports?|export value/i.test(requested);
    const wantsTrade = /贸易|trade/i.test(requested);
    if (!wantsImports && !wantsExports && !wantsTrade) return [];
    const countries = this.countries(query, plan);
    if (!countries.length) return [];
    const years = this.years(plan).slice(-5);
    const flows =
      wantsTrade && !wantsImports && !wantsExports
        ? ['M', 'X']
        : [wantsImports ? 'M' : 'X'];
    const requests = countries.slice(0, 5).flatMap((country) =>
      flows.map(async (flow) => {
        const url = new URL(
          'https://comtradeapi.un.org/public/v1/preview/C/A/HS',
        );
        url.searchParams.set('reporterCode', country.m49);
        url.searchParams.set('period', years.join(','));
        url.searchParams.set('cmdCode', 'TOTAL');
        url.searchParams.set('flowCode', flow);
        url.searchParams.set('partnerCode', '0');
        url.searchParams.set('partner2Code', '0');
        if (this.comtradeKey)
          url.searchParams.set('subscription-key', this.comtradeKey);
        const payload = (await this.json(url.toString())) as {
          data?: Array<Record<string, unknown>>;
        };
        const code = flow === 'M' ? 'trade_imports_usd' : 'trade_exports_usd';
        const label =
          flow === 'M' ? 'Merchandise imports' : 'Merchandise exports';
        const rows = (payload.data ?? []).flatMap((item) => {
          const value = Number(item.primaryValue);
          const year = Number(item.period);
          if (!Number.isFinite(value) || !years.includes(String(year)))
            return [];
          return [
            this.row({
              provider: 'un-comtrade-api',
              countryCode: country.iso3,
              country: country.name,
              year,
              indicatorCode: code,
              catalogIndicatorCode: code,
              indicator: label,
              unit: 'USD',
              value,
            }),
          ];
        });
        return this.result(
          'un-comtrade-api',
          `UN Comtrade · ${label}`,
          url.toString(),
          rows,
        );
      }),
    );
    const settled = await Promise.allSettled(requests);
    return settled.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
  }

  private async unSdg(
    query: string,
    sourceQuery: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const countries = this.countries(query, plan);
    if (!countries.length) return [];
    const requested = `${query} ${sourceQuery} ${plan.metrics.join(' ')}`;
    const indicators = this.selectIndicators(SDG_INDICATORS, requested);
    if (!indicators.length) return [];
    const years = this.years(plan);
    const requests = countries.slice(0, 5).flatMap((country) =>
      indicators.map(async (indicator) => {
        const url = new URL('https://unstats.un.org/SDGAPI/v1/sdg/Series/Data');
        url.searchParams.set('seriesCode', indicator.code);
        url.searchParams.set('areaCode', country.m49);
        if (years.length) {
          url.searchParams.set('timePeriodStart', years[0]);
          url.searchParams.set('timePeriodEnd', years.at(-1)!);
        }
        const payload = (await this.json(url.toString())) as {
          data?: Array<Record<string, unknown>>;
        };
        const rows = (payload.data ?? []).flatMap((item) => {
          const value = Number(item.value);
          const year = Math.trunc(Number(item.timePeriodStart));
          if (!Number.isFinite(value) || !years.includes(String(year)))
            return [];
          const unit = String(
            (item.attributes as Record<string, unknown> | undefined)?.Units ??
              indicator.unit,
          );
          return [
            this.row({
              provider: 'un-sdg-api',
              countryCode: country.iso3,
              country: country.name,
              year,
              indicatorCode: indicator.code,
              catalogIndicatorCode: ISO3_CATALOG_CODES[indicator.code],
              indicator: indicator.label,
              unit,
              value,
            }),
          ];
        });
        return this.result(
          'un-sdg-api',
          `UN SDG · ${indicator.label}`,
          url.toString(),
          rows,
        );
      }),
    );
    const settled = await Promise.allSettled(requests);
    return settled.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
  }

  private async who(
    query: string,
    sourceQuery: string,
    plan: ResearchQueryPlan,
  ): Promise<ExaResult[]> {
    const countries = this.countries(query, plan);
    if (!countries.length) return [];
    const requested = `${query} ${sourceQuery} ${plan.metrics.join(' ')}`;
    const indicators = this.selectIndicators(WHO_INDICATORS, requested);
    if (!indicators.length) return [];
    const years = this.years(plan);
    const requests = countries.slice(0, 5).flatMap((country) =>
      indicators.map(async (indicator) => {
        const url = new URL(
          `https://ghoapi.azureedge.net/api/${indicator.code}`,
        );
        const yearFilter = years.length
          ? ` and TimeDim ge ${years[0]} and TimeDim le ${years.at(-1)}`
          : '';
        url.searchParams.set(
          '$filter',
          `SpatialDim eq '${country.iso3}'${yearFilter}`,
        );
        url.searchParams.set('$top', '1000');
        const payload = (await this.json(url.toString())) as {
          value?: Array<Record<string, unknown>>;
        };
        const data = payload.value ?? [];
        const bothSex = data.filter((item) => item.Dim1 === 'SEX_BTSX');
        const selected = bothSex.length
          ? bothSex
          : data.filter((item) => !item.Dim1 || item.Dim1 === 'SEX_BTSX');
        const rows = selected.flatMap((item) => {
          const year = Number(item.TimeDim);
          const value = Number(item.NumericValue);
          if (!Number.isFinite(value) || !years.includes(String(year)))
            return [];
          return [
            this.row({
              provider: 'who-api',
              countryCode: country.iso3,
              country: country.name,
              year,
              indicatorCode: indicator.code,
              catalogIndicatorCode: ISO3_CATALOG_CODES[indicator.code],
              indicator: indicator.label,
              unit: indicator.unit,
              value,
            }),
          ];
        });
        return this.result(
          'who-api',
          `WHO GHO · ${indicator.label}`,
          url.toString(),
          rows,
        );
      }),
    );
    const settled = await Promise.allSettled(requests);
    return settled.flatMap((item) =>
      item.status === 'fulfilled' ? [item.value] : [],
    );
  }

  private countries(query: string, plan: ResearchQueryPlan): Country[] {
    const requested = new Set(
      [...inferQueryCountries(query), ...plan.entities]
        .map(
          (name) =>
            countryCode(name) ??
            COUNTRIES.find(
              (country) => country.name.toLowerCase() === name.toLowerCase(),
            )?.iso3,
        )
        .filter((code): code is string => Boolean(code)),
    );
    return COUNTRIES.filter((country) => requested.has(country.iso3));
  }

  private country(code: string) {
    return COUNTRIES.find((item) => item.iso3 === code);
  }

  private years(plan: ResearchQueryPlan): string[] {
    const explicit = [
      ...new Set(plan.periods.filter((period) => /^\d{4}$/.test(period))),
    ].sort();
    if (explicit.length) return explicit.slice(-10);
    const end = new Date().getFullYear() - 1;
    return Array.from({ length: 5 }, (_, index) => String(end - 4 + index));
  }

  private selectIndicators(
    indicators: Indicator[],
    requested: string,
  ): Indicator[] {
    return indicators
      .filter((indicator) => indicator.pattern.test(requested))
      .slice(0, 3);
  }

  private row(input: {
    provider: string;
    countryCode: string;
    country: string;
    year: number;
    indicatorCode: string;
    catalogIndicatorCode?: string;
    indicator: string;
    unit: string;
    value: number;
  }): Record<string, unknown> {
    return {
      ...input,
      source: input.provider,
      retrievedAt: new Date().toISOString(),
    };
  }

  private result(
    provider: string,
    title: string,
    url: string,
    rows: Record<string, unknown>[],
  ): ExaResult {
    const content = rows
      .map(
        (row) =>
          `${row.country} ${row.year} ${row.indicator} ${row.value} ${row.unit}`,
      )
      .join('\n');
    return {
      title,
      url,
      description: content.slice(0, 12_000) || title,
      extraSnippets: [],
      score: 1,
      officialProvider: provider,
      officialData: rows,
    };
  }

  private async json(url: string): Promise<unknown> {
    const cached = this.cache.get(url);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`API returned ${response.status}`);
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 8_000_000) {
      await response.body?.cancel();
      throw new Error('API response exceeds 8 MB');
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 8_000_000)
      throw new Error('API response exceeds 8 MB');
    const data: unknown = JSON.parse(text);
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(url, { expiresAt: Date.now() + 6 * 60 * 60_000, data });
    return data;
  }

  private async csv(url: string): Promise<Record<string, string>[]> {
    const response = await fetch(url, {
      headers: { Accept: 'text/csv' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`OECD SDMX API returned ${response.status}`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text) > 8_000_000)
      throw new Error('OECD SDMX response exceeds 8 MB');
    return csvParse(text, {
      columns: true,
      skip_empty_lines: true,
      to: 20_000,
    }) as Record<string, string>[];
  }

  private normalizeCsvRow(
    item: Record<string, string>,
    countries: Country[],
    years: string[],
    provider: string,
  ) {
    const countryCode = String(
      item.REF_AREA ?? item.LOCATION ?? item.COUNTRY ?? item.GEO ?? '',
    ).toUpperCase();
    const country = countries.find(
      (value) => value.iso3 === countryCode || value.iso2 === countryCode,
    );
    const year = Number(
      item.TIME_PERIOD ?? item.TIME ?? item.PERIOD ?? item.YEAR,
    );
    const value = Number(item.OBS_VALUE ?? item.VALUE ?? item.Value);
    if (!country || !years.includes(String(year)) || !Number.isFinite(value))
      return null;
    return this.row({
      provider,
      countryCode: country.iso3,
      country: country.name,
      year,
      indicatorCode: String(item.MEASURE ?? item.SUBJECT ?? 'oecd_observation'),
      catalogIndicatorCode:
        ISO3_CATALOG_CODES[String(item.MEASURE ?? item.SUBJECT ?? '')],
      indicator: String(
        item.INDICATOR ?? item.SUBJECT ?? item.MEASURE ?? 'OECD observation',
      ),
      unit: String(item.UNIT_MEASURE ?? item.UNIT ?? ''),
      value,
    });
  }

  private eurostatRows(payload: EurostatDataset, years: string[]) {
    const timeDimension = payload.id.indexOf('time');
    const geoDimension = payload.id.indexOf('geo');
    const unitDimension = payload.id.indexOf('unit');
    if (timeDimension < 0 || geoDimension < 0 || unitDimension < 0) return [];
    const sizes = payload.size;
    return Object.entries(payload.value ?? []).flatMap(([key, raw]) => {
      const indices = new Array(sizes.length).fill(0);
      let index = Number(key);
      for (let dimension = sizes.length - 1; dimension >= 0; dimension -= 1) {
        indices[dimension] = index % sizes[dimension];
        index = Math.floor(index / sizes[dimension]);
      }
      const time = this.categoryAt(
        payload,
        timeDimension,
        indices[timeDimension],
      );
      const geo = this.categoryAt(payload, geoDimension, indices[geoDimension]);
      const unit = this.categoryAt(
        payload,
        unitDimension,
        indices[unitDimension],
      );
      const value = Number(raw);
      return years.includes(time) &&
        unit === 'RCH_A_AVG' &&
        Number.isFinite(value)
        ? [{ year: Number(time), geo, value }]
        : [];
    });
  }

  private categoryAt(
    payload: EurostatDataset,
    dimension: number,
    index: number,
  ): string {
    const id = payload.id[dimension];
    const categories = payload.dimension[id]?.category?.index ?? {};
    return (
      Object.keys(categories).find((key) => categories[key] === index) ?? ''
    );
  }

  private isEuCountry(iso2: string): boolean {
    return new Set([
      'AT',
      'BE',
      'BG',
      'HR',
      'CY',
      'CZ',
      'DK',
      'EE',
      'FI',
      'FR',
      'DE',
      'GR',
      'HU',
      'IE',
      'IT',
      'LV',
      'LT',
      'LU',
      'MT',
      'NL',
      'PL',
      'PT',
      'RO',
      'SK',
      'SI',
      'ES',
      'SE',
      'IS',
      'LI',
      'NO',
      'CH',
    ]).has(iso2);
  }

  private parseOecdTemplates(raw?: string): Record<string, string> {
    if (!raw) return {};
    try {
      const value: unknown = JSON.parse(raw);
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
      return Object.fromEntries(
        Object.entries(value).filter(
          ([, template]) =>
            typeof template === 'string' &&
            template.startsWith('https://sdmx.oecd.org/public/rest/v1/data/'),
        ),
      ) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }
}

type EurostatDataset = {
  id: string[];
  size: number[];
  value?: Record<string, number>;
  dimension: Record<string, { category?: { index?: Record<string, number> } }>;
};
