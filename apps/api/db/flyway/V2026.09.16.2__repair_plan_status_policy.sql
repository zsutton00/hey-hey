-- PLAN enters VERIFYING after all stages complete and remains there until the
-- user explicitly completes it. Keep both the canonical template and every
-- project-effective materialization aligned with that lifecycle.
UPDATE work_item_type_template
SET allowed_statuses = CASE
      WHEN allowed_statuses @> '["VERIFYING"]'::jsonb THEN allowed_statuses
      ELSE jsonb_insert(allowed_statuses, '{6}', '"VERIFYING"'::jsonb, false)
    END,
    agent_settable_statuses = CASE
      WHEN agent_settable_statuses @> '["VERIFYING"]'::jsonb THEN agent_settable_statuses
      ELSE jsonb_insert(agent_settable_statuses, '{6}', '"VERIFYING"'::jsonb, false)
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'PLAN'
  AND (
    NOT (allowed_statuses @> '["VERIFYING"]'::jsonb)
    OR NOT (agent_settable_statuses @> '["VERIFYING"]'::jsonb)
  );

UPDATE work_item_type
SET allowed_statuses = CASE
      WHEN allowed_statuses @> '["VERIFYING"]'::jsonb THEN allowed_statuses
      ELSE jsonb_insert(allowed_statuses, '{6}', '"VERIFYING"'::jsonb, false)
    END,
    agent_settable_statuses = CASE
      WHEN agent_settable_statuses @> '["VERIFYING"]'::jsonb THEN agent_settable_statuses
      ELSE jsonb_insert(agent_settable_statuses, '{6}', '"VERIFYING"'::jsonb, false)
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'PLAN'
  AND (
    NOT (allowed_statuses @> '["VERIFYING"]'::jsonb)
    OR NOT (agent_settable_statuses @> '["VERIFYING"]'::jsonb)
  );

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE type_key = 'PLAN'
      AND (
        NOT (allowed_statuses @> '["VERIFYING"]'::jsonb)
        OR NOT (agent_settable_statuses @> '["VERIFYING"]'::jsonb)
      )
  ) OR EXISTS (
    SELECT 1
    FROM work_item_type
    WHERE type_key = 'PLAN'
      AND (
        NOT (allowed_statuses @> '["VERIFYING"]'::jsonb)
        OR NOT (agent_settable_statuses @> '["VERIFYING"]'::jsonb)
      )
  ) THEN
    RAISE EXCEPTION 'PLAN status policy does not include VERIFYING in both status sets';
  END IF;
END
$migration$;
