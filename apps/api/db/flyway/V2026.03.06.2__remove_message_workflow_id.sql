DROP INDEX IF EXISTS "messages_workflow_id_created_at_idx";

ALTER TABLE "messages"
DROP COLUMN IF EXISTS "workflow_id";
