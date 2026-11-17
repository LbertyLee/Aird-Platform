-- CreateEnum
CREATE TYPE "KnowledgeAuditStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "KnowledgeVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "KnowledgePublishStatus" AS ENUM ('draft', 'published', 'unpublished');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('admin', 'research_upload');

-- CreateEnum
CREATE TYPE "KnowledgeAuditAction" AS ENUM ('approve', 'reject', 'resubmit');

-- CreateTable
CREATE TABLE "knowledge_categories" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "parent_id" TEXT,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "description" VARCHAR(512),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_tags" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_items" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(256) NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "summary" TEXT,
    "content" TEXT,
    "visibility" "KnowledgeVisibility" NOT NULL DEFAULT 'private',
    "audit_status" "KnowledgeAuditStatus" NOT NULL DEFAULT 'pending',
    "publish_status" "KnowledgePublishStatus" NOT NULL DEFAULT 'draft',
    "category_id" TEXT,
    "source_type" "KnowledgeSourceType" NOT NULL DEFAULT 'admin',
    "source_meta" JSONB,
    "file_key" VARCHAR(512),
    "file_name" VARCHAR(256),
    "mime_type" VARCHAR(128),
    "file_size" INTEGER,
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "vector_synced_at" TIMESTAMP(3),
    "vector_status" "VectorSyncStatus" NOT NULL DEFAULT 'pending',
    "vector_error" VARCHAR(1024),
    "submitted_by" TEXT,
    "audited_by" TEXT,
    "audited_at" TIMESTAMP(3),
    "reject_reason" VARCHAR(1024),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_item_tags" (
    "knowledge_item_id" TEXT NOT NULL,
    "tag_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_item_tags_pkey" PRIMARY KEY ("knowledge_item_id","tag_id")
);

-- CreateTable
CREATE TABLE "knowledge_audit_records" (
    "id" TEXT NOT NULL,
    "knowledge_item_id" TEXT NOT NULL,
    "action" "KnowledgeAuditAction" NOT NULL,
    "actor_id" TEXT,
    "remark" VARCHAR(1024),
    "snapshot" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_audit_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_categories_code_key" ON "knowledge_categories"("code");

-- CreateIndex
CREATE INDEX "knowledge_categories_parent_id_sort_idx" ON "knowledge_categories"("parent_id", "sort");

-- CreateIndex
CREATE INDEX "knowledge_categories_status_idx" ON "knowledge_categories"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_tags_code_key" ON "knowledge_tags"("code");

-- CreateIndex
CREATE INDEX "knowledge_tags_status_idx" ON "knowledge_tags"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_items_code_key" ON "knowledge_items"("code");

-- CreateIndex
CREATE INDEX "knowledge_items_audit_status_publish_status_idx" ON "knowledge_items"("audit_status", "publish_status");

-- CreateIndex
CREATE INDEX "knowledge_items_visibility_publish_status_idx" ON "knowledge_items"("visibility", "publish_status");

-- CreateIndex
CREATE INDEX "knowledge_items_category_id_idx" ON "knowledge_items"("category_id");

-- CreateIndex
CREATE INDEX "knowledge_items_submitted_by_idx" ON "knowledge_items"("submitted_by");

-- CreateIndex
CREATE INDEX "knowledge_items_vector_status_idx" ON "knowledge_items"("vector_status");

-- CreateIndex
CREATE INDEX "knowledge_items_source_type_idx" ON "knowledge_items"("source_type");

-- CreateIndex
CREATE INDEX "knowledge_item_tags_tag_id_idx" ON "knowledge_item_tags"("tag_id");

-- CreateIndex
CREATE INDEX "knowledge_audit_records_knowledge_item_id_created_at_idx" ON "knowledge_audit_records"("knowledge_item_id", "created_at");

-- CreateIndex
CREATE INDEX "knowledge_audit_records_actor_id_idx" ON "knowledge_audit_records"("actor_id");

-- AddForeignKey
ALTER TABLE "knowledge_categories" ADD CONSTRAINT "knowledge_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "knowledge_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_audited_by_fkey" FOREIGN KEY ("audited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_tags" ADD CONSTRAINT "knowledge_item_tags_knowledge_item_id_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_item_tags" ADD CONSTRAINT "knowledge_item_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "knowledge_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_audit_records" ADD CONSTRAINT "knowledge_audit_records_knowledge_item_id_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_audit_records" ADD CONSTRAINT "knowledge_audit_records_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
