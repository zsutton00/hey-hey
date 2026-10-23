WITH active_types_without_canonical_prompt AS (
  SELECT
    wit.project_id,
    wit.type_key,
    'entity_context.work_item.' || lower(wit.type_key) AS template_key
  FROM work_item_type wit
  LEFT JOIN entity_prompt_template_revisions canonical_prompt
    ON canonical_prompt.template_key =
      'entity_context.work_item.' || lower(wit.type_key)
   AND canonical_prompt.ownership_scope = 'CANONICAL'
   AND canonical_prompt.project_id IS NULL
   AND canonical_prompt.lifecycle_state = 'PUBLISHED'
   AND canonical_prompt.validation_status = 'VALID'
  WHERE wit.lifecycle_status = 'active'
    AND canonical_prompt.id IS NULL
),
missing_templates AS (
  SELECT candidate.*
  FROM active_types_without_canonical_prompt candidate
  WHERE NOT EXISTS (
    SELECT 1
    FROM entity_prompt_template_revisions existing
    WHERE existing.project_id = candidate.project_id
      AND existing.template_key = candidate.template_key
      AND existing.ownership_scope = 'PROJECT'
      AND existing.lifecycle_state = 'PUBLISHED'
      AND existing.validation_status = 'VALID'
      AND existing.selector = jsonb_build_object(
        'entityType', 'WORK_ITEM',
        'workItemTypeKey', candidate.type_key
      )
  )
),
standard_sources AS (
  SELECT DISTINCT ON (missing.project_id, missing.template_key)
    missing.project_id,
    missing.type_key,
    missing.template_key,
    source.syntax_version,
    source.content,
    source.validated_at,
    source.validator_version
  FROM missing_templates missing
  JOIN entity_prompt_template_revisions source
    ON source.template_key = 'entity_context.work_item.standard'
   AND source.lifecycle_state = 'PUBLISHED'
   AND source.validation_status = 'VALID'
   AND (
     (source.ownership_scope = 'PROJECT' AND source.project_id = missing.project_id)
     OR (source.ownership_scope = 'CANONICAL' AND source.project_id IS NULL)
   )
  ORDER BY
    missing.project_id,
    missing.template_key,
    CASE source.ownership_scope WHEN 'PROJECT' THEN 0 ELSE 1 END,
    source.revision_number DESC
),
retired_conflicting_publications AS (
  UPDATE entity_prompt_template_revisions existing
  SET lifecycle_state = 'RETIRED',
      published_at = NULL,
      retired_at = CURRENT_TIMESTAMP
  FROM standard_sources source
  WHERE existing.project_id = source.project_id
    AND existing.template_key = source.template_key
    AND existing.ownership_scope = 'PROJECT'
    AND existing.lifecycle_state = 'PUBLISHED'
  RETURNING existing.id
)
INSERT INTO entity_prompt_template_revisions (
  template_key,
  selector,
  syntax_version,
  revision_number,
  content,
  ownership_scope,
  project_id,
  lifecycle_state,
  validation_status,
  validation_issues,
  validated_at,
  validator_version,
  published_at
)
SELECT
  source.template_key,
  jsonb_build_object(
    'entityType', 'WORK_ITEM',
    'workItemTypeKey', source.type_key
  ),
  source.syntax_version,
  COALESCE((
    SELECT max(history.revision_number)
    FROM entity_prompt_template_revisions history
    WHERE history.project_id = source.project_id
      AND history.template_key = source.template_key
      AND history.ownership_scope = 'PROJECT'
  ), 0) + 1,
  source.content,
  'PROJECT',
  source.project_id,
  'PUBLISHED',
  'VALID',
  '[]'::jsonb,
  source.validated_at,
  source.validator_version,
  CURRENT_TIMESTAMP
FROM standard_sources source
LEFT JOIN (SELECT count(*) AS retired_count FROM retired_conflicting_publications) retired
  ON TRUE;
