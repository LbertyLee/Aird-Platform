import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

type Namespace = 'sources' | 'remote' | 'extractions';
type Entry<T> = { version: 1; key: string; savedAt: number; checksum: string; data: T };

/** Internal disk store only; reads must follow the caller's normal authorization checks. */
export class StructuredDataStore {
  private static readonly pending = new Map<string, Promise<unknown>>();

  constructor(
    private readonly directory = resolve(process.env.STRUCTURED_DATA_CACHE_DIR || 'storage/structured-data'),
    private readonly enabled = process.env.STRUCTURED_DATA_CACHE_ENABLED !== 'false' && process.env.NODE_ENV !== 'test',
    private readonly warn: (message: string) => void = () => {},
  ) {}

  fingerprint(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  private path(namespace: Namespace, key: string) {
    return join(this.directory, namespace, `${this.fingerprint(key)}.json`);
  }

  async read<T>(namespace: Namespace, key: string, ttlMs: number): Promise<T | undefined> {
    if (!this.enabled) return undefined;
    try {
      const entry = JSON.parse(await readFile(this.path(namespace, key), 'utf8')) as Entry<T>;
      const age = Date.now() - entry.savedAt;
      if (entry.version !== 1 || entry.key !== this.fingerprint(key) || !Number.isFinite(entry.savedAt) || age < 0 || age >= ttlMs || entry.checksum !== this.fingerprint(entry.data)) return undefined;
      return entry.data;
    } catch {
      return undefined;
    }
  }

  async write<T>(namespace: Namespace, key: string, data: T): Promise<void> {
    if (!this.enabled) return;
    const path = this.path(namespace, key);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await mkdir(join(this.directory, namespace), { recursive: true });
      const entry: Entry<T> = { version: 1, key: this.fingerprint(key), savedAt: Date.now(), checksum: this.fingerprint(data), data };
      await writeFile(temporary, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, path);
    } catch {
      this.warn('Structured data local persistence failed; continuing with the original result');
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }

  async getOrLoad<T>(namespace: Namespace, key: string, ttlMs: number, load: () => Promise<T>, cacheable: (data: T) => boolean): Promise<T> {
    if (!this.enabled) return load();
    const pendingKey = `${this.directory}/${namespace}/${this.fingerprint(key)}`;
    const pending = StructuredDataStore.pending.get(pendingKey);
    if (pending) return pending as Promise<T>;
    const request = (async () => {
      const cached = await this.read<T>(namespace, key, ttlMs);
      if (cached !== undefined && cacheable(cached)) return cached;
      const data = await load();
      if (cacheable(data)) await this.write(namespace, key, data);
      return data;
    })();
    StructuredDataStore.pending.set(pendingKey, request);
    try { return await request; } finally { StructuredDataStore.pending.delete(pendingKey); }
  }
}
