-- Let a BUG sit directly under a PLAN_STAGE on the canonical definition.
-- Parentage is owned by the child type, so only BUG's allowed parents change.
-- Project overrides (work_item_type rows) keep their own definition.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template WHERE type_key = 'BUG'
  ) THEN
    RAISE EXCEPTION 'Cannot allow BUG under PLAN_STAGE: canonical BUG template is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template
SET allowed_parent_types = CASE
      WHEN allowed_parent_types @> '["PLAN_STAGE"]'::jsonb
        THEN allowed_parent_types
      ELSE allowed_parent_types || '["PLAN_STAGE"]'::jsonb
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'BUG';

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template
    WHERE type_key = 'BUG'
      AND allowed_parent_types @> '["FEATURE", "PLAN_STAGE"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'Canonical BUG template must allow FEATURE and PLAN_STAGE parents';
  END IF;
END
$migration$;
