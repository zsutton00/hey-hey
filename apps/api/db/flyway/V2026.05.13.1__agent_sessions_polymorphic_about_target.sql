-- Replace the four typed about-target FK columns on agent_sessions
-- (task_id, initiative_id, design_doc_id, plan_id) with a single
-- polymorphic pair (entity_type, entity_id).
--
-- NOTE: The originating task description called out five typed columns
-- to drop, but only four about-target FKs actually exist on this table
-- today. plan_stage_id was never added. service_id stays — it is a
-- code-context link, not an about-target. This migration drops the four
-- typed columns that exist.

ALTER TABLE agent_sessions
  ADD COLUMN entity_type TEXT,
  ADD COLUMN entity_id   TEXT;

UPDATE agent_sessions
SET entity_type = 'TASK',
    entity_id   = task_id::text
WHERE task_id IS NOT NULL;

UPDATE agent_sessions
SET entity_type = 'INITIATIVE',
    entity_id   = initiative_id::text
WHERE initiative_id IS NOT NULL
  AND entity_type IS NULL;

UPDATE agent_sessions
SET entity_type = 'DESIGN_DOC',
    entity_id   = design_doc_id::text
WHERE design_doc_id IS NOT NULL
  AND entity_type IS NULL;

UPDATE agent_sessions
SET entity_type = 'PLAN',
    entity_id   = plan_id::text
WHERE plan_id IS NOT NULL
  AND entity_type IS NULL;

CREATE INDEX agent_sessions_org_entity_updated_idx
  ON agent_sessions (organization_id, entity_type, entity_id, updated_at);

DROP INDEX IF EXISTS "AgentSession_taskId_idx";
DROP INDEX IF EXISTS "AgentSession_initiativeId_idx";
DROP INDEX IF EXISTS "AgentSession_designDocId_idx";
DROP INDEX IF EXISTS "AgentSession_planId_idx";
DROP INDEX IF EXISTS "AgentSession_organizationId_taskId_updatedAt_idx";

ALTER TABLE agent_sessions
  DROP CONSTRAINT IF EXISTS "agent_sessions_task_id_fkey",
  DROP CONSTRAINT IF EXISTS "agent_sessions_initiative_id_fkey",
  DROP CONSTRAINT IF EXISTS "agent_sessions_design_doc_id_fkey",
  DROP CONSTRAINT IF EXISTS "agent_sessions_plan_id_fkey";

ALTER TABLE agent_sessions
  DROP COLUMN task_id,
  DROP COLUMN initiative_id,
  DROP COLUMN design_doc_id,
  DROP COLUMN plan_id;
