import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';

type Namespace = 'sources' | 'remote' | 'extractions';
type LegacyEntry<T> = {
  version: 1;
  key: string;
  savedAt: number;
  checksum: string;
  data: T;
};

type ObservationRow = Record<string, unknown>;

function isObservation(row: ObservationRow): boolean {
  return [
    'indicatorEnglish',
    'indicatorChinese',
    'indicatorNameZh',
    'indicatorCode',
    'indicator',
    'dataValue',
    'value',
    'region',
    'country',
    'entity',
    'year',
    'Year',
    '国别地区',
    '数据值',
  ].some((key) => row[key] != null);
}

function observationRows(data: unknown): ObservationRow[] {
  if (Array.isArray(data)) {
    return data.filter(
      (row): row is ObservationRow =>
        row !== null &&
        typeof row === 'object' &&
        !Array.isArray(row) &&
        isObservation(row as ObservationRow),
    );
  }
  if (!data || typeof data !== 'object') return [];
  const object = data as ObservationRow;
  for (const key of [
    'rows',
    'items',
    'observations',
    'structuredData',
    'data',
  ]) {
    if (Array.isArray(object[key])) return observationRows(object[key]);
  }
  return isObservation(object) ? [object] : [];
}

function firstValue(row: ObservationRow, keys: string[]): unknown {
  return keys
    .map((key) => row[key])
    .find((value) => value != null && value !== '');
}

function stringValue(row: ObservationRow, keys: string[]): string | undefined {
  const value = firstValue(row, keys);
  return ['string', 'number', 'boolean'].includes(typeof value)
    ? String(value)
    : undefined;
}

function integerValue(row: ObservationRow, keys: string[]): number | undefined {
  const value = firstValue(row, keys);
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : undefined;
}

