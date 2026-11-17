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
] as const;

export function countryCode(name: string): string | undefined {
  const normalized = name.trim().toLowerCase();
  return QUERY_COUNTRIES.find((country) =>
    country.some((alias) => alias.toLowerCase() === normalized),
  )?.[0];
}

export function inferQueryCountries(query: string): string[] {
  return QUERY_COUNTRIES.filter((country) =>
    country.some((alias) => {
      if (/[\u4e00-\u9fff]/.test(alias))
        return alias === '印度'
          ? /印度(?!尼西亚)/.test(query)
          : query.includes(alias);
      return new RegExp(`\\b${alias}\\b`, 'i').test(query);
    }),
  ).map((country) => country[1]);
}

export function countryEnglishName(code: string): string {
  return QUERY_COUNTRIES.find((country) => country[0] === code)?.[2] ?? code;
}

export function countryChineseName(code: string): string {
  return QUERY_COUNTRIES.find((country) => country[0] === code)?.[1] ?? code;
}
