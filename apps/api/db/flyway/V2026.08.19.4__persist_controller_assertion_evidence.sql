ALTER TABLE execution_authorizations
  ADD COLUMN IF NOT EXISTS assertion_evidence JSONB;

ALTER TABLE monitor_commands
  ADD COLUMN IF NOT EXISTS "authorization" JSONB;
