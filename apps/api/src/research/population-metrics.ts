/** WPP counts are in thousands; fertility is children per woman, not a birth rate. */
export const WPP_METRICS = [
  {
    code: 'population_total',
    name: '人口总量',
    column: 'TPopulation1July',
    factor: 1000,
    unit: '人',
    pattern:
      /人口总量|人口总数|总人口|total\s*population|population[ ,]*total/i,
  },
  {
    code: 'tfr',
    name: '总和生育率',
    column: 'TFR',
    factor: 1,
    unit: '人',
    pattern: /总和生育率|总生育率|total\s*fertility|\btfr\b/i,
  },
  {
    code: 'births',
    name: '出生人数',
    column: 'Births',
    factor: 1000,
    unit: '人',
    pattern: /新生人口|出生人[口数]|新生儿|\bbirths\b|newborn/i,
  },
  {
    code: 'net_migration',
    name: '净迁移人数',
    column: 'NetMigrations',
    factor: 1000,
    unit: '人',
    pattern: /净迁移|净移民|移民人口|迁移人口|移民人数|net\s*migration/i,
  },
] as const;
