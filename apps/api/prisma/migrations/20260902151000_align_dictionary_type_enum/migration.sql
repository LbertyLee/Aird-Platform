-- 将 dictionary_items.type 从 varchar 对齐为 Prisma DictType 枚举

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DictType') THEN
    CREATE TYPE "DictType" AS ENUM (
      'country_region',
      'organization',
      'industry',
      'unit',
      'time_granularity',
      'indicator_category'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dictionary_items'
      AND column_name = 'type'
      AND udt_name = 'varchar'
  ) THEN
    ALTER TABLE "dictionary_items"
      ALTER COLUMN "type" TYPE "DictType"
      USING ("type"::"DictType");
  END IF;
END $$;
