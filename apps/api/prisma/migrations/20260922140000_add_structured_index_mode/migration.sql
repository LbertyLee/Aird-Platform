ALTER TABLE "knowledge_libraries"
  ADD COLUMN IF NOT EXISTS "structured_index_mode" VARCHAR(16) NOT NULL DEFAULT 'hybrid';
