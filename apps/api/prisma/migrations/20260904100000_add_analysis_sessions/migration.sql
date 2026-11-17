CREATE TYPE "AnalysisSessionStatus" AS ENUM ('READY', 'PARTIAL', 'FAILED');

CREATE TABLE "analysis_sessions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "query" TEXT NOT NULL,
  "status" "AnalysisSessionStatus" NOT NULL DEFAULT 'READY',
  "selected_source_ids" JSONB NOT NULL,
  "selected_indicator_ids" JSONB,
  "source_summary" JSONB,
  "result_json" JSONB,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analysis_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "analysis_sessions_user_id_created_at_idx"
  ON "analysis_sessions"("user_id", "created_at");
CREATE INDEX "analysis_sessions_status_created_at_idx"
  ON "analysis_sessions"("status", "created_at");

ALTER TABLE "analysis_sessions"
  ADD CONSTRAINT "analysis_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
