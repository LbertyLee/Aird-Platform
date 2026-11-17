ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "sheet_name" VARCHAR(256),
  ADD COLUMN IF NOT EXISTS "table_name" VARCHAR(256),
  ADD COLUMN IF NOT EXISTS "row_start" INTEGER,
  ADD COLUMN IF NOT EXISTS "row_end" INTEGER,
  ADD COLUMN IF NOT EXISTS "search_text" TEXT;

CREATE INDEX IF NOT EXISTS "document_chunks_search_text_idx"
  ON "document_chunks" USING GIN (to_tsvector('simple', coalesce("search_text", '')));
