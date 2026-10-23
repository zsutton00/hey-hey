-- PLAN, PLAN_STAGE, and PLAN_STEP are work-item type keys after the Plan
-- cutover. They are no longer EntityType values. Normalize the two persisted
-- EntityType-valued JSON arrays without changing subtype-valued arrays such as
-- allowed_parent_types or tracking.allowedSourceTaskTypes.

CREATE FUNCTION pg_temp.normalize_plan_entity_type_array(values_json jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
AS $migration$
  SELECT COALESCE(jsonb_agg(normalized.value ORDER BY normalized.first_ordinal), '[]'::jsonb)
  FROM (
    SELECT mapped.value, min(source.ordinality) AS first_ordinal
    FROM jsonb_array_elements_text(values_json) WITH ORDINALITY AS source(value, ordinality)
    CROSS JOIN LATERAL (
      SELECT CASE source.value
        WHEN 'PLAN' THEN 'TASK'
        WHEN 'PLAN_STAGE' THEN 'TASK'
        WHEN 'PLAN_STEP' THEN 'TASK'
        ELSE source.value
      END AS value
    ) AS mapped
    GROUP BY mapped.value
  ) AS normalized;
$migration$;

UPDATE work_item_type_template
SET parentage = jsonb_set(
      parentage,
      '{allowedParentEntityTypes}',
      pg_temp.normalize_plan_entity_type_array(
        parentage->'allowedParentEntityTypes'
      ),
      false
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE parentage @? '$.allowedParentEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")';

UPDATE work_item_type
SET parentage = jsonb_set(
      parentage,
      '{allowedParentEntityTypes}',
      pg_temp.normalize_plan_entity_type_array(
        parentage->'allowedParentEntityTypes'
      ),
      false
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE parentage @? '$.allowedParentEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")';

UPDATE work_item_type_template
SET tracking = jsonb_set(
      tracking,
      '{allowedSourceEntityTypes}',
      pg_temp.normalize_plan_entity_type_array(
        tracking->'allowedSourceEntityTypes'
      ),
      false
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tracking @? '$.allowedSourceEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")';

UPDATE work_item_type
SET tracking = jsonb_set(
      tracking,
      '{allowedSourceEntityTypes}',
      pg_temp.normalize_plan_entity_type_array(
        tracking->'allowedSourceEntityTypes'
      ),
      false
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE tracking @? '$.allowedSourceEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM work_item_type_template
    WHERE parentage @? '$.allowedParentEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")'
       OR tracking @? '$.allowedSourceEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")'
    UNION ALL
    SELECT 1
    FROM work_item_type
    WHERE parentage @? '$.allowedParentEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")'
       OR tracking @? '$.allowedSourceEntityTypes[*] ? (@ == "PLAN" || @ == "PLAN_STAGE" || @ == "PLAN_STEP")'
  ) THEN
    RAISE EXCEPTION 'Retired Plan entity types remain in persisted work-item type EntityType arrays';
  END IF;
END
$migration$;
