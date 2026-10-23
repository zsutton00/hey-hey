CREATE TYPE organization_closure_execution_stage AS ENUM (
  'PENDING',
  'AUTHORITY_REVOKED',
  'CONTENT_DELETED',
  'PROJECTIONS_INVALIDATED',
  'VERIFIED',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE organization_deletion_markers (
  organization_id TEXT PRIMARY KEY,
  id TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid()::text,
  effective_closure_at TIMESTAMPTZ NOT NULL,
  deletion_deadline TIMESTAMPTZ NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_deletion_markers_deadline_check CHECK (
    deletion_deadline = effective_closure_at + INTERVAL '30 days'
  ),
  CONSTRAINT organization_deletion_markers_execution_identity_key UNIQUE (
    id,
    organization_id,
    effective_closure_at,
    deletion_deadline
  )
);

CREATE TABLE organization_closure_executions (
  organization_id TEXT PRIMARY KEY,
  marker_id TEXT NOT NULL UNIQUE,
  effective_closure_at TIMESTAMPTZ NOT NULL,
  deletion_deadline TIMESTAMPTZ NOT NULL,
  stage organization_closure_execution_stage NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  attempt_id TEXT,
  next_retry_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  claim_token TEXT,
  claimed_at TIMESTAMPTZ,
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  last_attempted_at TIMESTAMPTZ,
  last_failure VARCHAR(2000),
  failed_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_closure_executions_deadline_check CHECK (
    deletion_deadline = effective_closure_at + INTERVAL '30 days'
  ),
  CONSTRAINT organization_closure_executions_marker_fkey FOREIGN KEY (
    marker_id,
    organization_id,
    effective_closure_at,
    deletion_deadline
  ) REFERENCES organization_deletion_markers (
    id,
    organization_id,
    effective_closure_at,
    deletion_deadline
  ) ON DELETE RESTRICT,
  CONSTRAINT organization_closure_executions_marker_identity_key UNIQUE (
    marker_id,
    organization_id,
    effective_closure_at,
    deletion_deadline
  ),
  CONSTRAINT organization_closure_executions_attempt_check CHECK (
    (attempt_count = 0 AND attempt_id IS NULL)
    OR (attempt_count > 0 AND attempt_id IS NOT NULL)
  ),
  CONSTRAINT organization_closure_executions_claim_check CHECK (
    (claim_token IS NULL AND claimed_at IS NULL AND lease_expires_at IS NULL)
    OR (
      claim_token IS NOT NULL
      AND claimed_at IS NOT NULL
      AND lease_expires_at IS NOT NULL
      AND lease_expires_at > claimed_at
    )
  ),
  CONSTRAINT organization_closure_executions_terminal_check CHECK (
    (stage = 'COMPLETED' AND completed_at IS NOT NULL AND failed_at IS NULL)
    OR (stage = 'FAILED' AND failed_at IS NOT NULL AND completed_at IS NULL AND last_failure IS NOT NULL)
    OR (stage NOT IN ('COMPLETED', 'FAILED') AND completed_at IS NULL AND failed_at IS NULL)
  )
);

CREATE INDEX organization_closure_executions_due_idx
  ON organization_closure_executions (stage, next_retry_at);

CREATE INDEX organization_closure_executions_lease_idx
  ON organization_closure_executions (stage, lease_expires_at);

CREATE FUNCTION reject_organization_deletion_marker_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $marker_immutable$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.effective_closure_at IS DISTINCT FROM OLD.effective_closure_at
    OR NEW.deletion_deadline IS DISTINCT FROM OLD.deletion_deadline
    OR NEW.id IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION 'organization closure identity and deadline evidence is immutable';
  END IF;
  RETURN NEW;
END;
$marker_immutable$;

CREATE FUNCTION reject_organization_closure_execution_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $execution_immutable$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.effective_closure_at IS DISTINCT FROM OLD.effective_closure_at
    OR NEW.deletion_deadline IS DISTINCT FROM OLD.deletion_deadline
    OR NEW.marker_id IS DISTINCT FROM OLD.marker_id
  THEN
    RAISE EXCEPTION 'organization closure identity and deadline evidence is immutable';
  END IF;
  RETURN NEW;
END;
$execution_immutable$;

CREATE TRIGGER organization_deletion_markers_immutable
BEFORE UPDATE ON organization_deletion_markers
FOR EACH ROW EXECUTE FUNCTION reject_organization_deletion_marker_identity_change();

CREATE TRIGGER organization_closure_executions_immutable
BEFORE UPDATE ON organization_closure_executions
FOR EACH ROW EXECUTE FUNCTION reject_organization_closure_execution_identity_change();
