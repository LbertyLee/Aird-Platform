CREATE TABLE "agents" (
  "id" TEXT NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "author" VARCHAR(128) NOT NULL,
  "icon" VARCHAR(16),
  "icon_color" VARCHAR(32),
  "usage_count" INTEGER NOT NULL DEFAULT 0,
  "status" "CommonStatus" NOT NULL DEFAULT 'active',
  "sort" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "agents_status_category_sort_idx" ON "agents"("status", "category", "sort");
