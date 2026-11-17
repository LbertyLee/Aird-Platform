-- Align oper_logs with Prisma schema: add missing dept_name
ALTER TABLE "oper_logs" ADD COLUMN IF NOT EXISTS "dept_name" VARCHAR(50) NOT NULL DEFAULT '';
