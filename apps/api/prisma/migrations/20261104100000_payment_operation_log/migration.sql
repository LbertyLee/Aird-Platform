CREATE TABLE "payment_operation_logs" (
    "id" TEXT NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "status" VARCHAR(24) NOT NULL,
    "order_id" TEXT,
    "order_no" VARCHAR(64),
    "channel" VARCHAR(32),
    "trade_no" VARCHAR(128),
    "amount" DECIMAL(12,2),
    "actor_id" TEXT,
    "error_code" VARCHAR(64),
    "message" VARCHAR(256),
    "duration_ms" INTEGER,
    "details" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_operation_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payment_operation_logs_order_no_created_at_idx" ON "payment_operation_logs"("order_no", "created_at");
CREATE INDEX "payment_operation_logs_action_status_created_at_idx" ON "payment_operation_logs"("action", "status", "created_at");
CREATE INDEX "payment_operation_logs_actor_id_created_at_idx" ON "payment_operation_logs"("actor_id", "created_at");
