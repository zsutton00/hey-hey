-- Browser-requested child work retains the controller evidence admitted for it.
-- Existing attempts stay NULL and are never backfilled: no authority is invented
-- for rows admitted before evidence was retained.
ALTER TABLE agent_interaction_attempts
  ADD COLUMN authorization_kind text,
  ADD COLUMN authorization_id text,
  ADD COLUMN envelope_authorization jsonb,
  ADD COLUMN action_payload_hash text;

ALTER TABLE agent_interaction_attempts
  ADD CONSTRAINT agent_interaction_attempts_authorization_kind_check
    CHECK (authorization_kind IS NULL OR authorization_kind IN ('controller_assertion', 'bounded_grant')),
  ADD CONSTRAINT agent_interaction_attempts_action_payload_hash_check
    CHECK (action_payload_hash IS NULL OR action_payload_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT agent_interaction_attempts_retained_evidence_check
    CHECK (
      (authorization_kind IS NULL AND authorization_id IS NULL AND envelope_authorization IS NULL AND action_payload_hash IS NULL)
      OR (authorization_kind IS NOT NULL AND authorization_id IS NOT NULL AND envelope_authorization IS NOT NULL AND action_payload_hash IS NOT NULL)
    );
