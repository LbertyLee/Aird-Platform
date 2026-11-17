-- CreateTable
CREATE TABLE "oper_logs" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(50) NOT NULL DEFAULT '',
    "business_type" INTEGER NOT NULL DEFAULT 0,
    "method" VARCHAR(100) NOT NULL DEFAULT '',
    "request_method" VARCHAR(10) NOT NULL DEFAULT '',
    "oper_name" VARCHAR(50) NOT NULL DEFAULT '',
    "dept_name" VARCHAR(50) NOT NULL DEFAULT '',
    "oper_url" VARCHAR(255) NOT NULL DEFAULT '',
    "oper_ip" VARCHAR(128) NOT NULL DEFAULT '',
    "oper_location" VARCHAR(255) NOT NULL DEFAULT '',
    "oper_param" VARCHAR(4000) NOT NULL DEFAULT '',
    "json_result" VARCHAR(4000) NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "error_msg" VARCHAR(4000) NOT NULL DEFAULT '',
    "oper_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cost_time" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "oper_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "oper_logs_oper_time_idx" ON "oper_logs"("oper_time");

-- CreateIndex
CREATE INDEX "oper_logs_oper_name_idx" ON "oper_logs"("oper_name");

-- CreateIndex
CREATE INDEX "oper_logs_business_type_oper_time_idx" ON "oper_logs"("business_type", "oper_time");

-- CreateIndex
CREATE INDEX "oper_logs_status_oper_time_idx" ON "oper_logs"("status", "oper_time");
