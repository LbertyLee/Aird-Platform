import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OfficialObservationCache } from './official-observation-cache';

const url = (countries = 'CHN', years = '2021:2021') =>
  new URL(
    `https://api.worldbank.org/v2/country/${countries}/indicator/NY.GDP.MKTP.CD?date=${years}&format=json`,
  );
const row = (country = 'CHN', year = '2021') => ({
  countryiso3code: country,
  date: year,
  value: 100,
  indicator: { id: 'NY.GDP.MKTP.CD' },
});
describe('official observations persisted for reuse', () => {
  let directory: string;
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'official-cache-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  it('survives service recreation and reuses overlapping country/year requests', async () => {
    const remote = jest.fn().mockResolvedValue([row()]);
    await new OfficialObservationCache(directory, true).get(url(), remote);
    const cache = new OfficialObservationCache(directory, true);
    expect(await cache.get(url(), remote)).toEqual([
      expect.objectContaining({
        value: 100,
        cacheHit: true,
        retrievedAt: expect.any(String),
      }),
    ]);
    expect(remote).toHaveBeenCalledTimes(1);
    remote.mockResolvedValue([row('USA')]);
    const result = await cache.get(url('USA;CHN'), remote);
    expect(result).toHaveLength(2);
    expect(remote.mock.calls[1][0].pathname).toContain('/country/USA/');
  });
  it('refreshes expired data and merges newly requested years', async () => {
    const remote = jest.fn().mockResolvedValue([row()]);
    const cache = new OfficialObservationCache(directory, true);
    await cache.get(url(), remote);
    remote.mockResolvedValue([row('CHN', '2022')]);
    expect(await cache.get(url('CHN', '2021:2022'), remote)).toHaveLength(2);
    expect(remote.mock.calls[1][0].searchParams.get('date')).toBe('2022:2022');
    const file = join(directory, (await readdir(directory))[0]);
    const cell = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, JSON.stringify({ ...cell, fetchedAt: 0 }));
    remote.mockResolvedValue([row('CHN', String(cell.year))]);
    await cache.get(url('CHN', `${cell.year}:${cell.year}`), remote);
    expect(remote).toHaveBeenCalledTimes(3);
  });
  it('caches empty published responses briefly but never caches failures', async () => {
    const remote = jest
      .fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValue([]);
    const cache = new OfficialObservationCache(directory, true);
    await expect(cache.get(url(), remote)).rejects.toThrow('timeout');
    await cache.get(url(), remote);
    await cache.get(url(), remote);
    expect(remote).toHaveBeenCalledTimes(2);
  });
  it('coalesces concurrent identical requests and preserves valid local rows if a supplement fails', async () => {
    const remote = jest.fn().mockResolvedValue([row()]);
    const cache = new OfficialObservationCache(directory, true);
    await Promise.all([cache.get(url(), remote), cache.get(url(), remote)]);
    expect(remote).toHaveBeenCalledTimes(1);
    remote.mockRejectedValue(new Error('timeout'));
    expect(await cache.get(url('CHN;USA'), remote)).toEqual([
      expect.objectContaining({ countryiso3code: 'CHN', cacheHit: true }),
    ]);
  });
});
