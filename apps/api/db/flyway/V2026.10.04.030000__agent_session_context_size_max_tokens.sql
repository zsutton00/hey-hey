-- Model context window reported with the latest turn-end context-size reading.
-- Null when the provider does not report a window; written with the other
-- context_size_* columns under the same newer-observedAt-wins guard.
ALTER TABLE agent_sessions
  ADD COLUMN context_size_max_tokens BIGINT;
