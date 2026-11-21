import { Injectable, Logger } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { StructuredDataStore } from './structured-data-store';
import { QUERY_COUNTRIES } from '../common/utils/query-countries';
import type { SourceEntity } from './research.types';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

export const OWID_MADDISON_PAGE_URL =
  'https://ourworldindata.org/grapher/gdp-per-capita-maddison-project-database';
export const OWID_MADDISON_CSV_URL = `${OWID_MADDISON_PAGE_URL}.csv`;
const OWID_MADDISON_CACHE_KEY = 'our-world-in-data/maddison-gdp-per-capita-v1';
const OWID_MADDISON_MAX_BYTES = 8 * 1024 * 1024;
const OWID_MADDISON_CITATION =
  'Bolt and van Zanden – Maddison Project Database 2023 – with minor processing by Our World in Data';
const OWID_MADDISON_UNIT = 'international-$ in 2011 prices';

type GrapherRow = {
  entity: string;
  code: string;
  year: number;
  value: number;
  annotation?: string;
};

export function isOwidMaddisonSource(source: SourceEntity): boolean {
  if (source.origin !== 'exa') return false;
  try {
    const url = new URL(source.sourceUrl ?? '');
    return (
      url.protocol === 'https:' &&
      url.hostname === 'ourworldindata.org' &&
      /^\/grapher\/gdp-per-capita-maddison-project-database(?:\.csv)?\/?$/i.test(
        url.pathname,
      )
    );
  } catch {
    return false;
  }
}

@Injectable()
export class OurWorldInDataService {
  private readonly logger = new Logger(OurWorldInDataService.name);
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
    entities: string[],
    periods: string[],
    regions: string[] = [],
  ): Promise<SourceEntity[]> {
    const candidates = sources.filter(
      (source) =>
        isOwidMaddisonSource(source) &&
        (!Array.isArray(source.structuredData) ||
          source.structuredData.length === 0),
    );
    if (!candidates.length) return sources;

    try {
      const fullDataset = await this.store.getOrLoad(
        'remote',
        OWID_MADDISON_CACHE_KEY,
        () => this.download(),
        (rows) => rows.length > 20_000 && rows.every(isGrapherRow),
      );
      const selectedRows = selectRows(fullDataset, entities, periods, regions);
      if (!selectedRows.length) {
        throw new Error('No Maddison observations matched the requested scope');
      }
      const textContent = [
        ...candidates[0].textContent.split('\n').filter(Boolean),
        'Our World in Data Grapher: GDP per capita — Maddison Project Database 2023.',
        `Unit: ${OWID_MADDISON_UNIT}. Coverage: 1–2022. Citation: ${OWID_MADDISON_CITATION}.`,
      ].join('\n');
      const candidateIds = new Set(candidates.map((source) => source.id));
      return sources.map((source) =>
        candidateIds.has(source.id)
          ? {
              ...source,
              storageType: 'structured',
              mimeType: 'application/json',
              textContent,
              structuredData: selectedRows,
              recordCount: selectedRows.length,
              metadata: {
                ...source.metadata,
                analysisProvider: 'owid-grapher',
                officialDataUnavailable: false,
                officialDataUrl: OWID_MADDISON_CSV_URL,
                grapherSlug: 'gdp-per-capita-maddison-project-database',
                datasetRevision: 'Maddison Project Database 2023',
                datasetCitation: OWID_MADDISON_CITATION,
                datasetUnit: OWID_MADDISON_UNIT,
                coverage: '1-2022',
              },
            }
          : source,
      );
    } catch (error) {
      this.logger.warn(`OWID Maddison data hydration failed: ${String(error)}`);
      const candidateIds = new Set(candidates.map((source) => source.id));
      return sources.map((source) =>
        candidateIds.has(source.id)
          ? {
              ...source,
              metadata: {
                ...source.metadata,
                officialDataUnavailable: true,
                officialDataProvider: 'owid-grapher',
              },
            }
          : source,
      );
    }
  }

  private async download(): Promise<GrapherRow[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const response = await fetch(OWID_MADDISON_CSV_URL, {
          signal: AbortSignal.timeout(45_000),
          redirect: 'error',
          headers: { accept: 'text/csv' },
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(`OWID Grapher returned HTTP ${response.status}`);
        }
        const csv = await response.text();
        if (Buffer.byteLength(csv, 'utf8') > OWID_MADDISON_MAX_BYTES) {
          throw new Error('OWID Grapher CSV exceeded the size limit');
        }
        const rows = parse<Record<string, string>>(csv, {
          bom: true,
          columns: true,
          skip_empty_lines: true,
          trim: true,
        });
        const mapped = rows.flatMap((row) => {
          const entity = row.Entity?.trim();
          const year = Number(row.Year);
          const value = Number(row['GDP per capita']);
          if (
            !entity ||
            !Number.isInteger(year) ||
            year < 1 ||
            year > 2022 ||
            !Number.isFinite(value)
          ) {
            return [];
          }
          return [
            {
              entity,
              code: row.Code?.trim() ?? '',
              year,
              value,
              ...(row['GDP per capita (Annotations)']?.trim()
                ? { annotation: row['GDP per capita (Annotations)'].trim() }
                : {}),
            },
          ];
        });
        validateRows(mapped);
        return mapped;
      } catch (error) {
        lastError = error;
        this.logger.warn(
          `OWID Grapher request ${attempt}/2 failed: ${String(error)}`,
        );
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new Error('OWID Grapher request failed');
  }
}

