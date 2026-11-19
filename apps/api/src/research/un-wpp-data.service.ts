import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import { pipeline } from 'node:stream/promises';
import { QUERY_COUNTRIES } from '../common/utils/query-countries';
import { StructuredDataStore } from './structured-data-store';
import type { SourceEntity } from './research.types';
import { WPP_METRICS } from './population-metrics';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

export const WPP_2024_SHA256 =
  '286ac36bb1415e2e1ade03acfef0a29f0e4c087e2f78e38c48f50c5df89082bc';
export const WPP_2024_URL =
  'https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz';

type AnnualRow = {
  country: string;
  countryCode: string;
  year: number;
  variant: string;
} & Record<string, unknown>;

export function isWppSource(source: SourceEntity): boolean {
  try {
    const url = new URL(source.sourceUrl ?? '');
    return (
      source.origin === 'exa' &&
      url.protocol === 'https:' &&
      url.hostname === 'population.un.org' &&
      ![
        ...(source.title + ' ' + url.pathname).matchAll(/wpp\s*(20\d{2})/gi),
      ].some((match) => match[1] !== '2024') &&
      /^\/wpp(?:\/|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

@Injectable()
export class UnWppDataService {
  private readonly logger = new Logger(UnWppDataService.name);
  private readonly store: StructuredDataStore;

  constructor(prisma?: PrismaService) {
    this.store = new StructuredDataStore(
      undefined,
      undefined,
      (message) => this.logger.warn(message),
      prisma,
    );
  }

  async hydrateSources(
    sources: SourceEntity[],
    query: string,
    entities: string[],
    periods: string[],
    enabledCodes: string[],
  ): Promise<SourceEntity[]> {
    const editions = [
      ...query.matchAll(
        /(?:wpp|世界人口展望|world\s+population\s+prospects)[》」”\s]*(20\d{2})/gi,
      ),
    ];
    if (editions.some((match) => match[1] !== '2024')) return sources;
    const candidates = sources.filter(
      (source) =>
        isWppSource(source) &&
        (source.structuredData == null ||
          (Array.isArray(source.structuredData) &&
            !source.structuredData.length)),
    );
    const metrics = WPP_METRICS.filter(
      (metric) =>
        metric.pattern.test(query) && enabledCodes.includes(metric.code),
    );
    const countries = QUERY_COUNTRIES.filter(([code, ...aliases]) =>
      entities.some((entity) =>
        [code, ...aliases].some(
          (alias) => alias.toLowerCase() === entity.toLowerCase(),
        ),
      ),
    ).map(([code, name]) => ({ code, name }));
    const years = periods
      .map(Number)
      .filter((year) => Number.isInteger(year) && year >= 1950 && year <= 2100);
    if (
      !candidates.length ||
      !metrics.length ||
      !countries.length ||
      !years.length
    )
      return sources;
    // Never silently substitute the medium scenario for another explicitly requested variant.
    if (
      /高(?:方案|情景|变体)|低(?:方案|情景|变体)|high\s*(?:variant|fertility|scenario)|low\s*(?:variant|fertility|scenario)|constant\s*fertility|不变生育|恒定生育|零迁移|zero\s*migration/i.test(
        query,
      )
    )
      return sources;
    const countryCodes = [
      ...new Set(countries.map((country) => country.code)),
    ].sort();
    const selectedYears = [...new Set(years)].sort((a, b) => a - b);
    try {
      const key = this.store.fingerprint({
        provider: 'un-wpp-2024-medium-v1',
        countries: countryCodes,
        years: selectedYears,
      });
      const annual = await this.store.getOrLoad(
        'remote',
        key,
        () => this.download(countryCodes, selectedYears),
        (data) =>
          data.length === countryCodes.length * selectedYears.length &&
          data.every((row) =>
            metrics.every((metric) => typeof row[metric.column] === 'number'),
          ),
      );
      const rows = annual.flatMap((row) =>
        metrics.flatMap((metric) => {
          const raw = row[metric.column];
          if (typeof raw !== 'number' || !Number.isFinite(raw)) return [];
          return [
            {
              country:
                countries.find((country) => country.code === row.countryCode)
                  ?.name ?? row.country,
              countryCode: row.countryCode,
              year: row.year,
              indicator: metric.name,
              indicatorCode: metric.code,
              value: Number((raw * metric.factor).toFixed(6)),
              unit: metric.unit,
              sourceUrl: WPP_2024_URL,
              sourceColumn: metric.column,
              sourceValue: raw,
              sourceFileUnit: metric.factor === 1000 ? '千人' : '子女/妇女',
              revision: 'WPP 2024',
              variant: row.variant,
              estimateType: row.year <= 2023 ? 'estimate' : 'projection',
            },
          ];
        }),
      );
      if (!rows.length)
        throw new Error(
          'official file contained no matching numeric observations',
        );
      this.logger.log(
        `UN WPP 2024 hydration: countries=${countryCodes.join(',')} years=${selectedYears[0]}-${selectedYears.at(-1)} observations=${rows.length}`,
      );
      const ownerId = candidates[0].id;
      return sources.map((source) =>
        source.id === ownerId
          ? {
              ...source,
              storageType: 'structured',
              mimeType: 'application/json',
              structuredData: rows,
              recordCount: rows.length,
              metadata: {
                ...source.metadata,
                analysisProvider: 'un-wpp-2024',
                officialDataUnavailable: false,
                officialDataUrl: WPP_2024_URL,
              },
            }
          : source,
      );
    } catch (error) {
      this.logger.warn(`UN WPP 2024 hydration failed: ${String(error)}`);
      return sources.map((source) =>
        candidates.some((candidate) => candidate.id === source.id)
          ? {
              ...source,
              metadata: { ...source.metadata, officialDataUnavailable: true },
            }
          : source,
      );
    }
  }

  /** A version-pinned official file can be prewarmed where international downloads are slow. */
  private async verifiedLocalFile(): Promise<string | undefined> {
    if (process.env.NODE_ENV === 'test') return undefined;
    const file = resolve(
      process.env.OFFICIAL_DATA_CACHE_DIR || 'storage/official-data',
      'WPP2024_Demographic_Indicators_Medium.csv.gz',
    );
    try {
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
      if (hash.digest('hex') === WPP_2024_SHA256) return file;
      this.logger.warn(
        'Cached UN WPP 2024 file checksum mismatch; using the official download',
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        this.logger.warn(
          'Cached UN WPP 2024 file unreadable; using the official download',
        );
    }
    return undefined;
  }

  /** Stream the official gzip CSV; keep only the requested countries/years in memory. */
  async download(countries: string[], years: number[]): Promise<AnnualRow[]> {
    const cached = await this.verifiedLocalFile();
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const deadline = AbortSignal.timeout(60_000);
        let input: Readable;
        if (cached) input = createReadStream(cached);
        else {
          const response = await fetch(WPP_2024_URL, {
            signal: deadline,
            redirect: 'error',
          });
          if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error(`official CSV HTTP ${response.status}`);
          }
          input = Readable.fromWeb(response.body as never);
        }
        const selectedCountries = new Set(countries);
        const selectedYears = new Set(years);
        const rows: AnnualRow[] = [];
        let bytes = 0;
        const limit = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.length;
            callback(
              bytes > 256 * 1024 * 1024
                ? new Error('official CSV exceeds size limit')
                : null,
              chunk,
            );
          },
        });
        const parser = parse({
          bom: true,
          columns: (headers: string[]) => {
            const required = [
              'ISO3_code',
              'Location',
              'Time',
              'Variant',
              'VarID',
              ...WPP_METRICS.map((metric) => metric.column),
            ];
            if (required.some((column) => !headers.includes(column)))
              throw new Error('official CSV schema mismatch');
            return headers;
          },
          skip_empty_lines: true,
          max_record_size: 64 * 1024,
        });
        await pipeline(
          input,
          createGunzip(),
          limit,
          parser,
          async (records) => {
            const seen = new Set<string>();
            for await (const record of records) {
              if (
                !selectedCountries.has(record.ISO3_code) ||
                !selectedYears.has(Number(record.Time))
              )
                continue;
              if (record.Variant !== 'Medium' || record.VarID !== '2') continue;
              const key = `${record.ISO3_code}/${record.Time}`;
              if (seen.has(key))
                throw new Error(
                  `duplicate country/year in official CSV: ${key}`,
                );
              seen.add(key);
              const row: AnnualRow = {
                country: record.Location,
                countryCode: record.ISO3_code,
                year: Number(record.Time),
                variant: 'Medium',
              };
              for (const metric of WPP_METRICS) {
                const raw = String(record[metric.column] ?? '').trim();
                if (
                  raw &&
                  /^-?\d+(?:\.\d+)?$/.test(raw) &&
                  Number.isFinite(Number(raw))
                )
                  row[metric.column] = Number(raw);
              }
              rows.push(row);
            }
          },
          { signal: deadline },
        );
        return rows;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
