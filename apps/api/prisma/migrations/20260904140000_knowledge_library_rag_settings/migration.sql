-- AlterTable: 知识库 RAG 配置字段
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "chunk_method" VARCHAR(32) NOT NULL DEFAULT 'smart';
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "chunk_size" INTEGER NOT NULL DEFAULT 800;
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "chunk_overlap" INTEGER NOT NULL DEFAULT 120;
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "embedding_model" VARCHAR(128) NOT NULL DEFAULT 'text-embedding-v3';
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "recall_top_k" INTEGER NOT NULL DEFAULT 8;
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "similarity_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.6;
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "hybrid_semantic_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.7;
ALTER TABLE "knowledge_libraries" ADD COLUMN IF NOT EXISTS "hybrid_keyword_weight" DOUBLE PRECISION NOT NULL DEFAULT 0.3;

COMMENT ON COLUMN "knowledge_libraries"."chunk_method" IS '分段方式：smart / fixed';
COMMENT ON COLUMN "knowledge_libraries"."chunk_size" IS '分段长度（字符）';
COMMENT ON COLUMN "knowledge_libraries"."chunk_overlap" IS '重叠长度（字符）';
COMMENT ON COLUMN "knowledge_libraries"."embedding_model" IS '向量模型标识';
COMMENT ON COLUMN "knowledge_libraries"."recall_top_k" IS '默认召回条数 TopK';
COMMENT ON COLUMN "knowledge_libraries"."similarity_threshold" IS '相似度阈值（0~1）';
COMMENT ON COLUMN "knowledge_libraries"."hybrid_semantic_weight" IS '混合检索语义权重';
COMMENT ON COLUMN "knowledge_libraries"."hybrid_keyword_weight" IS '混合检索关键词权重';
