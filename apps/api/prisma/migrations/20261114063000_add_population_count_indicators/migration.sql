-- Country population is distinct from world_population; births are counts, not birth rates.
-- Preserve existing administrator-maintained definitions and disabled indicators.
BEGIN;
LOCK TABLE "indicators" IN SHARE ROW EXCLUSIVE MODE;

INSERT INTO "indicators" ("id", "code", "name", "definition", "unit", "category", "source", "updated_at")
SELECT v.*, CURRENT_TIMESTAMP FROM (VALUES
  ('wpp2024_population_total', 'population_total', '人口总量', '国家或地区人口总量。联合国 WPP 2024 使用7月1日人口；2024年及以后为中方案预测。', '人', '人口', '联合国 WPP 2024'),
  ('wpp2024_births', 'births', '出生人数', '一年内活产新生人口数量，不是出生率。联合国 WPP 原始千人单位转换为人。', '人', '人口', '联合国 WPP 2024'),
  ('wpp2024_net_migration', 'net_migration', '净迁移人数', '一年内迁入人数减迁出人数，可为负数；不是移民存量或迁入人数。联合国 WPP 原始千人单位转换为人。', '人', '人口', '联合国 WPP 2024')
 ) AS v(id, code, name, definition, unit, category, source)
WHERE NOT EXISTS (SELECT 1 FROM "indicators" existing WHERE existing.code = v.code AND existing.deleted_at IS NULL)
ON CONFLICT DO NOTHING;

INSERT INTO "indicator_aliases" ("id", "indicator_id", "alias")
SELECT 'wpp2024_alias_' || md5(i.code || ':' || a.alias), i.id, a.alias
FROM "indicators" i
JOIN (VALUES
  ('population_total', '人口总量'), ('population_total', '人口总数'), ('population_total', '总人口'), ('population_total', 'Total population'),
  ('births', '新生人口'), ('births', '出生人口'), ('births', 'Births'),
  ('net_migration', '净迁移人数'), ('net_migration', '净移民人数'), ('net_migration', 'Net migration')
) AS a(code, alias) ON i.code = a.code
WHERE i.deleted_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM "indicator_aliases" existing WHERE existing.indicator_id = i.id AND existing.alias = a.alias
);

COMMIT;
