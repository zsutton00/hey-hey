-- Canonical parentage uses two child-owned, literal allow-list axes. Update
-- only the canonical template catalog; complete project overrides remain the
-- project-effective authority and are intentionally untouched.

WITH expected(type_key, allowed_parent_types, allowed_parent_entity_types) AS (
  VALUES
    ('STANDARD', '["FEATURE","STANDARD"]'::jsonb, '["TASK"]'::jsonb),
    ('FEATURE', '["FEATURE"]'::jsonb, '["TASK"]'::jsonb),
    ('BUG', '["FEATURE"]'::jsonb, '["TASK"]'::jsonb),
    ('GOAL', '[]'::jsonb, '[]'::jsonb),
    ('CONTRACT', '["FEATURE"]'::jsonb, '["TASK"]'::jsonb),
    ('TASK_MONITOR', '["FEATURE","STANDARD"]'::jsonb, '["TASK"]'::jsonb),
    ('workflow', '["FEATURE","STANDARD"]'::jsonb, '["TASK"]'::jsonb),
    ('workflow_step', '["workflow"]'::jsonb, '["TASK"]'::jsonb)
)
UPDATE work_item_type_template AS template
SET allowed_parent_types = expected.allowed_parent_types,
    parentage = jsonb_set(
      template.parentage,
      '{allowedParentEntityTypes}',
      expected.allowed_parent_entity_types,
      true
    ),
    updated_at = CURRENT_TIMESTAMP
FROM expected
WHERE template.type_key = expected.type_key;

DO $migration$
DECLARE
  mismatches TEXT;
BEGIN
  WITH expected(
    type_key,
    allowed_parent_types,
    allowed_parent_entity_types,
    requires_parent
  ) AS (
    VALUES
      ('STANDARD', '["FEATURE","STANDARD"]'::jsonb, '["TASK"]'::jsonb, true),
      ('FEATURE', '["FEATURE"]'::jsonb, '["TASK"]'::jsonb, false),
      ('BUG', '["FEATURE"]'::jsonb, '["TASK"]'::jsonb, true),
      ('GOAL', '[]'::jsonb, '[]'::jsonb, false),
      ('CONTRACT', '["FEATURE"]'::jsonb, '["TASK"]'::jsonb, true),
      ('TASK_MONITOR', '["FEATURE","STANDARD"]'::jsonb, '["TASK"]'::jsonb, true),
      ('workflow', '["FEATURE","STANDARD"]'::jsonb, '["TASK"]'::jsonb, false),
      ('workflow_step', '["workflow"]'::jsonb, '["TASK"]'::jsonb, true)
  )
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
  INTO mismatches
  FROM expected
  LEFT JOIN work_item_type_template AS template
    ON template.type_key = expected.type_key
  WHERE template.id IS NULL
     OR template.allowed_parent_types IS DISTINCT FROM expected.allowed_parent_types
     OR template.parentage->'allowedParentEntityTypes'
          IS DISTINCT FROM expected.allowed_parent_entity_types
     OR (template.capabilities->>'requiresParent')::boolean
          IS DISTINCT FROM expected.requires_parent;

  IF mismatches IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical work-item parentage matrix mismatch for: %', mismatches;
  END IF;
END
$migration$;
