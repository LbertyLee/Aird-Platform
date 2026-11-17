-- 数据集模块不再向量化：移除向量相关列
DROP INDEX IF EXISTS "datasets_vector_status_idx";

ALTER TABLE "datasets" DROP COLUMN IF EXISTS "chunk_count";
ALTER TABLE "datasets" DROP COLUMN IF EXISTS "vector_synced_at";
ALTER TABLE "datasets" DROP COLUMN IF EXISTS "vector_status";
ALTER TABLE "datasets" DROP COLUMN IF EXISTS "vector_error";
