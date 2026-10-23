-- Hard cutover from source-owned TRACKS allow-lists to target-owned inbound
-- authorization. PLAN is intentionally excluded until it is a work item.

DO $migration$
DECLARE
  conflicts TEXT;
  unresolved TEXT;
BEGIN
  SELECT string_agg(format('%s/%s', project_id, type_key), ', ' ORDER BY project_id, type_key)
  INTO conflicts
  FROM work_item_type
  WHERE tracking ? 'allowedSourceEntityTypes'
     OR tracking ? 'allowedSourceTaskTypes';

  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Target-owned tracking keys already exist on project definitions: %', conflicts;
  END IF;

  SELECT string_agg(
    format('%s/%s -> %s', source.project_id, source.type_key, target_key),
    ', ' ORDER BY source.project_id, source.type_key, target_key
  )
  INTO unresolved
  FROM work_item_type source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(source.tracking->'allowedTargetTaskTypes', '[]'::jsonb)
  ) target_key
  LEFT JOIN work_item_type target
    ON target.project_id = source.project_id
   AND target.type_key = target_key
  WHERE target_key <> 'PLAN'
    AND target.id IS NULL;

  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Unresolved project tracking type keys: %', unresolved;
  END IF;

  SELECT string_agg(
    format('%s@%s -> %s', source.type_key, source.revision, target_key),
    ', ' ORDER BY source.type_key, source.revision, target_key
  )
  INTO unresolved
  FROM work_item_type_template source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(source.tracking->'allowedTargetTaskTypes', '[]'::jsonb)
  ) target_key
  LEFT JOIN work_item_type_template target
    ON target.type_key = target_key
   AND target.revision = source.revision
  WHERE target_key <> 'PLAN'
    AND target.id IS NULL;

  IF unresolved IS NOT NULL THEN
    RAISE EXCEPTION 'Unresolved canonical-template tracking type keys: %', unresolved;
  END IF;
END
$migration$;

WITH inbound AS (
  SELECT
    target.project_id,
    target.type_key,
    jsonb_agg(DISTINCT source.type_key ORDER BY source.type_key) AS source_types
  FROM work_item_type source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(source.tracking->'allowedTargetTaskTypes', '[]'::jsonb)
  ) target_key
  JOIN work_item_type target
    ON target.project_id = source.project_id
   AND target.type_key = target_key
  WHERE target_key <> 'PLAN'
    AND COALESCE(source.tracking->'allowedTargetEntityTypes', '[]'::jsonb) ? 'TASK'
  GROUP BY target.project_id, target.type_key
)
UPDATE work_item_type target
SET tracking = jsonb_build_object(
      'allowedSourceEntityTypes',
      CASE WHEN inbound.source_types IS NULL THEN '[]'::jsonb ELSE '["TASK"]'::jsonb END,
      'allowedSourceTaskTypes', COALESCE(inbound.source_types, '[]'::jsonb)
    ),
    capabilities = capabilities - 'canBeTrackedByGoals',
    updated_at = CURRENT_TIMESTAMP
FROM (SELECT project_id, type_key FROM work_item_type) all_targets
LEFT JOIN inbound
  ON inbound.project_id = all_targets.project_id
 AND inbound.type_key = all_targets.type_key
WHERE target.project_id = all_targets.project_id
  AND target.type_key = all_targets.type_key;

WITH inbound AS (
  SELECT
    target.type_key,
    target.revision,
    jsonb_agg(DISTINCT source.type_key ORDER BY source.type_key) AS source_types
  FROM work_item_type_template source
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(source.tracking->'allowedTargetTaskTypes', '[]'::jsonb)
  ) target_key
  JOIN work_item_type_template target
    ON target.type_key = target_key
   AND target.revision = source.revision
  WHERE target_key <> 'PLAN'
    AND COALESCE(source.tracking->'allowedTargetEntityTypes', '[]'::jsonb) ? 'TASK'
  GROUP BY target.type_key, target.revision
)
UPDATE work_item_type_template target
SET tracking = jsonb_build_object(
      'allowedSourceEntityTypes',
      CASE WHEN inbound.source_types IS NULL THEN '[]'::jsonb ELSE '["TASK"]'::jsonb END,
      'allowedSourceTaskTypes', COALESCE(inbound.source_types, '[]'::jsonb)
    ),
    capabilities = capabilities - 'canBeTrackedByGoals',
    updated_at = CURRENT_TIMESTAMP
FROM (SELECT type_key, revision FROM work_item_type_template) all_targets
LEFT JOIN inbound
  ON inbound.type_key = all_targets.type_key
 AND inbound.revision = all_targets.revision
WHERE target.type_key = all_targets.type_key
  AND target.revision = all_targets.revision;
