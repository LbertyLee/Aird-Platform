-- 来源管理字段 + 来源分类字典类型/预置项

ALTER TABLE "datasets" ADD COLUMN IF NOT EXISTS "name_en" VARCHAR(256);
ALTER TABLE "datasets" ADD COLUMN IF NOT EXISTS "category_code" VARCHAR(64);
ALTER TABLE "datasets" ADD COLUMN IF NOT EXISTS "region_level" VARCHAR(128);
ALTER TABLE "datasets" ADD COLUMN IF NOT EXISTS "website_url" VARCHAR(512);
ALTER TABLE "datasets" ADD COLUMN IF NOT EXISTS "remark" VARCHAR(512);
ALTER TABLE "datasets" ADD COLUMN IF NOT EXISTS "status" "CommonStatus" NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "datasets_status_category_code_idx" ON "datasets"("status", "category_code");

INSERT INTO "dictionary_types" ("id", "code", "name", "description", "sort", "status", "is_system", "created_at", "updated_at")
VALUES
  ('dict-type-source-category', 'source_category', '来源分类', '数据来源类型（国际组织/统计局/政府机构等）', 70, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sort" = EXCLUDED."sort",
  "is_system" = true,
  "deleted_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "dictionary_items" ("id", "type", "code", "name", "aliases", "description", "sort", "status", "vector_status", "created_at", "updated_at")
VALUES
  ('dict-item-source-intl-org', 'source_category', 'intl_org', '国际组织', ARRAY[]::text[], '国际组织类数据来源', 10, 'active', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-item-source-national-stats', 'source_category', 'national_stats', '各国统计局', ARRAY[]::text[], '各国统计局类数据来源', 20, 'active', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-item-source-cn-gov', 'source_category', 'cn_gov', '中国政府机构', ARRAY[]::text[], '中国政府机构类数据来源', 30, 'active', 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("type", "code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "sort" = EXCLUDED."sort",
  "status" = 'active',
  "deleted_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;
