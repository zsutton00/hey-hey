ALTER TYPE agent_operation_state ADD VALUE 'DISPATCH_PENDING';

ALTER TABLE agent_operations
  ADD COLUMN grant_id text
    REFERENCES execution_grants(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX agent_operations_grant_id_key
  ON agent_operations (grant_id)
  WHERE grant_id IS NOT NULL;

CREATE TYPE agent_operation_dispatch_state AS ENUM (
  'PENDING',
  'CLAIMED',
  'ACKNOWLEDGED',
  'REJECTED'
);

CREATE TABLE agent_operation_dispatches (
  operation_id uuid PRIMARY KEY
    REFERENCES agent_operations(operation_id) ON DELETE CASCADE,
  authorization_id text NOT NULL
    REFERENCES execution_authorizations(authorization_id) ON DELETE RESTRICT,
  grant_id text NOT NULL UNIQUE
    REFERENCES execution_grants(id) ON DELETE RESTRICT,
  machine_id text NOT NULL
    REFERENCES machines(id) ON DELETE RESTRICT,
  trigger_message_id text NOT NULL UNIQUE
    REFERENCES messages(id) ON DELETE RESTRICT,
  state agent_operation_dispatch_state NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0,
  claim_owner uuid,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  acknowledgement jsonb,
  last_failure_code text,
  acknowledged_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_operation_dispatch_claim_shape CHECK (
    (state = 'CLAIMED') =
      (claim_owner IS NOT NULL AND claim_expires_at IS NOT NULL)
  ),
  CONSTRAINT agent_operation_dispatch_terminal_shape CHECK (
    (state IN ('ACKNOWLEDGED', 'REJECTED')) =
      (terminal_at IS NOT NULL)
  )
);

CREATE INDEX agent_operation_dispatch_pending_idx
  ON agent_operation_dispatches (next_attempt_at, created_at)
  WHERE state = 'PENDING';

CREATE INDEX agent_operation_dispatch_lease_idx
  ON agent_operation_dispatches (claim_expires_at)
  WHERE state = 'CLAIMED';
