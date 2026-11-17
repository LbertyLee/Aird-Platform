-- Add vector sync columns to indicators and dictionary_items (datasets already has them)

ALTER TABLE "indicators"
  ADD COLUMN IF NOT EXISTS "vector_status" "VectorSyncStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "vector_error" VARCHAR(1024);

ALTER TABLE "dictionary_items"
  ADD COLUMN IF NOT EXISTS "vector_status" "VectorSyncStatus" NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "vector_error" VARCHAR(1024);

CREATE INDEX IF NOT EXISTS "indicators_vector_status_idx" ON "indicators"("vector_status");
CREATE INDEX IF NOT EXISTS "dictionary_items_vector_status_idx" ON "dictionary_items"("vector_status");