function isGrapherRow(value: unknown): value is GrapherRow {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<GrapherRow>;
  return (
    typeof row.entity === 'string' &&
    typeof row.code === 'string' &&
    Number.isInteger(row.year) &&
    typeof row.value === 'number' &&
    Number.isFinite(row.value)
  );
}

function validateRows(rows: GrapherRow[]) {
  const keys = new Set(rows.map((row) => `${row.entity}/${row.year}`));
  if (rows.length < 20_000 || keys.size !== rows.length) {
    throw new Error(`OWID Grapher CSV schema mismatch (${rows.length} rows)`);
  }
}

function selectRows(
  rows: GrapherRow[],
  entities: string[],
  periods: string[],
  regions: string[],
) {
  const selectedEntities = entities.map(normalizeEntity).filter(Boolean);
  const selectedRegions = regions.map(normalizeEntity).filter(Boolean);
  const requestedCodes = new Set<string>();
  const countryNames = new Set<string>();
  for (const [code, ...aliases] of QUERY_COUNTRIES) {
    const normalizedAliases = aliases.map(normalizeEntity);
    normalizedAliases.forEach((alias) => countryNames.add(alias));
    if (selectedEntities.some((entity) => normalizedAliases.includes(entity))) {
      requestedCodes.add(code);
    }
  }

  const requestedNames = selectedEntities.filter(
    (entity) =>
      !countryNames.has(entity) &&
      !['world', 'global', '全球', '世界'].includes(entity),
  );
  const years = parsePeriods(periods);
  const defaultWorld =
    requestedCodes.size === 0 &&
    requestedNames.length === 0 &&
    selectedRegions.length === 0;
  return rows.flatMap((row) => {
    if (years.size > 0 && !years.has(row.year)) return [];
    const isCountryCode = /^[A-Z]{3}$/.test(row.code);
    const matchesEntity = defaultWorld
      ? row.entity.toLowerCase() === 'world' ||
        row.entity.toLowerCase() === 'global'
      : (isCountryCode && requestedCodes.has(row.code)) ||
        requestedNames.some((name) => normalizeEntity(row.entity) === name) ||
        selectedRegions.some((name) => {
          const rowName = normalizeEntity(row.entity);
          return rowName === name || rowName.includes(name);
        });
    if (!matchesEntity) return [];
    const region = row.code.startsWith('OWID_') || !isCountryCode;
    return [
      {
        entity: row.entity,
        entityCode: row.code || null,
        entityType: region ? 'region' : 'country',
        country: region ? null : row.entity,
        countryCode: region ? null : row.code,
        year: row.year,
        indicator: 'GDP per capita',
        indicatorName: '人均国内生产总值',
        indicatorCode: 'gdp_per_capita',
        catalogIndicatorCode: 'gdp_per_capita',
        value: row.value,
        unit: OWID_MADDISON_UNIT,
        sourceValue: row.value,
        sourceUnit: OWID_MADDISON_UNIT,
        sourceUrl: OWID_MADDISON_CSV_URL,
        sourcePageUrl: OWID_MADDISON_PAGE_URL,
        sourceColumn: 'GDP per capita',
        revision: 'Maddison Project Database 2023',
        citation: OWID_MADDISON_CITATION,
        ...(row.annotation ? { annotation: row.annotation } : {}),
      },
    ];
  });
}

function parsePeriods(periods: string[]) {
  const years = new Set<number>();
  for (const period of periods) {
    const year = period.match(/^\s*(\d{1,4})\s*$/);
    if (year) {
      const value = Number(year[1]);
      if (value >= 1 && value <= 2022) years.add(value);
      continue;
    }
    const range = period.match(/^\s*(\d{1,4})\s*[-–—~至到]\s*(\d{1,4})\s*$/);
    if (!range) continue;
    const start = Math.max(1, Number(range[1]));
    const end = Math.min(2022, Number(range[2]));
    if (start <= end && end - start <= 500) {
      for (let year = start; year <= end; year += 1) years.add(year);
    }
  }
  return years;
}

function normalizeEntity(value: string) {
  return value
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
    .trim();
}
