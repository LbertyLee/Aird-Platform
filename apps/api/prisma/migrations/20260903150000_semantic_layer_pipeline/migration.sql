-- Semantic Layer + Ingestion Pipeline

CREATE TYPE "DatasetVersionStatus" AS ENUM ('uploaded', 'parsing', 'schema_detected', 'validating', 'normalized', 'indexing', 'ready', 'failed');
CREATE TYPE "IngestionTargetType" AS ENUM ('dataset', 'knowledge');
CREATE TYPE "IngestionJobStatus" AS ENUM ('pending', 'running', 'succeeded', 'failed', 'cancelled');
CREATE TYPE "KnowledgeVersionStatus" AS ENUM ('uploaded', 'parsing', 'chunking', 'indexing', 'ready', 'failed');
CREATE TYPE "QueryRouteType" AS ENUM ('structured', 'semantic', 'hybrid');
CREATE TYPE "AiQueryStatus" AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE "EvidenceType" AS ENUM ('sql', 'document', 'vector', 'external');

CREATE TABLE "indicator_aliases" (
    "id" TEXT NOT NULL,
    "indicator_id" TEXT NOT NULL,
    "alias" VARCHAR(256) NOT NULL,
    "alias_type" VARCHAR(32) NOT NULL DEFAULT 'synonym',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "indicator_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_versions" (
    "id" TEXT NOT NULL,
    "dataset_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" VARCHAR(64),
    "raw_object_path" VARCHAR(512) NOT NULL,
    "status" "DatasetVersionStatus" NOT NULL DEFAULT 'uploaded',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "row_count" INTEGER NOT NULL DEFAULT 0,
    "size_bytes" INTEGER,
    "storage_type" "StorageType" NOT NULL DEFAULT 'KNOWLEDGE',
    "error_message" VARCHAR(1024),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dataset_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_schemas" (
    "id" TEXT NOT NULL,
    "dataset_version_id" TEXT NOT NULL,
    "schema_json" JSONB NOT NULL,
    "schema_hash" VARCHAR(64) NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_schemas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_fields" (
    "id" TEXT NOT NULL,
    "dataset_schema_id" TEXT NOT NULL,
    "field_name" VARCHAR(128) NOT NULL,
    "display_name" VARCHAR(256),
    "data_type" VARCHAR(32) NOT NULL,
    "semantic_type" VARCHAR(32),
    "description" VARCHAR(512),
    "unit" VARCHAR(64),
    "nullable" BOOLEAN NOT NULL DEFAULT true,
    "is_primary_key" BOOLEAN NOT NULL DEFAULT false,
    "ordinal" INTEGER NOT NULL DEFAULT 0,
    "sample_values" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dataset_fields_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dataset_records" (
    "id" TEXT NOT NULL,
    "dataset_version_id" TEXT NOT NULL,
    "row_index" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dataset_records_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "indicator_field_mappings" (
    "id" TEXT NOT NULL,
    "indicator_id" TEXT NOT NULL,
    "dataset_field_id" TEXT NOT NULL,
    "aggregation" VARCHAR(32) NOT NULL DEFAULT 'SUM',
    "formula" VARCHAR(512),
    "condition" VARCHAR(512),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "indicator_field_mappings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ingestion_jobs" (
    "id" TEXT NOT NULL,
    "target_type" "IngestionTargetType" NOT NULL,
    "target_id" TEXT NOT NULL,
    "dataset_version_id" TEXT,
    "knowledge_version_id" TEXT,
    "job_type" VARCHAR(32) NOT NULL DEFAULT 'full',
    "status" "IngestionJobStatus" NOT NULL DEFAULT 'pending',
    "current_step" VARCHAR(64),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "knowledge_versions" (
    "id" TEXT NOT NULL,
    "knowledge_item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "checksum" VARCHAR(64),
    "minio_object_path" VARCHAR(512) NOT NULL,
    "file_size" INTEGER,
    "status" "KnowledgeVersionStatus" NOT NULL DEFAULT 'uploaded',
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "error_message" VARCHAR(1024),
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "knowledge_version_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "page_number" INTEGER,
    "section" VARCHAR(256),
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "milvus_id" VARCHAR(128),
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "semantic_entities" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "canonical_name" VARCHAR(256) NOT NULL,
    "entity_type" VARCHAR(64) NOT NULL DEFAULT 'company',
    "description" VARCHAR(512),
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "semantic_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "semantic_entity_aliases" (
    "id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "alias" VARCHAR(256) NOT NULL,
    "alias_type" VARCHAR(32) NOT NULL DEFAULT 'synonym',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "semantic_entity_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "semantic_concepts" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(128) NOT NULL,
    "name" VARCHAR(256) NOT NULL,
    "concept_type" VARCHAR(64) NOT NULL DEFAULT 'industry',
    "description" VARCHAR(512),
    "status" "CommonStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "semantic_concepts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "semantic_concept_aliases" (
    "id" TEXT NOT NULL,
    "concept_id" TEXT NOT NULL,
    "alias" VARCHAR(256) NOT NULL,
    "alias_type" VARCHAR(32) NOT NULL DEFAULT 'synonym',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "semantic_concept_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_queries" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "session_id" VARCHAR(64),
    "user_query" TEXT NOT NULL,
    "intent" VARCHAR(64),
    "route_type" "QueryRouteType" NOT NULL DEFAULT 'semantic',
    "status" "AiQueryStatus" NOT NULL DEFAULT 'pending',
    "query_plan_json" JSONB,
    "answer" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    CONSTRAINT "ai_queries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "semantic_queries" (
    "id" TEXT NOT NULL,
    "ai_query_id" TEXT NOT NULL,
    "metrics_json" JSONB,
    "entities_json" JSONB,
    "dimensions_json" JSONB,
    "concepts_json" JSONB,
    "time_json" JSONB,
    "resolved_query_json" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "semantic_queries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "query_evidence" (
    "id" TEXT NOT NULL,
    "ai_query_id" TEXT NOT NULL,
    "evidence_type" "EvidenceType" NOT NULL,
    "source_type" VARCHAR(64) NOT NULL,
    "source_id" VARCHAR(128),
    "sql" TEXT,
    "content" TEXT,
    "score" DOUBLE PRECISION,
    "metadata_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "query_evidence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dataset_versions_dataset_id_version_key" ON "dataset_versions"("dataset_id", "version");
CREATE INDEX "dataset_versions_dataset_id_is_current_idx" ON "dataset_versions"("dataset_id", "is_current");
CREATE INDEX "dataset_versions_status_idx" ON "dataset_versions"("status");
CREATE UNIQUE INDEX "dataset_schemas_dataset_version_id_key" ON "dataset_schemas"("dataset_version_id");
CREATE INDEX "dataset_fields_dataset_schema_id_ordinal_idx" ON "dataset_fields"("dataset_schema_id", "ordinal");
CREATE INDEX "dataset_fields_field_name_idx" ON "dataset_fields"("field_name");
CREATE UNIQUE INDEX "dataset_records_dataset_version_id_row_index_key" ON "dataset_records"("dataset_version_id", "row_index");
CREATE INDEX "dataset_records_dataset_version_id_idx" ON "dataset_records"("dataset_version_id");
CREATE INDEX "indicator_aliases_indicator_id_idx" ON "indicator_aliases"("indicator_id");
CREATE INDEX "indicator_aliases_alias_idx" ON "indicator_aliases"("alias");
CREATE INDEX "indicator_field_mappings_indicator_id_status_idx" ON "indicator_field_mappings"("indicator_id", "status");
CREATE INDEX "indicator_field_mappings_dataset_field_id_idx" ON "indicator_field_mappings"("dataset_field_id");
CREATE INDEX "ingestion_jobs_target_type_target_id_idx" ON "ingestion_jobs"("target_type", "target_id");
CREATE INDEX "ingestion_jobs_status_created_at_idx" ON "ingestion_jobs"("status", "created_at");
CREATE UNIQUE INDEX "knowledge_versions_knowledge_item_id_version_key" ON "knowledge_versions"("knowledge_item_id", "version");
CREATE INDEX "knowledge_versions_knowledge_item_id_is_current_idx" ON "knowledge_versions"("knowledge_item_id", "is_current");
CREATE INDEX "knowledge_versions_status_idx" ON "knowledge_versions"("status");
CREATE UNIQUE INDEX "document_chunks_knowledge_version_id_chunk_index_key" ON "document_chunks"("knowledge_version_id", "chunk_index");
CREATE INDEX "document_chunks_knowledge_version_id_idx" ON "document_chunks"("knowledge_version_id");
CREATE UNIQUE INDEX "semantic_entities_code_key" ON "semantic_entities"("code");
CREATE INDEX "semantic_entities_status_idx" ON "semantic_entities"("status");
CREATE INDEX "semantic_entity_aliases_entity_id_idx" ON "semantic_entity_aliases"("entity_id");
CREATE INDEX "semantic_entity_aliases_alias_idx" ON "semantic_entity_aliases"("alias");
CREATE UNIQUE INDEX "semantic_concepts_code_key" ON "semantic_concepts"("code");
CREATE INDEX "semantic_concepts_status_idx" ON "semantic_concepts"("status");
CREATE INDEX "semantic_concept_aliases_concept_id_idx" ON "semantic_concept_aliases"("concept_id");
CREATE INDEX "semantic_concept_aliases_alias_idx" ON "semantic_concept_aliases"("alias");
CREATE INDEX "ai_queries_status_created_at_idx" ON "ai_queries"("status", "created_at");
CREATE INDEX "ai_queries_session_id_idx" ON "ai_queries"("session_id");
CREATE UNIQUE INDEX "semantic_queries_ai_query_id_key" ON "semantic_queries"("ai_query_id");
CREATE INDEX "query_evidence_ai_query_id_idx" ON "query_evidence"("ai_query_id");
CREATE INDEX "query_evidence_evidence_type_idx" ON "query_evidence"("evidence_type");

ALTER TABLE "indicator_aliases" ADD CONSTRAINT "indicator_aliases_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_versions" ADD CONSTRAINT "dataset_versions_dataset_id_fkey" FOREIGN KEY ("dataset_id") REFERENCES "datasets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_schemas" ADD CONSTRAINT "dataset_schemas_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_fields" ADD CONSTRAINT "dataset_fields_dataset_schema_id_fkey" FOREIGN KEY ("dataset_schema_id") REFERENCES "dataset_schemas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_records" ADD CONSTRAINT "dataset_records_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "indicator_field_mappings" ADD CONSTRAINT "indicator_field_mappings_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "indicator_field_mappings" ADD CONSTRAINT "indicator_field_mappings_dataset_field_id_fkey" FOREIGN KEY ("dataset_field_id") REFERENCES "dataset_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_dataset_version_id_fkey" FOREIGN KEY ("dataset_version_id") REFERENCES "dataset_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_knowledge_version_id_fkey" FOREIGN KEY ("knowledge_version_id") REFERENCES "knowledge_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "knowledge_versions" ADD CONSTRAINT "knowledge_versions_knowledge_item_id_fkey" FOREIGN KEY ("knowledge_item_id") REFERENCES "knowledge_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_knowledge_version_id_fkey" FOREIGN KEY ("knowledge_version_id") REFERENCES "knowledge_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_entity_aliases" ADD CONSTRAINT "semantic_entity_aliases_entity_id_fkey" FOREIGN KEY ("entity_id") REFERENCES "semantic_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_concept_aliases" ADD CONSTRAINT "semantic_concept_aliases_concept_id_fkey" FOREIGN KEY ("concept_id") REFERENCES "semantic_concepts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "semantic_queries" ADD CONSTRAINT "semantic_queries_ai_query_id_fkey" FOREIGN KEY ("ai_query_id") REFERENCES "ai_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "query_evidence" ADD CONSTRAINT "query_evidence_ai_query_id_fkey" FOREIGN KEY ("ai_query_id") REFERENCES "ai_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
