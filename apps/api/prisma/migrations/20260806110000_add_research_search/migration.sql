CREATE TYPE "SourceOrigin" AS ENUM ('UPLOAD', 'BRAVE', 'LOCAL');
CREATE TYPE "StorageType" AS ENUM ('STRUCTURED', 'KNOWLEDGE');
CREATE TYPE "ResearchRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED');

CREATE TABLE "ResearchSource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "origin" "SourceOrigin" NOT NULL,
    "storageType" "StorageType" NOT NULL,
    "sourceUrl" TEXT,
    "mimeType" TEXT,
    "textContent" TEXT NOT NULL,
    "searchText" TEXT NOT NULL,
    "structuredData" JSONB,
    "metadata" JSONB,
    "recordCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ResearchRun" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "status" "ResearchRunStatus" NOT NULL DEFAULT 'RUNNING',
    "matchedLocally" BOOLEAN NOT NULL DEFAULT false,
    "usedBrave" BOOLEAN NOT NULL DEFAULT false,
    "sourceIds" JSONB,
    "reportTitle" TEXT,
    "reportMarkdown" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResearchRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ResearchSource_sourceUrl_key" ON "ResearchSource"("sourceUrl");
CREATE INDEX "ResearchSource_storageType_createdAt_idx" ON "ResearchSource"("storageType", "createdAt");
CREATE INDEX "ResearchSource_origin_createdAt_idx" ON "ResearchSource"("origin", "createdAt");
CREATE INDEX "ResearchRun_status_createdAt_idx" ON "ResearchRun"("status", "createdAt");
