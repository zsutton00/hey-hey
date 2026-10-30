-- Contracts can be archived, not only superseded. Add ARCHIVED to the
-- canonical CONTRACT lifecycle and keep agents able to propose every allowed
-- status. Stored project overrides in work_item_type are left as authored.
UPDATE work_item_type_template
SET allowed_statuses = allowed_statuses || '["ARCHIVED"]'::jsonb,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'CONTRACT'
  AND NOT (allowed_statuses @> '["ARCHIVED"]'::jsonb);

UPDATE work_item_type_template
SET agent_settable_statuses = allowed_statuses,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'CONTRACT'
  AND agent_settable_statuses IS DISTINCT FROM allowed_statuses;

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'CONTRACT'
      AND (
        NOT (allowed_statuses @> '["ARCHIVED"]'::jsonb)
        OR agent_settable_statuses IS DISTINCT FROM allowed_statuses
      )
  ) THEN
    RAISE EXCEPTION 'Canonical CONTRACT does not allow agents to propose ARCHIVED';
  END IF;
END
$migration$;
