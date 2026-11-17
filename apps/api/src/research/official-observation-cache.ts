import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join } from 'node:path';

type Observation = {
  countryiso3code?: string;
  date?: string;
  value?: number | null;
  indicator?: { id?: string; value?: string };
  country?: { id?: string; value?: string };
  retrievedAt?: string;
  sourceUrl?: string;
  cacheHit?: boolean;
};
type Cell = {
  version: 1;
  country: string;
  indicator: string;
  year: number;
  fetchedAt: number;
  sourceUrl: string;
  observation: Observation | null;
};

/** Public official observations only. User uploads and private evidence never enter this cache. */
export class OfficialObservationCache {
  private static readonly pending = new Map<string, Promise<Observation[]>>();
  constructor(
    private readonly directory = resolve(
      process.env.OFFICIAL_DATA_CACHE_DIR || 'storage/official-data',
    ),
    private readonly enabled = process.env.OFFICIAL_DATA_CACHE_ENABLED !==
      'false' && process.env.NODE_ENV !== 'test',
    private readonly warn: (message: string) => void = () => {},
  ) {}

  async get(
    url: URL,
    fetchRows: (url: URL) => Promise<Observation[]>,
  ): Promise<Observation[]> {
    if (!this.enabled) return fetchRows(url);
    const key = `${this.directory}/${url.toString()}`;
    const current = OfficialObservationCache.pending.get(key);
    if (current) return current;
    const request = this.load(url, fetchRows);
    OfficialObservationCache.pending.set(key, request);
    try {
      return await request;
    } finally {
      OfficialObservationCache.pending.delete(key);
    }
  }

  private path(country: string, indicator: string, year: number) {
    return join(
      this.directory,
      `${createHash('sha256').update(`${country}/${indicator}/${year}`).digest('hex')}.json`,
    );
  }

  private async load(
    url: URL,
    fetchRows: (url: URL) => Promise<Observation[]>,
  ) {
    const match = url.pathname.match(
      /^\/v2\/country\/([^/]+)\/indicator\/([^/]+)$/,
    );
    const period = url.searchParams.get('date')?.match(/^(\d{4}):(\d{4})$/);
    if (!match || !period) return fetchRows(url);
    const countries = match[1].split(';');
    const indicator = match[2];
    const start = Number(period[1]),
      end = Number(period[2]);
    const cells = countries.flatMap((country) =>
      Array.from({ length: end - start + 1 }, (_, index) => ({
        country,
        year: start + index,
      })),
    );
    const rows: Observation[] = [];
    const missing: typeof cells = [];
    await Promise.all(
      cells.map(async ({ country, year }) => {
        try {
          const cell = JSON.parse(
            await readFile(this.path(country, indicator, year), 'utf8'),
          ) as Cell;
          // Historical values can be revised; absent/latest values refresh sooner.
          const ttl =
            cell.observation === null
              ? 3600_000
              : year >= new Date().getUTCFullYear() - 1
                ? 86400_000
                : 7 * 86400_000;
          if (
            cell.version !== 1 ||
            cell.country !== country ||
            cell.indicator !== indicator ||
            cell.year !== year ||
            !Number.isFinite(cell.fetchedAt) ||
            Date.now() - cell.fetchedAt < 0 ||
            Date.now() - cell.fetchedAt >= ttl ||
            (cell.observation !== null &&
              (cell.observation?.countryiso3code !== country ||
                cell.observation?.date !== String(year) ||
                cell.observation?.indicator?.id !== indicator ||
                typeof cell.observation?.value !== 'number' ||
                !Number.isFinite(cell.observation.value)))
          )
            throw new Error('cache miss');
          if (cell.observation)
            rows.push({
              ...cell.observation,
              retrievedAt: new Date(cell.fetchedAt).toISOString(),
              sourceUrl: cell.sourceUrl,
              cacheHit: true,
            });
        } catch {
          missing.push({ country, year });
        }
      }),
    );
    if (!missing.length) return rows;
    const remote = new URL(url);
    remote.pathname = `/v2/country/${[...new Set(missing.map((cell) => cell.country))].sort().join(';')}/indicator/${indicator}`;
    remote.searchParams.set(
      'date',
      `${Math.min(...missing.map((cell) => cell.year))}:${Math.max(...missing.map((cell) => cell.year))}`,
    );
    let fetched: Observation[];
    try {
      fetched = await fetchRows(remote);
    } catch (error) {
      if (!rows.length) throw error;
      this.warn(
        '官方数据补查失败，保留仍在有效期内的本地观测，缺失项继续标记为空',
      );
      return rows;
    }
    // Do not store exceptions or invalid payloads as missing observations.
    const valid = fetched.filter(
      (row) =>
        row.indicator?.id === indicator &&
        typeof row.value === 'number' &&
        Number.isFinite(row.value),
    );
    const fetchedAt = Date.now();
    try {
      await mkdir(this.directory, { recursive: true });
      await Promise.all(
        missing.map(async ({ country, year }) => {
          const observation =
            valid.find(
              (row) =>
                row.countryiso3code === country && row.date === String(year),
            ) ?? null;
          const cell: Cell = {
            version: 1,
            country,
            indicator,
            year,
            fetchedAt,
            sourceUrl: remote.toString(),
            observation,
          };
          const target = this.path(country, indicator, year),
            temporary = `${target}.${randomUUID()}.tmp`;
          try {
            await writeFile(temporary, JSON.stringify(cell), 'utf8');
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
        }),
      );
    } catch {
      this.warn('官方结构化数据缓存写入失败，本次仍使用已获取数据');
    }
    for (const cell of missing) {
      const observation = valid.find(
        (row) =>
          row.countryiso3code === cell.country &&
          row.date === String(cell.year),
      );
      if (observation)
        rows.push({
          ...observation,
          retrievedAt: new Date(fetchedAt).toISOString(),
          sourceUrl: remote.toString(),
          cacheHit: false,
        });
    }
    return rows;
  }
}
