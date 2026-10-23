-- Publish the canonical WORK_ITEM / EVAL and EVAL_CASE entity prompt templates.
-- Canonical rows are global, so every project resolves them. Project-owned
-- revisions are never touched, and each insert is skipped when a published
-- canonical revision for that key already exists.
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
  'entity_context.work_item.eval',
  '{"entityType":"WORK_ITEM","workItemTypeKey":"EVAL"}'::jsonb,
  'V1',
  COALESCE(
    (
      SELECT MAX(revision_number)
      FROM entity_prompt_template_revisions
      WHERE template_key = 'entity_context.work_item.eval'
        AND ownership_scope = 'CANONICAL'
    ),
    0
  ) + 1,
  E'\n\n## Eval\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\nEval body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.',
  'CANONICAL',
  'PUBLISHED',
  'VALID',
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  'entity-prompt-template-v1',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM entity_prompt_template_revisions
  WHERE template_key = 'entity_context.work_item.eval'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
);

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
  'entity_context.work_item.eval_case',
  '{"entityType":"WORK_ITEM","workItemTypeKey":"EVAL_CASE"}'::jsonb,
  'V1',
  COALESCE(
    (
      SELECT MAX(revision_number)
      FROM entity_prompt_template_revisions
      WHERE template_key = 'entity_context.work_item.eval_case'
        AND ownership_scope = 'CANONICAL'
    ),
    0
  ) + 1,
  E'\n\n## Eval Case\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\nEval Case body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.',
  'CANONICAL',
  'PUBLISHED',
  'VALID',
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  'entity-prompt-template-v1',
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM entity_prompt_template_revisions
  WHERE template_key = 'entity_context.work_item.eval_case'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
);
