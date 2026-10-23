-- Add typed, versioned launch-context blob to agent_sessions. Existing rows backfill to
-- NULL; the read path treats NULL as { version: "v1", method: null } (see AgentSessionService).
ALTER TABLE agent_sessions
  ADD COLUMN config JSONB NULL;
