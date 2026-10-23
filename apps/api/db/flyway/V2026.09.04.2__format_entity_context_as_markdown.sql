DO $$
DECLARE
  published_canonical_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO published_canonical_count
  FROM entity_prompt_template_revisions
  WHERE ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  IF published_canonical_count <> 12 THEN
    RAISE EXCEPTION
      'Expected 12 published canonical entity prompt templates before Markdown formatting, found %',
      published_canonical_count;
  END IF;
END
$$;

WITH current_canonical AS MATERIALIZED (
  SELECT
    template_key,
    selector,
    syntax_version,
    revision_number,
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
  template_key, selector, syntax_version, revision_number, content,
  ownership_scope, lifecycle_state, validation_status, validation_issues,
  validated_at, validator_version, published_at
)
SELECT
  current_canonical.template_key,
  current_canonical.selector,
  current_canonical.syntax_version,
  current_canonical.revision_number + 1,
  E'\n\n## ' || current_canonical.entity_kind_label ||
  E'\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\n' ||
  CASE current_canonical.template_key
    WHEN 'entity_context.project' THEN E'Project body: {{entity.name}};\n\nstatus: {{entity.status}}.'
    WHEN 'entity_context.plan' THEN E'Plan body: {{entity.title}};\n\noutcome: {{entity.outcome}};\n\nstatus: {{entity.status}}.'
    WHEN 'entity_context.design_doc' THEN E'Design Doc body: {{entity.name}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.agent_session' THEN E'Agent Session body: {{entity.title}};\n\nstatus: {{entity.status}}.'
    WHEN 'entity_context.work_item.standard' THEN E'Task body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.feature' THEN E'Feature body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.goal' THEN E'Goal body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.bug' THEN E'Bug body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.contract' THEN E'Contract body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.task_monitor' THEN E'Task Monitor body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.workflow' THEN E'Workflow body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
    WHEN 'entity_context.work_item.workflow_step' THEN E'Workflow Step body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.'
  END ||
  E'\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.',
  'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb,
  CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP
FROM current_canonical
JOIN retired USING (template_key);
