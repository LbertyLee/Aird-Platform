import { inferQueryRegions } from '../../common/utils/query-regions';

export interface ChinaRegionalSeriesPlan {
  needs: string[];
  sources: Array<{ websiteUrl: string; query: string; reason: string }>;
}

/** Keep multi-city, multi-year China statistics searches explicit at retrieval time. */
export function planChinaRegionalSeries(
  query: string,
): ChinaRegionalSeriesPlan | null {
  const regions = inferQueryRegions(query);
  if (
    regions.length < 2 ||
    !/(?:gdp|国内生产总值)/i.test(query) ||
    !/(?:进出口|进口|出口|贸易)/i.test(query)
  )
    return null;

  const years = [...query.matchAll(/\b(19|20)\d{2}\b/g)].map((match) =>
    Number(match[0]),
  );
  if (years.length < 2) return null;
  const start = Math.min(...years);
  const end = Math.max(...years);
  const middle = Math.floor((start + end) / 2);
  const periods = [
    [start, middle],
    [middle + 1, end],
  ].filter(([from, to]) => from <= to);
  const sources = regions.flatMap((region) =>
    periods.map(([from, to]) => ({
      websiteUrl: 'https://data.stats.gov.cn',
      query: `site:data.stats.gov.cn ${region} ${from}-${to} 年度 GDP 国内生产总值 进出口总额 进口 出口`,
      reason: `国家统计局国家数据省级年度指标，单独核查${region}${from}-${to}年`,
    })),
  );

  return {
    needs: regions.flatMap((region) => [
      `${region} ${start}-${end} 年度 GDP（现价，国家统计局口径）`,
      `${region} ${start}-${end} 年度进出口总额（注明原始单位及进口、出口口径）`,
      `${region} ${start}-${end} 年度进出口总额/GDP（由同年同口径数值计算，%）`,
    ]),
    sources,
  };
}
