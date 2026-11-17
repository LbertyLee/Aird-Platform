-- Soft-deleted rows must not occupy business codes / identifiers.
-- Replace global unique indexes with partial unique indexes (deleted_at IS NULL).
-- Exception kept elsewhere: membership_orders.order_no remains globally unique for payment reconciliation.

-- dictionary_types.code
DROP INDEX IF EXISTS "dictionary_types_code_key";
CREATE UNIQUE INDEX "dictionary_types_code_active_key"
  ON "dictionary_types"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "dictionary_types_code_idx" ON "dictionary_types"("code");

-- roles.code
DROP INDEX IF EXISTS "roles_code_key";
CREATE UNIQUE INDEX "roles_code_active_key"
  ON "roles"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "roles_code_idx" ON "roles"("code");

-- permissions.code
DROP INDEX IF EXISTS "permissions_code_key";
CREATE UNIQUE INDEX "permissions_code_active_key"
  ON "permissions"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "permissions_code_idx" ON "permissions"("code");

-- membership_levels.code
DROP INDEX IF EXISTS "membership_levels_code_key";
CREATE UNIQUE INDEX "membership_levels_code_active_key"
  ON "membership_levels"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "membership_levels_code_idx" ON "membership_levels"("code");

-- membership_packages (level_id, package_type)
DROP INDEX IF EXISTS "membership_packages_level_id_package_type_key";
CREATE UNIQUE INDEX "membership_packages_level_package_active_key"
  ON "membership_packages"("level_id", "package_type") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "membership_packages_level_id_package_type_idx"
  ON "membership_packages"("level_id", "package_type");

-- indicators.code
DROP INDEX IF EXISTS "indicators_code_key";
CREATE UNIQUE INDEX "indicators_code_active_key"
  ON "indicators"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "indicators_code_idx" ON "indicators"("code");

-- indicator_source_mappings (indicator_id, data_source, source_field)
DROP INDEX IF EXISTS "indicator_source_mappings_indicator_id_data_source_source_f_key";
CREATE UNIQUE INDEX "indicator_source_mappings_active_key"
  ON "indicator_source_mappings"("indicator_id", "data_source", "source_field")
  WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "indicator_source_mappings_indicator_id_data_source_source_field_idx"
  ON "indicator_source_mappings"("indicator_id", "data_source", "source_field");

-- dictionary_items (type, code)
DROP INDEX IF EXISTS "dictionary_items_type_code_key";
CREATE UNIQUE INDEX "dictionary_items_type_code_active_key"
  ON "dictionary_items"("type", "code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "dictionary_items_type_code_idx"
  ON "dictionary_items"("type", "code");

-- datasets.code
DROP INDEX IF EXISTS "datasets_code_key";
CREATE UNIQUE INDEX "datasets_code_active_key"
  ON "datasets"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "datasets_code_idx" ON "datasets"("code");

-- knowledge_categories.code
DROP INDEX IF EXISTS "knowledge_categories_code_key";
CREATE UNIQUE INDEX "knowledge_categories_code_active_key"
  ON "knowledge_categories"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "knowledge_categories_code_idx" ON "knowledge_categories"("code");

-- knowledge_tags.code
DROP INDEX IF EXISTS "knowledge_tags_code_key";
CREATE UNIQUE INDEX "knowledge_tags_code_active_key"
  ON "knowledge_tags"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "knowledge_tags_code_idx" ON "knowledge_tags"("code");

-- knowledge_items.code
DROP INDEX IF EXISTS "knowledge_items_code_key";
CREATE UNIQUE INDEX "knowledge_items_code_active_key"
  ON "knowledge_items"("code") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "knowledge_items_code_idx" ON "knowledge_items"("code");

-- sensitive_words.word
DROP INDEX IF EXISTS "sensitive_words_word_key";
CREATE UNIQUE INDEX "sensitive_words_word_active_key"
  ON "sensitive_words"("word") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "sensitive_words_word_idx" ON "sensitive_words"("word");
