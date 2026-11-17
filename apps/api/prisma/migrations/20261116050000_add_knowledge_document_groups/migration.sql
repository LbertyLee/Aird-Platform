CREATE TABLE "knowledge_document_groups" (
    "id" TEXT NOT NULL,
    "library_id" TEXT NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "knowledge_document_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "knowledge_document_groups_library_id_fkey" FOREIGN KEY ("library_id")
      REFERENCES "knowledge_libraries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "knowledge_document_groups_library_id_code_key"
  ON "knowledge_document_groups"("library_id", "code");
CREATE INDEX "knowledge_document_groups_library_id_idx"
  ON "knowledge_document_groups"("library_id");

-- Replace the old runtime backfill; future ungrouped documents must remain ungrouped.
UPDATE "knowledge_items" SET "group_code" = 'default'
WHERE "group_code" IS NULL AND "source_type" = 'research_upload' AND "deleted_at" IS NULL;