function dateValue(row: ObservationRow, keys: string[]): Date | undefined {
  const value = firstValue(row, keys);
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function booleanValue(
  row: ObservationRow,
  keys: string[],
): boolean | undefined {
  const value = firstValue(row, keys);
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
}

function toObservationInput(
  row: ObservationRow,
  recordId: string,
  rowIndex: number,
  namespace: Namespace,
): Prisma.StructuredDataObservationCreateManyInput {
  const year = ['year', 'Year', '年份'];
  const dataValue = firstValue(row, ['dataValue', 'value', '数据值']);
  const annotations = firstValue(row, [
    'annotations',
    'otherMetadata',
    'metadata',
  ]);
  return {
    recordId,
    rowIndex,
    namespace,
    indicatorEnglish: stringValue(row, [
      'indicatorEnglish',
      'indicatorCode',
      'indicator',
      'code',
    ]),
    indicatorChinese: stringValue(row, [
      'indicatorChinese',
      'indicatorNameZh',
      '指标（中文）',
    ]),
    sourceOrganization: stringValue(row, [
      'sourceOrganization',
      'dataSourceOrganization',
      'organization',
      'source',
    ]),
    sourceProject: stringValue(row, ['sourceProject', 'project', 'revision']),
    region: stringValue(row, ['region', 'country', 'entity', '地区', '国家']),
    regionType: stringValue(row, ['regionType', 'areaType']),
    parentRegion: stringValue(row, ['parentRegion', 'parentArea']),
    startTime: integerValue(row, ['startTime', 'startYear', ...year]),
    endTime: integerValue(row, ['endTime', 'endYear', ...year]),
    timeIndicatorType: stringValue(row, [
      'timeIndicatorType',
      'timeType',
      'estimateType',
    ]),
    ...(dataValue !== undefined
      ? { dataValue: dataValue as Prisma.InputJsonValue }
      : {}),
    unit: stringValue(row, ['unit', '数据单位']),
    sourceUrl: stringValue(row, ['sourceUrl', 'url']),
    publishedAt: stringValue(row, [
      'publishedAt',
      'sourcePublishedAt',
      'publicationDate',
    ]),
    indicatorExplanation: stringValue(row, [
      'indicatorExplanation',
      'description',
    ]),
    inputBy: stringValue(row, ['inputBy', 'createdBy']) ?? 'system',
    inputAt: dateValue(row, ['inputAt', 'createdAt']) ?? new Date(),
    isPublic: booleanValue(row, ['isPublic', 'shared']),
    dataOwner: stringValue(row, ['dataOwner', 'owner']),
    lastModifiedBy:
      stringValue(row, ['lastModifiedBy', 'updatedBy']) ?? 'system',
    lastModifiedAt:
      dateValue(row, ['lastModifiedAt', 'updatedAt']) ?? new Date(),
    ...(annotations !== undefined
      ? { annotations: annotations as Prisma.InputJsonValue }
      : {}),
    rawData: row as Prisma.InputJsonValue,
  };
}

/** Persistent structured data store with a one-time legacy disk import path. */
export class StructuredDataStore {
  private static readonly pending = new Map<string, Promise<unknown>>();
  private static readonly databaseScopes = new WeakMap<object, number>();
  private static nextDatabaseScope = 1;

  constructor(
    private readonly legacyDirectory = resolve(
      process.env.STRUCTURED_DATA_CACHE_DIR || 'storage/structured-data',
    ),
    private readonly enabled = process.env.STRUCTURED_DATA_CACHE_ENABLED !==
      'false' && process.env.NODE_ENV !== 'test',
    private readonly warn: (message: string) => void = () => {},
    private readonly prisma?: PrismaService,
  ) {}

  fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private legacyPath(namespace: Namespace, key: string) {
    return join(
      this.legacyDirectory,
      namespace,
      `${this.fingerprint(key)}.json`,
    );
  }

  async read<T>(namespace: Namespace, key: string): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    const fingerprint = this.fingerprint(key);
    if (this.prisma) {
      try {
        const record = await this.prisma.structuredDataRecord.findUnique({
          where: { namespace_fingerprint: { namespace, fingerprint } },
          select: { checksum: true, data: true },
        });
        if (record && record.checksum === this.fingerprint(record.data)) {
          return record.data as T;
        }
      } catch {
        this.warn(
          'Structured data database read failed; checking legacy storage',
        );
      }
    }

    const legacy = await this.readLegacy<T>(namespace, key);
    if (legacy !== undefined && this.prisma) {
      await this.writeDatabase(namespace, fingerprint, legacy);
    }
    return legacy;
  }

  async write<T>(namespace: Namespace, key: string, data: T): Promise<void> {
    if (!this.enabled) return;
    const fingerprint = this.fingerprint(key);
    if (this.prisma) {
      const saved = await this.writeDatabase(namespace, fingerprint, data);
      if (saved) return;
    }
    await this.writeLegacy(namespace, key, data);
  }

  async getOrLoad<T>(
    namespace: Namespace,
    key: string,
    load: () => Promise<T>,
    isValid: (data: T) => boolean,
  ): Promise<T> {
    if (!this.enabled) return load();
    const pendingKey = `${this.pendingScope()}/${namespace}/${this.fingerprint(key)}`;
    const pending = StructuredDataStore.pending.get(pendingKey);
    if (pending) return pending as Promise<T>;

    const request = (async () => {
      const stored = await this.read<T>(namespace, key);
      if (stored !== undefined && isValid(stored)) return stored;
      const data = await load();
      if (isValid(data)) await this.write(namespace, key, data);
      return data;
    })();

    StructuredDataStore.pending.set(pendingKey, request);
    try {
      return await request;
    } finally {
      StructuredDataStore.pending.delete(pendingKey);
    }
  }

  private pendingScope() {
    if (!this.prisma) return this.legacyDirectory;
    let scope = StructuredDataStore.databaseScopes.get(this.prisma);
    if (!scope) {
      scope = StructuredDataStore.nextDatabaseScope++;
      StructuredDataStore.databaseScopes.set(this.prisma, scope);
    }
    return `database-${scope}`;
  }

  private async readLegacy<T>(
    namespace: Namespace,
    key: string,
  ): Promise<T | undefined> {
    try {
      const entry = JSON.parse(
        await readFile(this.legacyPath(namespace, key), 'utf8'),
      ) as LegacyEntry<T>;
      if (
        entry.version !== 1 ||
        entry.key !== this.fingerprint(key) ||
        !Number.isFinite(entry.savedAt) ||
        entry.checksum !== this.fingerprint(entry.data)
      ) {
        return undefined;
      }
      return entry.data;
    } catch {
      return undefined;
    }
  }

  private async writeDatabase<T>(
    namespace: Namespace,
    fingerprint: string,
    data: T,
  ): Promise<boolean> {
    if (!this.prisma) return false;
    try {
      await this.prisma.$transaction(async (transaction) => {
        const record = await transaction.structuredDataRecord.upsert({
          where: { namespace_fingerprint: { namespace, fingerprint } },
          create: {
            namespace,
            fingerprint,
            checksum: this.fingerprint(data),
            data: data as Prisma.InputJsonValue,
          },
          update: {
            checksum: this.fingerprint(data),
            data: data as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        await transaction.structuredDataObservation.deleteMany({
          where: { recordId: record.id },
        });
        const rows = observationRows(data);
        for (let offset = 0; offset < rows.length; offset += 500) {
          await transaction.structuredDataObservation.createMany({
            data: rows
              .slice(offset, offset + 500)
              .map((row, index) =>
                toObservationInput(row, record.id, offset + index, namespace),
              ),
          });
        }
      });
      return true;
    } catch {
      this.warn('Structured data database write failed; using legacy storage');
      return false;
    }
  }

  private async writeLegacy<T>(
    namespace: Namespace,
    key: string,
    data: T,
  ): Promise<void> {
    const path = this.legacyPath(namespace, key);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(join(this.legacyDirectory, namespace), { recursive: true });
      const entry: LegacyEntry<T> = {
        version: 1,
        key: this.fingerprint(key),
        savedAt: Date.now(),
        checksum: this.fingerprint(data),
        data,
      };
      await writeFile(temporary, JSON.stringify(entry), {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, path);
    } catch {
      this.warn(
        'Structured data legacy write failed; continuing with the result',
      );
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
}
