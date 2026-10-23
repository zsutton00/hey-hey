CREATE TYPE agent_operation_kind AS ENUM ('START_RUN', 'SUBMIT_MESSAGE');
CREATE TYPE agent_operation_state AS ENUM (
  'CREATED',
  'RESOLVING_AUTHORIZATION',
  'AWAITING_APPROVAL',
  'SUBMITTING',
  'RECONCILING',
  'SUCCEEDED',
  'CANCELLED',
  'DENIED',
  'FAILED'
);

CREATE TABLE agent_operations (
  operation_id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_session_id text NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  kind agent_operation_kind NOT NULL,
  fingerprint char(64) NOT NULL,
  state agent_operation_state NOT NULL DEFAULT 'CREATED',
  authorization_id uuid,
  message_id text REFERENCES messages(id),
  trigger_message_id text REFERENCES messages(id),
  result jsonb,
  failure_code text,
  failure_message text,
  execution_owner uuid,
  execution_lease_expires_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  CONSTRAINT agent_operations_terminal_shape CHECK (
    (state IN ('SUCCEEDED', 'CANCELLED', 'DENIED', 'FAILED')) =
    (terminal_at IS NOT NULL)
  )
);

CREATE INDEX agent_operations_session_created_idx
  ON agent_operations (agent_session_id, created_at DESC);

CREATE FUNCTION reject_agent_operation_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.operation_id <> OLD.operation_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.project_id <> OLD.project_id
     OR NEW.user_id <> OLD.user_id
     OR NEW.agent_session_id <> OLD.agent_session_id
     OR NEW.conversation_id <> OLD.conversation_id
     OR NEW.kind <> OLD.kind
     OR NEW.fingerprint <> OLD.fingerprint THEN
    RAISE EXCEPTION 'agent operation identity and fingerprint are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_operations_immutable_identity
BEFORE UPDATE ON agent_operations
FOR EACH ROW EXECUTE FUNCTION reject_agent_operation_identity_mutation();
