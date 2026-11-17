-- AlterTable
ALTER TABLE "knowledge_items" ADD COLUMN "library_id" TEXT;
ALTER TABLE "knowledge_items" ADD COLUMN "group_code" VARCHAR(128);

-- CreateIndex
CREATE INDEX "knowledge_items_library_id_idx" ON "knowledge_items"("library_id");
CREATE INDEX "knowledge_items_group_code_idx" ON "knowledge_items"("group_code");

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_library_id_fkey" FOREIGN KEY ("library_id") REFERENCES "knowledge_libraries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
