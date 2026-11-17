-- 对齐可维护字典类型：补齐 is_system、内置类型；dictionary_items.type 改 varchar；删除 DictType 枚举

CREATE TABLE IF NOT EXISTS "dictionary_types" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "description" VARCHAR(512),
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "dictionary_types_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dictionary_types" ADD COLUMN IF NOT EXISTS "is_system" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "dictionary_types" ADD COLUMN IF NOT EXISTS "description" VARCHAR(512);
ALTER TABLE "dictionary_types" ADD COLUMN IF NOT EXISTS "sort" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "dictionary_types" ADD COLUMN IF NOT EXISTS "status" "CommonStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "dictionary_types" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "dictionary_types_code_key" ON "dictionary_types"("code");
CREATE INDEX IF NOT EXISTS "dictionary_types_status_sort_idx" ON "dictionary_types"("status", "sort");

INSERT INTO "dictionary_types" ("id", "code", "name", "description", "sort", "status", "is_system", "created_at", "updated_at")
VALUES
  ('dict-type-country-region', 'country_region', '国家地区', '国家与地区', 10, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-type-organization', 'organization', '机构', '数据来源机构', 20, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-type-industry', 'industry', '行业', '行业分类', 30, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-type-unit', 'unit', '单位', '计量单位', 40, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-type-time-granularity', 'time_granularity', '时间粒度', '时间粒度', 50, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('dict-type-indicator-category', 'indicator_category', '指标分类', '标准指标分类', 60, 'active', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = COALESCE(EXCLUDED."description", "dictionary_types"."description"),
  "sort" = EXCLUDED."sort",
  "is_system" = true,
  "deleted_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'dictionary_items'
      AND column_name = 'type'
      AND udt_name = 'DictType'
  ) THEN
    ALTER TABLE "dictionary_items"
      ALTER COLUMN "type" TYPE VARCHAR(64)
      USING ("type"::text);
  ELSIF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'dictionary_items'
      AND column_name = 'type'
      AND data_type <> 'character varying'
  ) THEN
    ALTER TABLE "dictionary_items"
      ALTER COLUMN "type" TYPE VARCHAR(64)
      USING ("type"::text);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DictType') THEN
    DROP TYPE "DictType";
  END IF;
END $$;
