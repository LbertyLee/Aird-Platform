const { PrismaClient, CommonStatus } = require('@prisma/client');

/**
 * 从操作日志还原的标准指标库（2026-09-02 删除前快照）。
 */
const INDICATORS = [
  {
    code: 'world_population',
    name: '世界人口总数',
    definition: '全球常住人口总量，通常按年中估算',
    unit: '人',
    category: '人口',
    source: '联合国人口司 (UN DESA)',
  },
  {
    code: 'crude_birth_rate',
    name: '出生率',
    definition: '每千人中的活产数',
    unit: '‰',
    category: '人口',
    source: '世界银行 WDI',
  },
  {
    code: 'tfr',
    name: '总和生育率',
    definition: '一名妇女在育龄期内平均生育子女数',
    unit: '人',
    category: '人口',
    source: '联合国人口展望',
  },
  {
    code: 'pop_natural_growth',
    name: '人口自然增长率',
    definition: '出生率减去死亡率，反映人口自然变动',
    unit: '‰',
    category: '人口',
    source: '世界银行 WDI',
  },
  {
    code: 'crude_death_rate',
    name: '死亡率',
    definition: '每千人中的死亡数',
    unit: '‰',
    category: '人口',
    source: '世界银行 WDI',
  },
  {
    code: 'urbanization_rate',
    name: '城镇化率',
    definition: '城镇人口占总人口比重',
    unit: '%',
    category: '人口',
    source: '联合国人居署',
  },
  {
    code: 'life_expectancy',
    name: '预期寿命',
    definition: '出生时预期寿命',
    unit: '岁',
    category: '人口',
    source: 'WHO / UN DESA',
  },
  {
    code: 'working_age_share',
    name: '劳动年龄人口占比',
    definition: '15-64岁人口占总人口比重',
    unit: '%',
    category: '人口',
    source: '世界银行 WDI',
  },
  {
    code: 'gdp_current_usd',
    name: '国内生产总值(现价美元)',
    definition: '按现价美元计的国内生产总值',
    unit: '美元',
    category: '宏观经济',
    source: '世界银行 WDI',
  },
  {
    code: 'gdp_real_growth',
    name: 'GDP实际增速',
    definition: '不变价GDP同比增速',
    unit: '%',
    category: '宏观经济',
    source: 'IMF WEO',
  },
  {
    code: 'gdp_per_capita',
    name: '人均GDP',
    definition: 'GDP除以年中人口',
    unit: '美元/人',
    category: '宏观经济',
    source: '世界银行 WDI',
  },
  {
    code: 'cpi_inflation',
    name: '通货膨胀率(CPI)',
    definition: '居民消费价格指数同比涨幅',
    unit: '%',
    category: '宏观经济',
    source: 'IMF / 各国统计局',
  },
  {
    code: 'goods_exports',
    name: '货物出口额',
    definition: '按现价美元计的货物出口总额',
    unit: '美元',
    category: '贸易',
    source: 'WTO / UN Comtrade',
  },
  {
    code: 'goods_imports',
    name: '货物进口额',
    definition: '按现价美元计的货物进口总额',
    unit: '美元',
    category: '贸易',
    source: 'WTO / UN Comtrade',
  },
  {
    code: 'cab_gdp',
    name: '经常账户余额占GDP比重',
    definition: '经常账户差额占GDP百分比',
    unit: '%',
    category: '国际收支',
    source: 'IMF BOP',
  },
  {
    code: 'fx_reserves',
    name: '外汇储备',
    definition: '官方外汇储备（不含黄金或含黄金视口径）',
    unit: '美元',
    category: '金融',
    source: 'IMF IFS',
  },
  {
    code: 'm2_growth',
    name: '广义货币增速',
    definition: '广义货币供应量同比增速',
    unit: '%',
    category: '金融',
    source: '各国央行 / IMF',
  },
];

/** 今日误删前创建过的字段映射（按指标编码 + 原 dataset_field_id） */
const FIELD_MAPPINGS = [
  {
    indicatorCode: 'gdp_per_capita',
    datasetFieldId: 'cmtl7ubu3001aqaogmyhmg4ay',
    aggregation: 'NONE',
    priority: 0,
  },
];

const p = new PrismaClient();

async function upsertIndicator(item) {
  const existing = await p.indicator.findFirst({
    where: { code: item.code },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    return p.indicator.update({
      where: { id: existing.id },
      data: {
        name: item.name,
        definition: item.definition,
        unit: item.unit,
        category: item.category,
        source: item.source,
        status: CommonStatus.active,
        deletedAt: null,
      },
    });
  }
  return p.indicator.create({
    data: {
      ...item,
      status: CommonStatus.active,
    },
  });
}

async function main() {
  const created = [];
  for (const item of INDICATORS) {
    const row = await upsertIndicator(item);
    created.push({ code: row.code, id: row.id, name: row.name });
    console.log(`ok ${row.code} -> ${row.id}`);
  }

  const byCode = new Map(created.map((r) => [r.code, r.id]));
  for (const m of FIELD_MAPPINGS) {
    const indicatorId = byCode.get(m.indicatorCode);
    if (!indicatorId) {
      console.warn(`skip mapping: missing indicator ${m.indicatorCode}`);
      continue;
    }
    const field = await p.datasetField.findUnique({
      where: { id: m.datasetFieldId },
    });
    if (!field) {
      console.warn(
        `skip mapping: dataset field ${m.datasetFieldId} not found`,
      );
      continue;
    }
    const exists = await p.indicatorFieldMapping.findFirst({
      where: {
        indicatorId,
        datasetFieldId: m.datasetFieldId,
      },
    });
    if (exists) {
      console.log(`mapping exists ${m.indicatorCode}`);
      continue;
    }
    const row = await p.indicatorFieldMapping.create({
      data: {
        indicatorId,
        datasetFieldId: m.datasetFieldId,
        aggregation: m.aggregation,
        priority: m.priority,
        status: CommonStatus.active,
      },
    });
    console.log(`mapping ok ${m.indicatorCode} -> ${row.id}`);
  }

  const total = await p.indicator.count({ where: { deletedAt: null } });
  console.log(`done. active indicators: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
