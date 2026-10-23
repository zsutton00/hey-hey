ALTER TABLE agent_operation_dispatches
  ADD COLUMN IF NOT EXISTS authorization_kind text;

-- Legacy rows do not retain enough information to distinguish compact grant
-- reuse from fresh evidence. Preserve the existing fail-closed delivery path.
UPDATE agent_operation_dispatches
SET authorization_kind = 'controller_assertion'
WHERE authorization_kind IS NULL;

ALTER TABLE agent_operation_dispatches
  ALTER COLUMN authorization_kind SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'agent_operation_dispatch_authorization_kind_check'
      AND conrelid = 'agent_operation_dispatches'::regclass
  ) THEN
    ALTER TABLE agent_operation_dispatches
      ADD CONSTRAINT agent_operation_dispatch_authorization_kind_check
      CHECK (authorization_kind IN ('controller_assertion', 'bounded_grant'));
  END IF;
END
$$;
