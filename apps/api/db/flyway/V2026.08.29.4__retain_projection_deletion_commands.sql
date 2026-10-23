CREATE TYPE organization_closure_projection_consumer AS ENUM (
  'GRAPH',
  'EMBEDDINGS'
);

CREATE TYPE organization_closure_projection_outcome AS ENUM (
  'VERIFIED'
);

CREATE TABLE organization_closure_projection_commands (
  organization_id TEXT NOT NULL,
  marker_id TEXT NOT NULL,
  effective_closure_at TIMESTAMPTZ NOT NULL,
  deletion_deadline TIMESTAMPTZ NOT NULL,
  consumer organization_closure_projection_consumer NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  claim_token TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ,
  last_failure_code VARCHAR(128),
  last_failure_message VARCHAR(2000),
  last_failure_at TIMESTAMPTZ,
  acknowledged_at TIMESTAMPTZ,
  verified_outcome organization_closure_projection_outcome,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, marker_id, consumer),
  CONSTRAINT organization_closure_projection_commands_deadline_check CHECK (
    deletion_deadline = effective_closure_at + INTERVAL '30 days'
  ),
  CONSTRAINT organization_closure_projection_commands_attempt_check CHECK (
    attempt_count >= 0
  ),
  CONSTRAINT organization_closure_projection_commands_claim_check CHECK (
    (claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL)
    OR (
      claim_token IS NOT NULL
      AND claimed_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > claimed_at
    )
  ),
  CONSTRAINT organization_closure_projection_commands_outcome_check CHECK (
    (acknowledged_at IS NULL AND verified_outcome IS NULL)
    OR (
      acknowledged_at IS NOT NULL
      AND verified_outcome = 'VERIFIED'::organization_closure_projection_outcome
    )
  ),
  CONSTRAINT organization_closure_projection_commands_marker_fkey FOREIGN KEY (
    marker_id,
    organization_id,
    effective_closure_at,
    deletion_deadline
  ) REFERENCES organization_deletion_markers (
    id,
    organization_id,
    effective_closure_at,
    deletion_deadline
  ) ON DELETE RESTRICT
);

CREATE INDEX organization_closure_projection_commands_due_idx
  ON organization_closure_projection_commands (organization_id, marker_id, next_retry_at);

CREATE INDEX organization_closure_projection_commands_consumer_due_idx
  ON organization_closure_projection_commands (consumer, next_retry_at);

CREATE FUNCTION reject_organization_closure_projection_command_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $projection_command_immutable$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.marker_id IS DISTINCT FROM OLD.marker_id
    OR NEW.effective_closure_at IS DISTINCT FROM OLD.effective_closure_at
    OR NEW.deletion_deadline IS DISTINCT FROM OLD.deletion_deadline
    OR NEW.consumer IS DISTINCT FROM OLD.consumer
  THEN
    RAISE EXCEPTION 'organization projection deletion command identity is immutable';
  END IF;
  RETURN NEW;
END;
$projection_command_immutable$;

CREATE TRIGGER organization_closure_projection_commands_immutable
BEFORE UPDATE ON organization_closure_projection_commands
FOR EACH ROW EXECUTE FUNCTION reject_organization_closure_projection_command_identity_change();
