-- 智能体分类改为字典编码，并为用户个人智能体增加所有者隔离。

-- Do not infer a partial unique index here. Existing production databases may
-- have been created before the soft-delete index migration was introduced.
UPDATE "dictionary_types"
SET
  "name" = '智能体分类',
  "description" = '智能体中心的分类选项',
  "sort" = 75,
  "is_system" = true,
  "deleted_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "code" = 'agent_category' AND "deleted_at" IS NULL;

INSERT INTO "dictionary_types" (
  "id", "code", "name", "description", "sort", "status", "is_system", "created_at", "updated_at"
)
SELECT
  'dict-type-agent-category',
  'agent_category',
  '智能体分类',
  '智能体中心的分类选项',
  75,
  'active',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "dictionary_types"
  WHERE "code" = 'agent_category' AND "deleted_at" IS NULL
);

UPDATE "dictionary_items" AS target
SET
  "name" = source."name",
  "description" = source."description",
  "sort" = source."sort",
  "status" = 'active',
  "deleted_at" = NULL,
  "updated_at" = CURRENT_TIMESTAMP
FROM (
  SELECT 'agent_category', 'learning', '学习', '智能体分类', 10
  UNION ALL SELECT 'agent_category', 'writing', '写作', '智能体分类', 20
  UNION ALL SELECT 'agent_category', 'entertainment', '娱乐', '智能体分类', 30
  UNION ALL SELECT 'agent_category', 'workplace', '职场', '智能体分类', 40
  UNION ALL SELECT 'agent_category', 'ai_tools', 'AI工具', '智能体分类', 50
  UNION ALL SELECT 'agent_category', 'public_config', '公开配置', '智能体分类', 60
  UNION ALL SELECT 'agent_category', 'other', '其他', '智能体分类', 999
) AS source("type", "code", "name", "description", "sort")
WHERE target."type" = source."type"
  AND target."code" = source."code"
  AND target."deleted_at" IS NULL;

INSERT INTO "dictionary_items" (
  "id", "type", "code", "name", "aliases", "description", "sort", "status", "vector_status", "created_at", "updated_at"
)
SELECT
  source."id",
  source."type",
  source."code",
  source."name",
  ARRAY[]::text[],
  source."description",
  source."sort",
  'active',
  'pending',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT 'dict-item-agent-learning', 'agent_category', 'learning', '学习', '智能体分类', 10
  UNION ALL SELECT 'dict-item-agent-writing', 'agent_category', 'writing', '写作', '智能体分类', 20
  UNION ALL SELECT 'dict-item-agent-entertainment', 'agent_category', 'entertainment', '娱乐', '智能体分类', 30
  UNION ALL SELECT 'dict-item-agent-workplace', 'agent_category', 'workplace', '职场', '智能体分类', 40
  UNION ALL SELECT 'dict-item-agent-ai-tools', 'agent_category', 'ai_tools', 'AI工具', '智能体分类', 50
  UNION ALL SELECT 'dict-item-agent-public-config', 'agent_category', 'public_config', '公开配置', '智能体分类', 60
  UNION ALL SELECT 'dict-item-agent-other', 'agent_category', 'other', '其他', '智能体分类', 999
) AS source("id", "type", "code", "name", "description", "sort")
WHERE NOT EXISTS (
  SELECT 1
  FROM "dictionary_items" AS existing
  WHERE existing."type" = source."type"
    AND existing."code" = source."code"
    AND existing."deleted_at" IS NULL
);

ALTER TABLE "agents" RENAME COLUMN "category" TO "category_code";
ALTER TABLE "agents" ADD COLUMN "owner_id" TEXT;

UPDATE "agents"
SET "category_code" = CASE "category_code"
  WHEN '学习' THEN 'learning'
  WHEN '写作' THEN 'writing'
  WHEN '娱乐' THEN 'entertainment'
  WHEN '职场' THEN 'workplace'
  WHEN 'AI工具' THEN 'ai_tools'
  WHEN '公开配置' THEN 'public_config'
  ELSE 'other'
END;

DROP INDEX "agents_status_category_sort_idx";
CREATE INDEX "agents_status_category_code_sort_idx"
  ON "agents"("status", "category_code", "sort");
CREATE INDEX "agents_owner_id_status_sort_idx"
  ON "agents"("owner_id", "status", "sort");

ALTER TABLE "agents"
  ADD CONSTRAINT "agents_owner_id_fkey"
  FOREIGN KEY ("owner_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
