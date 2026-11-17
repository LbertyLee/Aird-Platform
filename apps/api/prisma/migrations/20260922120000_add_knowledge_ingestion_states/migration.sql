-- Add explicit ingestion checkpoints for resumability and observability.
ALTER TYPE "KnowledgeVersionStatus" ADD VALUE IF NOT EXISTS 'parsed';
ALTER TYPE "KnowledgeVersionStatus" ADD VALUE IF NOT EXISTS 'chunked';
ALTER TYPE "KnowledgeVersionStatus" ADD VALUE IF NOT EXISTS 'indexed';
