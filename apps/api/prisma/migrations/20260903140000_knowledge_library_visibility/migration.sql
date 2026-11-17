-- AlterTable
ALTER TABLE "knowledge_libraries" ADD COLUMN "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'private';

-- CreateIndex
CREATE INDEX "knowledge_libraries_visibility_status_idx" ON "knowledge_libraries"("visibility", "status");
