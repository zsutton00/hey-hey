DO $$
DECLARE
  published_canonical_count INTEGER;
  supported_canonical_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO published_canonical_count
  FROM entity_prompt_template_revisions
  WHERE ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  SELECT COUNT(*)
  INTO supported_canonical_count
  FROM entity_prompt_template_revisions
  WHERE ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
    AND template_key IN (
      'entity_context.project',
      'entity_context.plan',
      'entity_context.design_doc',
      'entity_context.agent_session',
      'entity_context.work_item.standard',
      'entity_context.work_item.feature',
      'entity_context.work_item.goal',
      'entity_context.work_item.bug',
      'entity_context.work_item.contract',
      'entity_context.work_item.task_monitor',
      'entity_context.work_item.workflow',
      'entity_context.work_item.workflow_step'
    );

  IF published_canonical_count <> 12 OR supported_canonical_count <> 12 THEN
    RAISE EXCEPTION
      'Expected exactly 12 supported published canonical entity prompt templates before heading repair, found % total and % supported',
      published_canonical_count,
      supported_canonical_count;
  END IF;
END
$$;

WITH current_canonical AS MATERIALIZED (
  SELECT
    template_key,
    selector,
    syntax_version,
    revision_number,
    content,
    CASE template_key
      WHEN 'entity_context.project' THEN 'Project'
      WHEN 'entity_context.plan' THEN 'Plan'
      WHEN 'entity_context.design_doc' THEN 'Design Doc'
      WHEN 'entity_context.agent_session' THEN 'Agent Session'
      WHEN 'entity_context.work_item.standard' THEN 'Task'
      WHEN 'entity_context.work_item.feature' THEN 'Feature'
      WHEN 'entity_context.work_item.goal' THEN 'Goal'
      WHEN 'entity_context.work_item.bug' THEN 'Bug'
      WHEN 'entity_context.work_item.contract' THEN 'Contract'
      WHEN 'entity_context.work_item.task_monitor' THEN 'Task Monitor'
      WHEN 'entity_context.work_item.workflow' THEN 'Workflow'
      WHEN 'entity_context.work_item.workflow_step' THEN 'Workflow Step'
    END AS entity_kind_label
  FROM entity_prompt_template_revisions
  WHERE ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
), retired AS (
  UPDATE entity_prompt_template_revisions
  SET lifecycle_state = 'RETIRED',
      retired_at = CURRENT_TIMESTAMP
  WHERE ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
  RETURNING template_key
)
INSERT INTO entity_prompt_template_revisions (
  template_key,
  selector,
  syntax_version,
  revision_number,
  content,
  ownership_scope,
  lifecycle_state,
  validation_status,
  validation_issues,
  validated_at,
  validator_version,
  published_at
)
SELECT
  current_canonical.template_key,
  current_canonical.selector,
  current_canonical.syntax_version,
  current_canonical.revision_number + 1,
  E'\n\n## ' || current_canonical.entity_kind_label || E'\n\n' || current_canonical.content,
  'CANONICAL',
  'PUBLISHED',
  'VALID',
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  'entity-prompt-template-v1',
  CURRENT_TIMESTAMP
FROM current_canonical
JOIN retired USING (template_key);
