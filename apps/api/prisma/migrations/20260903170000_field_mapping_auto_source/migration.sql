-- CreateEnum
CREATE TYPE "FieldMappingSource" AS ENUM ('manual', 'auto', 'auto_pending');

-- AlterTable
ALTER TABLE "indicator_field_mappings"
  ADD COLUMN "source" "FieldMappingSource" NOT NULL DEFAULT 'manual',
  ADD COLUMN "confidence" DOUBLE PRECISION,
  ADD COLUMN "match_term" VARCHAR(256);

-- CreateIndex
CREATE INDEX "indicator_field_mappings_source_status_idx"
  ON "indicator_field_mappings"("source", "status");
