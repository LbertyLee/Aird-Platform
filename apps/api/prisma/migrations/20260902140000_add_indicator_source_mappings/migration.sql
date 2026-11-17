-- CreateEnum
CREATE TYPE "IndicatorSourceTransform" AS ENUM ('direct');

-- CreateTable
CREATE TABLE "indicator_source_mappings" (
    "id" TEXT NOT NULL,
    "indicator_id" TEXT NOT NULL,
    "data_source" VARCHAR(256) NOT NULL,
    "source_field" VARCHAR(256) NOT NULL,
    "transform" "IndicatorSourceTransform" NOT NULL DEFAULT 'direct',
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "indicator_source_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "indicator_source_mappings_indicator_id_data_source_source_field_key" ON "indicator_source_mappings"("indicator_id", "data_source", "source_field");

-- CreateIndex
CREATE INDEX "indicator_source_mappings_indicator_id_status_idx" ON "indicator_source_mappings"("indicator_id", "status");

-- AddForeignKey
ALTER TABLE "indicator_source_mappings" ADD CONSTRAINT "indicator_source_mappings_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
