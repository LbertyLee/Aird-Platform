-- CreateEnum
CREATE TYPE "AnnouncementAudienceScope" AS ENUM ('all_users', 'specified_roles', 'pro_members');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('draft', 'published', 'recalled');

-- CreateEnum
CREATE TYPE "BusinessNotificationStatus" AS ENUM ('unread', 'read');

-- CreateEnum
CREATE TYPE "SensitiveWordCategory" AS ENUM ('political', 'porn', 'ad');

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(60) NOT NULL,
    "content" VARCHAR(500) NOT NULL,
    "audience_scope" "AnnouncementAudienceScope" NOT NULL DEFAULT 'all_users',
    "audience_role_ids" JSONB,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'draft',
    "published_at" TIMESTAMP(3),
    "recalled_at" TIMESTAMP(3),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_notifications" (
    "id" TEXT NOT NULL,
    "content" VARCHAR(512) NOT NULL,
    "receiver_id" TEXT NOT NULL,
    "status" "BusinessNotificationStatus" NOT NULL DEFAULT 'unread',
    "biz_type" VARCHAR(64) NOT NULL DEFAULT 'general',
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sensitive_words" (
    "id" TEXT NOT NULL,
    "word" VARCHAR(64) NOT NULL,
    "category" "SensitiveWordCategory" NOT NULL,
    "hit_count" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sensitive_words_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_quick_keywords" (
    "id" TEXT NOT NULL,
    "keyword" VARCHAR(128) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_quick_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_no_result_marks" (
    "id" TEXT NOT NULL,
    "keyword" VARCHAR(256) NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(256),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_no_result_marks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "announcements_status_created_at_idx" ON "announcements"("status", "created_at");

-- CreateIndex
CREATE INDEX "announcements_deleted_at_idx" ON "announcements"("deleted_at");

-- CreateIndex
CREATE INDEX "business_notifications_receiver_id_status_idx" ON "business_notifications"("receiver_id", "status");

-- CreateIndex
CREATE INDEX "business_notifications_sent_at_idx" ON "business_notifications"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "sensitive_words_word_key" ON "sensitive_words"("word");

-- CreateIndex
CREATE INDEX "sensitive_words_status_idx" ON "sensitive_words"("status");

-- CreateIndex
CREATE INDEX "sensitive_words_category_idx" ON "sensitive_words"("category");

-- CreateIndex
CREATE UNIQUE INDEX "search_quick_keywords_keyword_key" ON "search_quick_keywords"("keyword");

-- CreateIndex
CREATE INDEX "search_quick_keywords_enabled_sort_idx" ON "search_quick_keywords"("enabled", "sort");

-- CreateIndex
CREATE UNIQUE INDEX "search_no_result_marks_keyword_key" ON "search_no_result_marks"("keyword");

-- CreateIndex
CREATE INDEX "search_no_result_marks_handled_idx" ON "search_no_result_marks"("handled");

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_notifications" ADD CONSTRAINT "business_notifications_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
