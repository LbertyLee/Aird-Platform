CREATE TABLE "research_branch_cache" (
    "id" TEXT NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source_ids" JSONB NOT NULL,
    "source_scores" JSONB,
    "cache_expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "research_branch_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "research_branch_cache_fingerprint_key"
  ON "research_branch_cache"("fingerprint");

CREATE INDEX "research_branch_cache_cache_expires_at_idx"
  ON "research_branch_cache"("cache_expires_at");
