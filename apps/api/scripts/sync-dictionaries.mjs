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
  {
    id: 'world-regions',
    url: 'https://raw.githubusercontent.com/country-regions/country-region-data/85244c5594a7a8543af5af0ce1a743557bfc5395/data.json',
    file: 'world-regions.json',
    format: 'regions',
    license: 'MIT',
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

const CHINA_REGION_NAMES = {
  Beijing: '北京市', Tianjin: '天津市', Hebei: '河北省', Shanxi: '山西省',
  'Inner Mongolia': '内蒙古自治区', Liaoning: '辽宁省', Jilin: '吉林省',
  Heilongjiang: '黑龙江省', Shanghai: '上海市', Jiangsu: '江苏省',
  Zhejiang: '浙江省', Anhui: '安徽省', Fujian: '福建省', Jiangxi: '江西省',
  Shandong: '山东省', Henan: '河南省', Hubei: '湖北省', Hunan: '湖南省',
  Guangdong: '广东省', Guangxi: '广西壮族自治区', Hainan: '海南省',
  Chongqing: '重庆市', Sichuan: '四川省', Guizhou: '贵州省', Yunnan: '云南省',
  Tibet: '西藏自治区', Shaanxi: '陕西省', Gansu: '甘肃省', Qinghai: '青海省',
  Ningxia: '宁夏回族自治区', Xinjiang: '新疆维吾尔自治区', Taiwan: '台湾省',
  'Hong Kong': '香港特别行政区', Macau: '澳门特别行政区',
};

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
      : source.format === 'regions'
        ? `${JSON.stringify(toRegionDictionary(JSON.parse(body)), null, 2)}\n`
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

function toRegionDictionary(countries) {
  if (!Array.isArray(countries)) throw new Error('world-regions: expected array');
  const records = countries.flatMap((country) => {
    const countryCode = country?.countryShortCode?.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode ?? '')) return [];
    return (country?.regions ?? []).flatMap((region, index) => {
      const term = region?.name?.trim();
      if (!term) return [];
      const shortCode = region?.shortCode?.trim().toUpperCase();
      const fallbackCode = term.normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || `REGION-${index + 1}`;
      const suffix = (shortCode || fallbackCode).replace(/[^A-Z0-9]+/g, '-');
      const code = `${countryCode}-${suffix}`;
      const localizedTerm = countryCode === 'CN' ? CHINA_REGION_NAMES[term] : undefined;
      return [{
        term: localizedTerm || term,
        aliases: localizedTerm ? [term] : [],
        category: 'region',
        code,
        parent: countryCode,
      }];
    });
  });
  const codes = new Set(records.map((record) => record.code));
  if (records.length < 4000 || codes.size !== records.length) {
    throw new Error(`world-regions: invalid region data (${records.length} records)`);
  }
  return records;
}
