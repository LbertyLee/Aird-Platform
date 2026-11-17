import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StructuredDataStore } from './structured-data-store';
import { ResearchRepository } from './research.repository';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../infrastructure/prisma/prisma.service';

describe('unified structured data local storage', () => {
  let directory: string;
  let store: StructuredDataStore;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'structured-data-'));
    store = new StructuredDataStore(directory, true);
  });
  afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

  it('persists arbitrary providers and JSON objects across service recreation', async () => {
    const rows = { provider: 'Eurostat', data: [{ country: 'FR', year: 2024, value: 0 }], unit: 'EUR' };
    const load = jest.fn().mockResolvedValue(rows);
    await store.getOrLoad('remote', 'https://example.org/data.json', 10000, load, Boolean);
    expect(await new StructuredDataStore(directory, true).getOrLoad('remote', 'https://example.org/data.json', 10000, load, Boolean)).toEqual(rows);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps source scopes and extraction content/catalog/query fingerprints separate', async () => {
    const base = { sourceId: 'private-A', content: '2024 100', query: 'GDP', catalog: ['gdp'] };
    const load = jest.fn().mockResolvedValue([{ value: 100 }]);
    for (const context of [base, { ...base, sourceId: 'private-B' }, { ...base, content: '2024 200' }, { ...base, query: 'population' }, { ...base, catalog: ['population'] }, base]) {
      await store.getOrLoad('extractions', store.fingerprint(context), 10000, load, Boolean);
    }
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('refreshes expired and corrupted files, and never saves failed/empty loads', async () => {
    const load = jest.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce([]).mockResolvedValue([{ value: 5 }]);
    const get = () => store.getOrLoad('remote', 'key', 10000, load, (data: unknown[]) => data.length > 0);
    await expect(get()).rejects.toThrow('timeout');
    await get();
    await get();
    const path = join(directory, 'remote', (await readdir(join(directory, 'remote')))[0]);
    const entry = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...entry, savedAt: 0 }));
    await get();
    await writeFile(path, JSON.stringify({ ...entry, data: [{ value: 999 }] }));
    expect(await get()).toEqual([{ value: 5 }]);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('coalesces concurrent requests and tolerates unwritable storage', async () => {
    const load = jest.fn(async () => [{ value: 1 }]);
    await Promise.all(Array.from({ length: 8 }, () => store.getOrLoad('remote', 'key', 10000, load, Boolean)));
    expect(load).toHaveBeenCalledTimes(1);
    const blocked = join(directory, 'file');
    await writeFile(blocked, 'not a directory');
    const warn = jest.fn();
    expect(await new StructuredDataStore(blocked, true, warn).getOrLoad('remote', 'key', 10000, load, Boolean)).toEqual([{ value: 1 }]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('archives non-WorldBank uploads, SQL and API evidence at the repository boundary', async () => {
    const repository = new ResearchRepository({} as PrismaService, new ConfigService({ STORAGE_DRIVER: 'memory' }));
    Object.assign(repository, { structuredStore: store });
    for (const origin of ['upload', 'local', 'exa'] as const) {
      const source = await repository.createSource({ title: origin, origin, storageType: 'structured', textContent: 'data', searchText: 'data', structuredData: [{ value: 0, unit: '人' }], recordCount: 1 });
      expect(await store.read('sources', source.id, Infinity)).toEqual(source);
    }
    expect(await readdir(join(directory, 'sources'))).toHaveLength(3);
  });
});
