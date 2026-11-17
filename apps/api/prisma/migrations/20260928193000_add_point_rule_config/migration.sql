-- AlterTable
ALTER TABLE "membership_levels" ADD COLUMN "monthly_points" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "point_rule_configs" (
    "id" TEXT NOT NULL,
    "registration_points" INTEGER NOT NULL DEFAULT 500,
    "monthly_free_points" INTEGER NOT NULL DEFAULT 500,
    "daily_points" INTEGER NOT NULL DEFAULT 50,
    "free_monthly_limit" INTEGER NOT NULL DEFAULT 2000,
    "search_cost_points" INTEGER NOT NULL DEFAULT 1,
    "yuan_per_point" DECIMAL(12,6) NOT NULL DEFAULT 0.003,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "point_rule_configs_pkey" PRIMARY KEY ("id")
);

-- Seed default rules and backfill known membership monthly points
INSERT INTO "point_rule_configs" (
  "id",
  "registration_points",
  "monthly_free_points",
  "daily_points",
  "free_monthly_limit",
  "search_cost_points",
  "yuan_per_point",
  "updated_at"
) VALUES (
  'default',
  500,
  500,
  50,
  2000,
  1,
  0.003,
  CURRENT_TIMESTAMP
);

UPDATE "membership_levels" SET "monthly_points" = 26000 WHERE "code" = 'pro' AND "deleted_at" IS NULL;
UPDATE "membership_levels" SET "monthly_points" = 12000 WHERE "code" = 'plus' AND "deleted_at" IS NULL;
UPDATE "membership_levels" SET "monthly_points" = 5000 WHERE "code" IN ('normal', 'standard') AND "deleted_at" IS NULL;
