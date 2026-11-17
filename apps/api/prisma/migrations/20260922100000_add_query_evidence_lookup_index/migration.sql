-- Speeds up evidence hydration for a search run, including ordered results.
CREATE INDEX "query_evidence_ai_query_id_evidence_type_created_at_idx"
ON "query_evidence" ("ai_query_id", "evidence_type", "created_at");
