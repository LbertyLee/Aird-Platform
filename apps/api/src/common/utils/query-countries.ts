/** Stable aliases supplement the configurable catalog; model discovery still handles other countries. */
export const QUERY_COUNTRIES = [
  ['CHN', '中国', 'China'],
  ['USA', '美国', 'United States', 'USA', 'US', '美利坚'],
  ['FRA', '法国', 'France'],
  ['GBR', '英国', 'United Kingdom', 'UK'],
  ['RUS', '俄罗斯', 'Russian Federation', 'Russia'],
  ['JPN', '日本', 'Japan'],
  ['DEU', '德国', 'Germany'],
  ['IND', '印度', 'India'],
  ['IDN', '印度尼西亚', 'Indonesia'],
  ['KOR', '韩国', 'South Korea', 'Korea'],
  ['CAN', '加拿大', 'Canada'],
  ['AUS', '澳大利亚', 'Australia'],
  ['BRA', '巴西', 'Brazil'],
  ['MEX', '墨西哥', 'Mexico'],
  ['ZAF', '南非', 'South Africa'],
  ['ITA', '意大利', 'Italy'],
  ['ESP', '西班牙', 'Spain'],
  ['SGP', '新加坡', 'Singapore'],
  ['SAU', '沙特阿拉伯', 'Saudi Arabia'],
  ['TUR', '土耳其', 'Türkiye', 'Turkey'],
  ['VNM', '越南', 'Vietnam'],
  ['THA', '泰国', 'Thailand'],
  ['NLD', '荷兰', 'Netherlands'],
  ['CHE', '瑞士', 'Switzerland'],
  ['SWE', '瑞典', 'Sweden'],
  ['NOR', '挪威', 'Norway'],
  ['DNK', '丹麦', 'Denmark'],
  ['AUT', '奥地利', 'Austria'],
  ['BEL', '比利时', 'Belgium'],
  ['POL', '波兰', 'Poland'],
  ['NZL', '新西兰', 'New Zealand'],
  ['PHL', '菲律宾', 'Philippines'],
  ['MYS', '马来西亚', 'Malaysia'],
  ['PAK', '巴基斯坦', 'Pakistan'],
  ['BGD', '孟加拉国', 'Bangladesh'],
  ['EGY', '埃及', 'Egypt'],
  ['NGA', '尼日利亚', 'Nigeria'],
  ['ARG', '阿根廷', 'Argentina'],
  ['CHL', '智利', 'Chile'],
  ['COL', '哥伦比亚', 'Colombia'],
  ['IRN', '伊朗', 'Iran'],
  ['ISR', '以色列', 'Israel'],
  ['ARE', '阿联酋', 'United Arab Emirates', 'UAE'],
] as const;

// Common Chinese country shorthand used in compact comparisons (中美、英法德、日韩).
// These one-character aliases are only applied inside a run of two or more
// recognized shorthands to avoid treating ordinary prose as country mentions.
const COMPACT_CHINESE_COUNTRIES: Record<string, string> = {
  中: 'CHN',
  美: 'USA',
  英: 'GBR',
  法: 'FRA',
  德: 'DEU',
  日: 'JPN',
  韩: 'KOR',
  俄: 'RUS',
  印: 'IND',
  加: 'CAN',
  澳: 'AUS',
  巴: 'BRA',
  墨: 'MEX',
  意: 'ITA',
  西: 'ESP',
  土: 'TUR',
  新: 'SGP',
  沙: 'SAU',
  越: 'VNM',
  泰: 'THA',
  荷: 'NLD',
  瑞: 'CHE',
  挪: 'NOR',
  丹: 'DNK',
  奥: 'AUT',
  比: 'BEL',
  波: 'POL',
  菲: 'PHL',
  马: 'MYS',
  孟: 'BGD',
  埃: 'EGY',
  尼: 'NGA',
  智: 'CHL',
  哥: 'COL',
  以: 'ISR',
};

export function countryCode(name: string): string | undefined {
  const normalized = name.trim().toLowerCase();
  return QUERY_COUNTRIES.find((country) =>
    country.some((alias) => alias.toLowerCase() === normalized),
  )?.[0];
}

export function inferQueryCountries(query: string): string[] {
  const matchedCodes = new Set<string>(
    QUERY_COUNTRIES.filter((country) =>
      country.some((alias) => {
        if (/[\u4e00-\u9fff]/.test(alias))
          return alias === '印度'
            ? /印度(?!尼西亚)/.test(query)
            : query.includes(alias);
        return new RegExp(`\\b${alias}\\b`, 'i').test(query);
      }),
    ).map((country) => country[0]),
  );
  const shorthandPattern = new RegExp(
    `[${Object.keys(COMPACT_CHINESE_COUNTRIES).join('')}](?:[、和与及,，/＆&-]?[${Object.keys(COMPACT_CHINESE_COUNTRIES).join('')}])+`,
    'g',
  );
  let shorthandText = query;
  const fullChineseAliases = QUERY_COUNTRIES.flatMap((country) =>
    country.slice(1).filter((alias) => /^[\u4e00-\u9fff]{2,}$/.test(alias)),
  ).sort((left, right) => right.length - left.length);
  for (const alias of fullChineseAliases) {
    shorthandText = shorthandText.replaceAll(alias, ' '.repeat(alias.length));
  }
  for (const match of shorthandText.matchAll(shorthandPattern)) {
    for (const character of match[0]) {
      const code = COMPACT_CHINESE_COUNTRIES[character];
      if (code) matchedCodes.add(code);
    }
  }
  return QUERY_COUNTRIES.filter((country) => matchedCodes.has(country[0])).map(
    (country) => country[1],
  );
}

export function countrySearchAliases(name: string): string[] {
  const normalized = name.trim().toLowerCase();
  const country = QUERY_COUNTRIES.find((item) =>
    item.some((alias) => alias.toLowerCase() === normalized),
  );
  return country ? [...country] : [];
}

export function countryEnglishName(code: string): string {
  return QUERY_COUNTRIES.find((country) => country[0] === code)?.[2] ?? code;
}

export function countryChineseName(code: string): string {
  return QUERY_COUNTRIES.find((country) => country[0] === code)?.[1] ?? code;
}
