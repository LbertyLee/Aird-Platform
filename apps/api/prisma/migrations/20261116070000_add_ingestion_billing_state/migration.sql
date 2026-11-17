-- Persist provider-reported usage before settlement so queue retries can retry billing.
ALTER TABLE "ingestion_jobs" ADD COLUMN "billing_state" JSONB;
