/** Complete indicator names only: qualifiers such as per-capita and growth stay distinct. */
export const RESEARCH_METRIC_ALIASES: readonly (readonly string[])[] = [
  ['人口总量', '总人口', '人口总数', 'total population'],
  ['出生人口', '新生人口', '出生人数', 'births', 'number of births'],
  ['移民人口', 'net migration'],
  ['总和生育率', '合计生育率', 'total fertility rate', 'tfr'],
  ['国内生产总值', '地区生产总值', 'gdp', 'gdp_total', 'gross domestic product'],
  ['人均国内生产总值', '人均地区生产总值', '人均gdp', 'gdp per capita', 'per capita gdp', 'gdp_per_capita'],
  ['国内生产总值增长率', '地区生产总值增长率', 'gdp增长率', 'gdp增速', 'gdp growth rate', 'gdp growth'],
  ['居民消费价格指数', '消费者价格指数', '消费物价指数', 'cpi', 'consumer price index'],
  ['工业生产者出厂价格指数', '生产者价格指数', 'ppi', 'producer price index'],
  ['采购经理指数', '采购经理人指数', 'pmi', 'purchasing managers index', "purchasing managers' index"],
  ['失业率', 'unemployment rate'],
  ['就业人数', '就业人口', '就业人员数', 'number of employed persons', 'employed persons'],
  ['劳动参与率', '劳动力参与率', 'labor force participation rate', 'labour force participation rate'],
  ['货物出口额', '商品出口额', 'merchandise exports', 'goods exports'],
  ['货物进口额', '商品进口额', 'merchandise imports', 'goods imports'],
  ['外商直接投资', '外国直接投资', 'fdi', 'foreign direct investment'],
  ['社会消费品零售总额', '社会消费品零售额', 'total retail sales of consumer goods'],
  ['居民人均可支配收入', '人均可支配收入', 'per capita disposable income'],
  ['发电量', '电力生产量', 'electricity generation', 'electricity production'],
  ['用电量', '电力消费量', 'electricity consumption'],
  ['二氧化碳排放量', 'co2排放量', 'co2 emissions', 'carbon dioxide emissions'],
];

export function normalizeMetricWording(term: string): string {
  return term.normalize('NFKC').trim().toLowerCase().replace(/s+/g, ' ')
    .replace(/^(?:国家|全国|年度|每年)+/u, '')
    .replace(/(?:统计数据|数据|指标|数值)+$/u, '')
    .replace(/人口数$/u, '人口');
}

const metricGroups = new Map(RESEARCH_METRIC_ALIASES.flatMap((group) =>
  group.map((term) => [normalizeMetricWording(term), group] as const),
));

export function metricAliases(term: string): readonly string[] {
  return metricGroups.get(normalizeMetricWording(term)) ?? [];
}

export function metricTranslationKey(term: string): string {
  return normalizeMetricWording(metricAliases(term)[0] ?? term);
}
