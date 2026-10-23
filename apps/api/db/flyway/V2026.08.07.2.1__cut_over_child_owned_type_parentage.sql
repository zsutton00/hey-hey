DO $migration$
DECLARE
  parent_only_pairs TEXT;
BEGIN
  WITH parent_claims AS (
    SELECT
      parent.project_id,
      parent.type_key AS parent_type,
      declared.child_type
    FROM work_item_type parent
    CROSS JOIN LATERAL jsonb_array_elements_text(parent.allowed_child_types)
      AS declared(child_type)
  ),
  unresolved AS (
    SELECT claim.project_id, claim.parent_type, claim.child_type
    FROM parent_claims claim
    LEFT JOIN work_item_type child
      ON child.project_id = claim.project_id
     AND child.type_key = claim.child_type
    WHERE child.id IS NULL
       OR NOT child.allowed_parent_types @> jsonb_build_array(claim.parent_type)
  )
  SELECT string_agg(
    format(
      'project_id=%s parent=%s child=%s',
      project_id,
      parent_type,
      child_type
    ),
    ', '
    ORDER BY project_id, parent_type, child_type
  )
  INTO parent_only_pairs
  FROM unresolved;

  IF parent_only_pairs IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot remove allowed_child_types; unresolved project parent-only declarations: %',
      parent_only_pairs
      USING HINT =
        'Add the parent key to each child allowed_parent_types declaration or remove the stale parent-side declaration, then rerun the migration.';
  END IF;
END
$migration$;

DO $migration$
DECLARE
  parent_only_pairs TEXT;
BEGIN
  WITH latest_templates AS (
    SELECT DISTINCT ON (type_key)
      type_key,
      allowed_parent_types,
      allowed_child_types
    FROM work_item_type_template
    ORDER BY type_key, revision DESC
  ),
  parent_claims AS (
    SELECT parent.type_key AS parent_type, declared.child_type
    FROM latest_templates parent
    CROSS JOIN LATERAL jsonb_array_elements_text(parent.allowed_child_types)
      AS declared(child_type)
  ),
  unresolved AS (
    SELECT claim.parent_type, claim.child_type
    FROM parent_claims claim
    LEFT JOIN latest_templates child
      ON child.type_key = claim.child_type
    WHERE child.type_key IS NULL
       OR NOT child.allowed_parent_types @> jsonb_build_array(claim.parent_type)
  )
  SELECT string_agg(
    format('parent=%s child=%s', parent_type, child_type),
    ', '
    ORDER BY parent_type, child_type
  )
  INTO parent_only_pairs
  FROM unresolved;

  IF parent_only_pairs IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot remove allowed_child_types; unresolved latest-template parent-only declarations: %',
      parent_only_pairs
      USING HINT =
        'Publish child-owned allowed_parent_types declarations before rerunning the migration.';
  END IF;
END
$migration$;

ALTER TABLE work_item_type_template
  ADD COLUMN icon_key TEXT;

ALTER TABLE work_item_type
  ADD COLUMN icon_key TEXT;

UPDATE work_item_type_template
SET icon_key = CASE type_key
  WHEN 'STANDARD' THEN 'task'
  WHEN 'BUG' THEN 'bug'
  WHEN 'FEATURE' THEN 'feature'
  WHEN 'GOAL' THEN 'goal'
  WHEN 'CONTRACT' THEN 'contract'
  WHEN 'workflow' THEN 'workflow'
END
WHERE icon_key IS NULL
  AND type_key IN ('STANDARD', 'BUG', 'FEATURE', 'GOAL', 'CONTRACT', 'workflow');

UPDATE work_item_type
SET icon_key = CASE type_key
  WHEN 'STANDARD' THEN 'task'
  WHEN 'BUG' THEN 'bug'
  WHEN 'FEATURE' THEN 'feature'
  WHEN 'GOAL' THEN 'goal'
  WHEN 'CONTRACT' THEN 'contract'
  WHEN 'workflow' THEN 'workflow'
END
WHERE icon_key IS NULL
  AND type_key IN ('STANDARD', 'BUG', 'FEATURE', 'GOAL', 'CONTRACT', 'workflow');

ALTER TABLE work_item_type_template
  ADD CONSTRAINT work_item_type_template_icon_key_check
  CHECK (
    icon_key IS NULL OR
    icon_key IN ('task', 'bug', 'feature', 'goal', 'contract', 'workflow')
  ),
  DROP COLUMN allowed_child_types;

ALTER TABLE work_item_type
  ADD CONSTRAINT work_item_type_icon_key_check
  CHECK (
    icon_key IS NULL OR
    icon_key IN ('task', 'bug', 'feature', 'goal', 'contract', 'workflow')
  ),
  DROP COLUMN allowed_child_types;
