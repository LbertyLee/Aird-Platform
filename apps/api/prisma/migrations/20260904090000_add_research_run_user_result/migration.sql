ALTER TABLE "ResearchRun" ADD COLUMN "user_id" TEXT;
ALTER TABLE "ResearchRun" ADD COLUMN "result_json" JSONB;

CREATE INDEX "ResearchRun_user_id_createdAt_idx"
  ON "ResearchRun"("user_id", "createdAt");

ALTER TABLE "ResearchRun"
  ADD CONSTRAINT "ResearchRun_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
