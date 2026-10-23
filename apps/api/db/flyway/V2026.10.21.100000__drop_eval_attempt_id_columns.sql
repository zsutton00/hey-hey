-- Eval output is attributed through the EVAL_ATTEMPT report's target session,
-- not a per-row attempt id.
DROP INDEX IF EXISTS "messages_eval_attempt_idx";
DROP INDEX IF EXISTS "reports_eval_attempt_idx";
DROP INDEX IF EXISTS "proposals_eval_attempt_idx";

ALTER TABLE "messages" DROP COLUMN "eval_attempt_id";
ALTER TABLE "reports" DROP COLUMN "eval_attempt_id";
ALTER TABLE "proposals" DROP COLUMN "eval_attempt_id";
