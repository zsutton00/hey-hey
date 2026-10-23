-- Latest context-window size the CLI reported for an Agent Session at turn end.
-- Persisted so cold loads and second devices are seeded; a newer
-- context_size_observed_at always wins. Null until the first reading arrives.
ALTER TABLE agent_sessions
  ADD COLUMN context_size_tokens BIGINT,
  ADD COLUMN context_size_run_id TEXT,
  ADD COLUMN context_size_provider_session_id TEXT,
  ADD COLUMN context_size_observed_at TIMESTAMPTZ;
