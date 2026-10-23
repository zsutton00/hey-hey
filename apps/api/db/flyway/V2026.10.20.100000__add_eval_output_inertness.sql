-- Output produced during an eval attempt is kept and readable but never
-- ingested or reused, and eval proposals can never be applied. The attempt
-- id is the EVAL_ATTEMPT report id.
ALTER TABLE "messages"
  ADD COLUMN "eval_attempt_id" TEXT NULL REFERENCES "reports"("id") ON DELETE SET NULL;

ALTER TABLE "reports"
  ADD COLUMN "eval_attempt_id" TEXT NULL REFERENCES "reports"("id") ON DELETE SET NULL,
  ADD COLUMN "rag_enabled" BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE "proposals"
  ADD COLUMN "eval_attempt_id" TEXT NULL REFERENCES "reports"("id") ON DELETE SET NULL,
  ADD COLUMN "rag_enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "application_eligible" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "retained_original_target_content" JSONB NULL;

CREATE INDEX "messages_eval_attempt_idx" ON "messages"("eval_attempt_id");
CREATE INDEX "reports_eval_attempt_idx" ON "reports"("eval_attempt_id");
CREATE INDEX "reports_project_rag_enabled_idx" ON "reports"("project_id", "rag_enabled");
CREATE INDEX "proposals_eval_attempt_idx" ON "proposals"("eval_attempt_id");
