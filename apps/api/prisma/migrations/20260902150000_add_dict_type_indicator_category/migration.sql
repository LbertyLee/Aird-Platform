-- 兼容两种库结构：
-- 1) 已有 DictType 枚举：追加 indicator_category
-- 2) type 列为 varchar（当前远程库）：无需 DDL，直接写入字符串即可
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'DictType'
  ) THEN
    ALTER TYPE "DictType" ADD VALUE IF NOT EXISTS 'indicator_category';
  END IF;
END $$;
