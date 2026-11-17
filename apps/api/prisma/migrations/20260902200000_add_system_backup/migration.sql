-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('pending', 'running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "BackupTrigger" AS ENUM ('scheduled', 'manual');

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "status" "BackupJobStatus" NOT NULL DEFAULT 'pending',
    "trigger" "BackupTrigger" NOT NULL,
    "prefix" VARCHAR(512) NOT NULL,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "db_size_bytes" BIGINT,
    "files_count" INTEGER NOT NULL DEFAULT 0,
    "files_size_bytes" BIGINT NOT NULL DEFAULT 0,
    "env_included" BOOLEAN NOT NULL DEFAULT false,
    "error_message" VARCHAR(2000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "backup_jobs_status_created_at_idx" ON "backup_jobs"("status", "created_at");

-- CreateIndex
CREATE INDEX "backup_jobs_created_at_idx" ON "backup_jobs"("created_at");
