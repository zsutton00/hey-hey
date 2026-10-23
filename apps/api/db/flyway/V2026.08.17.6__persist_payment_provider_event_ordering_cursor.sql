ALTER TABLE payment_provider_bindings
  ADD COLUMN IF NOT EXISTS last_accepted_provider_event_sequence BIGINT,
  ADD COLUMN IF NOT EXISTS last_accepted_provider_event_version VARCHAR(255),
  ADD COLUMN IF NOT EXISTS last_accepted_provider_occurred_at TIMESTAMPTZ;
