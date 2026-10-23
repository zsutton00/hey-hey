DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'agent_operation_authorization_kind'
  ) THEN
    CREATE TYPE agent_operation_authorization_kind AS ENUM (
      'controller_assertion',
      'bounded_grant'
    );
  END IF;
END
$$;

ALTER TABLE agent_operations
  ADD COLUMN IF NOT EXISTS authorization_kind agent_operation_authorization_kind;

ALTER TABLE agent_operation_dispatches
  DROP CONSTRAINT IF EXISTS agent_operation_dispatch_authorization_kind_check,
  ALTER COLUMN authorization_kind TYPE agent_operation_authorization_kind
    USING authorization_kind::agent_operation_authorization_kind;

-- A one-to-one dispatch is the strongest legacy evidence because it records
-- the exact authorization rail selected for executable delivery.
UPDATE agent_operations AS operation
SET authorization_kind = dispatch.authorization_kind
FROM agent_operation_dispatches AS dispatch
WHERE dispatch.operation_id = operation.operation_id
  AND operation.authorization_kind IS NULL;

-- Older workflow-answer admissions temporarily recorded this discriminant in
-- result JSON before a dispatch existed. Only recognize the closed contract
-- values; leave every other pre-admission or unprovable row unset.
UPDATE agent_operations
SET authorization_kind =
  (result ->> 'authorizationKind')::agent_operation_authorization_kind
WHERE authorization_kind IS NULL
  AND result ->> 'authorizationKind' IN (
    'controller_assertion',
    'bounded_grant'
  );
