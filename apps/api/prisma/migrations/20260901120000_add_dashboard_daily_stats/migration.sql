-- 运营看板日统计表（兼容已通过 db push 建表的环境）
CREATE TABLE IF NOT EXISTS "dashboard_daily_stats" (
    "id" TEXT NOT NULL,
    "stat_date" DATE NOT NULL,
    "user_total" INTEGER NOT NULL DEFAULT 0,
    "search_count" INTEGER NOT NULL DEFAULT 0,
    "data_volume" BIGINT NOT NULL DEFAULT 0,
    "agent_task_count" INTEGER NOT NULL DEFAULT 0,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dashboard_daily_stats_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "dashboard_daily_stats"
  ADD COLUMN IF NOT EXISTS "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai';

CREATE UNIQUE INDEX IF NOT EXISTS "dashboard_daily_stats_stat_date_key"
  ON "dashboard_daily_stats"("stat_date");

CREATE INDEX IF NOT EXISTS "dashboard_daily_stats_stat_date_idx"
  ON "dashboard_daily_stats"("stat_date");
