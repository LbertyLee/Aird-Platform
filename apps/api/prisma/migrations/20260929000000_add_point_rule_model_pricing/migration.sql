ALTER TABLE "point_rule_configs"
ADD COLUMN "model_pricing" JSONB NOT NULL DEFAULT '{}';
