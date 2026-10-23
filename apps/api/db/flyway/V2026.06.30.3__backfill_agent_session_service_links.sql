-- Backfill selected-service links for AgentSessions that already have a
-- launch/working-directory service in agent_sessions.service_id.
INSERT INTO "service_agent_sessions" (
  "id",
  "service_id",
  "agent_session_id",
  "relation_type",
  "created_at"
)
SELECT
  md5(agent_sessions.id::text || ':' || agent_sessions.service_id::text),
  agent_sessions.service_id,
  agent_sessions.id,
  NULL,
  agent_sessions.created_at
FROM "agent_sessions" agent_sessions
WHERE agent_sessions.service_id IS NOT NULL
ON CONFLICT ("service_id", "agent_session_id") DO NOTHING;
