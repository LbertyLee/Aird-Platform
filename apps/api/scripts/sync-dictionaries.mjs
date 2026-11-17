#!/usr/bin/env node
/**
 * Sync upstream dictionaries into resources/dictionaries.
 * Usage: node apps/api/scripts/sync-dictionaries.mjs
 * Optional: DICTIONARY_DIR=... DICTIONARY_ONLY=thuocl-finance,zoning
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const outputDir = process.env.DICTIONARY_DIR
  ? path.resolve(process.env.DICTIONARY_DIR)
  : path.join(root, 'apps/api/resources/dictionaries');

const sources = [
  {
    id: 'thuocl-finance',
    url: 'https://raw.githubusercontent.com/thunlp/THUOCL/master/data/THUOCL_caijing.txt',
    file: 'thuocl-finance.txt',
    format: 'txt',
  },
  {
    id: 'thuocl-places',
    url: 'https://raw.githubusercontent.com/thunlp/THUOCL/master/data/THUOCL_diming.txt',
    file: 'thuocl-places.txt',
    format: 'txt',
  },
  {
    id: 'zoning',
    url: 'https://raw.githubusercontent.com/netnr/zoning/main/0.json',
    file: 'zoning.json',
    format: 'json',
  },
  {
    id: 'world-countries',
    url: 'https://raw.githubusercontent.com/mledoze/countries/master/countries.json',
    file: 'world-countries.json',
    format: 'countries',
  },
  ...(process.env.NATIONAL_INDUSTRY_URL
    ? [{
        id: 'national-industry',
        url: process.env.NATIONAL_INDUSTRY_URL,
        file: 'national-industry.json',
        format: 'json',
      }]
    : []),
];

const only = process.env.DICTIONARY_ONLY
  ? new Set(process.env.DICTIONARY_ONLY.split(',').map((value) => value.trim()))
  : null;

await fs.mkdir(outputDir, { recursive: true });

for (const source of sources) {
  if (only && !only.has(source.id)) continue;
  const response = await fetch(source.url, {
    headers: { 'user-agent': 'aird-platform-dictionary-sync/1.0' },
  });
  if (!response.ok) throw new Error(`${source.id}: HTTP ${response.status}`);
  const body = await response.text();
  if (!body.trim()) throw new Error(`${source.id}: empty response`);

  const content = source.format === 'json'
    ? `${JSON.stringify(JSON.parse(body), null, 2)}\n`
    : source.format === 'countries'
      ? `${JSON.stringify(toCountryDictionary(JSON.parse(body)), null, 2)}\n`
      : normalizeTxt(body);
  const destination = path.join(outputDir, source.file);
  const temporary = `${destination}.tmp`;
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, destination);
  console.log(`synced ${source.id} -> ${destination}`);
}

await fs.writeFile(
  path.join(outputDir, 'sources.manifest.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), sources }, null, 2)}\n`,
  'utf8',
);

function normalizeTxt(input) {
  return input
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.replace(/\s+/g, '\t'))
    .join('\n') + '\n';
}

function toCountryDictionary(countries) {
  if (!Array.isArray(countries)) throw new Error('world-countries: expected array');
  return countries.flatMap((country) => {
    const zh = country?.translations?.zho;
    const common = zh?.common || country?.name?.common;
    const official = zh?.official;
    if (!common) return [];
    const aliases = [
      official,
      country?.name?.common,
      country?.name?.official,
      ...(country?.altSpellings ?? []),
      country?.cca2,
      country?.cca3,
    ].filter((value) => typeof value === 'string' && value.trim() && value !== common);
    return [{
      term: common,
      aliases: [...new Set(aliases)],
      category: 'country',
      code: country?.cca3 || country?.cca2,
    }];
  });
}
