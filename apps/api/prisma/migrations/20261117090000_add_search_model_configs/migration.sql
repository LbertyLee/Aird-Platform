CREATE TABLE "search_model_configs" (
    "id" TEXT NOT NULL,
    "value" VARCHAR(128) NOT NULL,
    "label" VARCHAR(128) NOT NULL,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_model_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "search_model_configs_value_key" ON "search_model_configs"("value");
CREATE INDEX "search_model_configs_status_sort_idx" ON "search_model_configs"("status", "sort");

INSERT INTO "search_model_configs" ("id", "value", "label", "status", "sort", "updated_at")
VALUES
  ('search-model-qwen37-plus', 'qwen3.7-plus-2026-05-26', '标准模型', 'active', 10, CURRENT_TIMESTAMP),
  ('search-model-qwen38-max', 'qwen3.8-max', '复杂推理模型', 'active', 20, CURRENT_TIMESTAMP)
ON CONFLICT ("value") DO NOTHING;
