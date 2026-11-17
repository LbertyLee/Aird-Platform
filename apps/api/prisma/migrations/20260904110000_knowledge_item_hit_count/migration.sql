-- AlterTable
ALTER TABLE "knowledge_items" ADD COLUMN "hit_count" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "knowledge_items"."hit_count" IS '检索命中次数（向量/RAG 命中该知识条目时累加）';
