CREATE TABLE "structured_data_records" (
    "id" TEXT NOT NULL,
    "namespace" VARCHAR(32) NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "structured_data_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "structured_data_records_namespace_fingerprint_key"
    ON "structured_data_records"("namespace", "fingerprint");
CREATE INDEX "structured_data_records_namespace_created_at_idx"
    ON "structured_data_records"("namespace", "created_at");
