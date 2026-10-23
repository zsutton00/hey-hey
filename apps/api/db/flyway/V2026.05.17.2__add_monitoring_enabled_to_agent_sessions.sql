ALTER TABLE agent_sessions
  ADD COLUMN monitoring_enabled BOOLEAN NOT NULL DEFAULT false;
