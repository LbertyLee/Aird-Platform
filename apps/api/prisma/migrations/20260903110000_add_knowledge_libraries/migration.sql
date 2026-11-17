-- CreateEnum
CREATE TYPE "KnowledgeLibraryType" AS ENUM ('normal', 'qa');

-- CreateTable
CREATE TABLE "knowledge_libraries" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "type" "KnowledgeLibraryType" NOT NULL DEFAULT 'normal',
    "intro" VARCHAR(1024),
    "group_code" VARCHAR(128),
    "icon" VARCHAR(16) NOT NULL DEFAULT E'📚',
    "color" VARCHAR(32) NOT NULL DEFAULT '#e6efff',
    "file_total" INTEGER NOT NULL DEFAULT 0,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_libraries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_libraries_code_idx" ON "knowledge_libraries"("code");

-- CreateIndex
CREATE INDEX "knowledge_libraries_group_code_idx" ON "knowledge_libraries"("group_code");

-- CreateIndex
CREATE INDEX "knowledge_libraries_type_status_idx" ON "knowledge_libraries"("type", "status");

-- CreateIndex
CREATE INDEX "knowledge_libraries_status_idx" ON "knowledge_libraries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_libraries_code_active_key"
  ON "knowledge_libraries"("code") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "knowledge_libraries" ADD CONSTRAINT "knowledge_libraries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_libraries" ADD CONSTRAINT "knowledge_libraries_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
