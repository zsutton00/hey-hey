ALTER TABLE organization_deletion_markers
  ADD COLUMN access_ends_at TIMESTAMPTZ;

UPDATE organization_deletion_markers
SET access_ends_at = deletion_deadline - INTERVAL '30 days';

ALTER TABLE organization_deletion_markers
  ALTER COLUMN access_ends_at SET NOT NULL,
  DROP CONSTRAINT organization_deletion_markers_deadline_check,
  ADD CONSTRAINT organization_deletion_markers_deadline_check CHECK (
    deletion_deadline = access_ends_at + INTERVAL '30 days'
    AND effective_closure_at >= access_ends_at
  );

ALTER TABLE organization_closure_executions
  DROP CONSTRAINT organization_closure_executions_deadline_check,
  ADD CONSTRAINT organization_closure_executions_deadline_check CHECK (
    deletion_deadline >= effective_closure_at
  );

ALTER TABLE organization_closure_projection_commands
  DROP CONSTRAINT organization_closure_projection_commands_deadline_check,
  ADD CONSTRAINT organization_closure_projection_commands_deadline_check CHECK (
    deletion_deadline >= effective_closure_at
  );

CREATE OR REPLACE FUNCTION reject_organization_deletion_marker_identity_change()
RETURNS trigger
LANGUAGE plpgsql
AS $marker_immutable$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.access_ends_at IS DISTINCT FROM OLD.access_ends_at
    OR NEW.effective_closure_at IS DISTINCT FROM OLD.effective_closure_at
    OR NEW.deletion_deadline IS DISTINCT FROM OLD.deletion_deadline
    OR NEW.id IS DISTINCT FROM OLD.id
  THEN
    RAISE EXCEPTION 'organization closure identity and deadline evidence is immutable';
  END IF;
  RETURN NEW;
END;
$marker_immutable$;
