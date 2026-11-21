import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StructuredDataStore } from './structured-data-store';
import { ResearchRepository } from './research.repository';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';

describe('persistent structured data storage', () => {
  let directory: string;
  let store: StructuredDataStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'structured-data-'));
    store = new StructuredDataStore(directory, true);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('persists arbitrary providers and JSON objects across service recreation', async () => {
    const rows = {
      provider: 'Eurostat',
      data: [{ country: 'FR', year: 2024, value: 0 }],
      unit: 'EUR',
    };
    const load = jest.fn().mockResolvedValue(rows);
    await store.getOrLoad(
      'remote',
      'https://example.org/data.json',
      load,
      Boolean,
    );
    expect(
      await new StructuredDataStore(directory, true).getOrLoad(
        'remote',
        'https://example.org/data.json',
        load,
        Boolean,
      ),
    ).toEqual(rows);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('reads the database before loading and keeps records without an expiry', async () => {
    const data = [{ country: 'France', year: 2024, value: 0 }];
    const database = {
      structuredDataRecord: {
        findUnique: jest.fn().mockResolvedValue({
          checksum: store.fingerprint(data),
          data,
        }),
        upsert: jest.fn(),
      },
    } as unknown as PrismaService;
    const load = jest.fn().mockResolvedValue([{ value: 99 }]);
    const databaseStore = new StructuredDataStore(
      directory,
      true,
      jest.fn(),
      database,
    );

    await expect(
      databaseStore.getOrLoad('remote', 'wpp:fr:2024', load, Boolean),
    ).resolves.toEqual(data);
    expect(load).not.toHaveBeenCalled();
    expect(database.structuredDataRecord.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          namespace_fingerprint: {
            namespace: 'remote',
            fingerprint: databaseStore.fingerprint('wpp:fr:2024'),
          },
        },
      }),
    );
  });

  it('backfills valid legacy records into the database without applying their old TTL', async () => {
    const data = [
      {
        indicatorCode: 'GDP_PC',
        indicatorChinese: '人均国内生产总值',
        source: 'Example Bureau',
        country: 'Exampleland',
        year: -500,
        value: 12.5,
        unit: 'USD',
      },
    ];
    const key = 'old-wpp-key';
    const fingerprint = store.fingerprint(key);
    const legacyDirectory = join(directory, 'remote');
    await mkdir(legacyDirectory, { recursive: true });
    await writeFile(
      join(legacyDirectory, `${fingerprint}.json`),
      JSON.stringify({
        version: 1,
        key: fingerprint,
        savedAt: 1,
        checksum: store.fingerprint(data),
        data,
      }),
    );
    const recordDelegate = {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'record-1' }),
    };
    const observationDelegate = {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    };
    const transaction = {
      structuredDataRecord: recordDelegate,
      structuredDataObservation: observationDelegate,
    };
    const database = {
      ...transaction,
      $transaction: jest.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    } as unknown as PrismaService;
    const load = jest.fn().mockResolvedValue([{ value: 99 }]);

    await expect(
      new StructuredDataStore(directory, true, jest.fn(), database).getOrLoad(
        'remote',
        key,
        load,
        Boolean,
      ),
    ).resolves.toEqual(data);
    expect(load).not.toHaveBeenCalled();
    expect(recordDelegate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          namespace: 'remote',
          fingerprint,
          checksum: store.fingerprint(data),
          data,
        }),
      }),
    );
    expect(observationDelegate.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          recordId: 'record-1',
          rowIndex: 0,
          indicatorEnglish: 'GDP_PC',
          indicatorChinese: '人均国内生产总值',
          sourceOrganization: 'Example Bureau',
          region: 'Exampleland',
          startTime: -500,
          endTime: -500,
          dataValue: 12.5,
          unit: 'USD',
        }),
      ],
    });
  });

  it('keeps source scopes and extraction content/catalog/query fingerprints separate', async () => {
    const base = {
      sourceId: 'private-A',
      content: '2024 100',
      query: 'GDP',
      catalog: ['gdp'],
    };
    const load = jest.fn().mockResolvedValue([{ value: 100 }]);
    for (const context of [
      base,
      { ...base, sourceId: 'private-B' },
      { ...base, content: '2024 200' },
      { ...base, query: 'population' },
      { ...base, catalog: ['population'] },
      base,
    ]) {
      await store.getOrLoad(
        'extractions',
        store.fingerprint(context),
        load,
        Boolean,
      );
    }
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('imports legacy files without expiry and never saves failed/empty loads', async () => {
    const load = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ value: 5 }]);
    const get = () =>
      store.getOrLoad(
        'remote',
        'key',
        load,
        (data: unknown[]) => data.length > 0,
      );
    await expect(get()).rejects.toThrow('timeout');
    await get();
    await get();
    const path = join(
      directory,
      'remote',
      (await readdir(join(directory, 'remote')))[0],
    );
    const entry = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...entry, savedAt: 0 }));
    expect(await get()).toEqual([{ value: 5 }]);
    await writeFile(path, JSON.stringify({ ...entry, data: [{ value: 999 }] }));
    expect(await get()).toEqual([{ value: 5 }]);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('coalesces concurrent requests and tolerates unwritable storage', async () => {
    const load = jest.fn(async () => [{ value: 1 }]);
    await Promise.all(
      Array.from({ length: 8 }, () =>
        store.getOrLoad('remote', 'key', load, Boolean),
      ),
    );
    expect(load).toHaveBeenCalledTimes(1);
    const blocked = join(directory, 'file');
    await writeFile(blocked, 'not a directory');
    const warn = jest.fn();
    expect(
      await new StructuredDataStore(blocked, true, warn).getOrLoad(
        'remote',
        'key',
        load,
        Boolean,
      ),
    ).toEqual([{ value: 1 }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('keeps structured data attached to the persisted source record', async () => {
    const repository = new ResearchRepository(
      {} as PrismaService,
      new ConfigService({ STORAGE_DRIVER: 'memory' }),
    );
    for (const origin of ['upload', 'local', 'exa'] as const) {
      const source = await repository.createSource({
        title: origin,
        origin,
        storageType: 'structured',
        textContent: 'data',
        searchText: 'data',
        structuredData: [{ value: 0, unit: '人' }],
        recordCount: 1,
      });
      expect(source.structuredData).toEqual([{ value: 0, unit: '人' }]);
    }
    await expect(readdir(join(directory, 'sources'))).rejects.toThrow();
  });
});
