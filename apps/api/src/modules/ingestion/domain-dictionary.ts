import fs from 'node:fs';
import path from 'node:path';

export type DictionaryEntry = {
  term: string;
  aliases?: string[];
  category?: string;
  code?: string;
  parent?: string;
};

const CANDIDATE_DIRS = [
  path.resolve(process.cwd(), 'apps/api/resources/dictionaries'),
  path.resolve(process.cwd(), 'resources/dictionaries'),
];

export class DomainDictionary {
  private static loaded = false;
  private static entries: DictionaryEntry[] = [];

  static load(): DictionaryEntry[] {
    if (this.loaded) return this.entries;
    this.loaded = true;
    const dir = CANDIDATE_DIRS.find((candidate) => fs.existsSync(candidate))
      ?? path.resolve(__dirname, '../../../resources/dictionaries');
    try {
      for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        if (file.endsWith('.json')) {
          const value = JSON.parse(fs.readFileSync(fullPath, 'utf8')) as unknown;
          const rows = Array.isArray(value) ? value : [value];
          for (const row of rows) {
            if (typeof row === 'string') this.entries.push({ term: row });
            else if (row && typeof row === 'object' && typeof (row as { term?: unknown }).term === 'string') {
              this.entries.push(row as DictionaryEntry);
            } else if (row && typeof row === 'object') {
              this.collectNestedTerms(row as Record<string, unknown>);
            }
          }
        } else if (file.endsWith('.txt')) {
          for (const line of fs.readFileSync(fullPath, 'utf8').split(/\r?\n/)) {
            const term = line.split('\t')[0].trim();
            if (term && !term.startsWith('#')) this.entries.push({ term });
          }
        }
      }
    } catch {
      // External resources are optional; built-in fallback terms remain active.
    }
    const deduped = new Map<string, DictionaryEntry>();
    for (const entry of this.entries) {
      const term = entry.term.trim().toLowerCase();
      if (term) deduped.set(term, { ...entry, term });
    }
    this.entries = [...deduped.values()].sort((a, b) => b.term.length - a.term.length);
    return this.entries;
  }

  private static collectNestedTerms(value: Record<string, unknown>) {
    const name = value.name ?? value.n;
    if (typeof name === 'string' && name.trim()) this.entries.push({ term: name.trim(), category: 'place' });
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) for (const item of child) {
        if (item && typeof item === 'object') this.collectNestedTerms(item as Record<string, unknown>);
      }
    }
  }

  static resetForTests() {
    this.loaded = false;
    this.entries = [];
  }
}
