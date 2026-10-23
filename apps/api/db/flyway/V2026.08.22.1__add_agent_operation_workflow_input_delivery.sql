ALTER TYPE agent_operation_kind RENAME VALUE 'SUBMIT_MESSAGE' TO 'DIRECT_TRIGGER';
ALTER TYPE agent_operation_kind ADD VALUE 'WORKFLOW_ANSWER';

ALTER TYPE agent_operation_state ADD VALUE 'ROUTING_PENDING' BEFORE 'DISPATCH_PENDING';
ALTER TYPE agent_operation_state ADD VALUE 'AWAITING_WORKFLOW_RESOLUTION' BEFORE 'DISPATCH_PENDING';

CREATE TYPE agent_operation_workflow_input_state AS ENUM (
  'PENDING',
  'CLAIMED',
  'DELIVERED'
);

CREATE TABLE agent_operation_workflow_input_deliveries (
  operation_id uuid PRIMARY KEY
    REFERENCES agent_operations(operation_id) ON DELETE CASCADE,
  workflow_id text NOT NULL,
  workflow_name text NOT NULL,
  node_id text NOT NULL,
  action text NOT NULL,
  answer jsonb NOT NULL,
  state agent_operation_workflow_input_state NOT NULL DEFAULT 'PENDING',
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  claim_owner uuid,
  claim_expires_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  last_failure_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_operation_workflow_input_claim_shape CHECK (
    (state = 'CLAIMED' AND claim_owner IS NOT NULL AND claim_expires_at IS NOT NULL)
    OR
    (state <> 'CLAIMED' AND claim_owner IS NULL AND claim_expires_at IS NULL)
  )
);

CREATE INDEX agent_operation_workflow_input_pending_idx
  ON agent_operation_workflow_input_deliveries (next_attempt_at, created_at)
  WHERE state = 'PENDING';

CREATE INDEX agent_operation_workflow_input_lease_idx
  ON agent_operation_workflow_input_deliveries (claim_expires_at)
  WHERE state = 'CLAIMED';
