ALTER TABLE "ResearchRun"
  ADD COLUMN "query_fingerprint" VARCHAR(64),
  ADD COLUMN "filters" JSONB,
  ADD COLUMN "cache_expires_at" TIMESTAMP(3),
  ADD COLUMN "source_scores" JSONB;

CREATE INDEX "ResearchRun_query_fingerprint_status_cache_expires_at_idx"
  ON "ResearchRun"("query_fingerprint", "status", "cache_expires_at");
