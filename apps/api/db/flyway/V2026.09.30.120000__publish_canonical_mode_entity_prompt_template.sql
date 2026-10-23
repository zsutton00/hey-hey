-- Publish the canonical WORK_ITEM / MODE entity prompt template. Canonical
-- rows are global, so every project with an active MODE type resolves it.
-- Project-owned revisions are never touched, and the insert is skipped when a
-- published canonical MODE revision already exists.
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
  'entity_context.work_item.mode',
  '{"entityType":"WORK_ITEM","workItemTypeKey":"MODE"}'::jsonb,
  'V1',
  COALESCE(
    (
      SELECT MAX(revision_number)
      FROM entity_prompt_template_revisions
      WHERE template_key = 'entity_context.work_item.mode'
        AND ownership_scope = 'CANONICAL'
    ),
    0
  ) + 1,
  E'\n\n## Agent Mode\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\nAgent Mode body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.',
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
  WHERE template_key = 'entity_context.work_item.mode'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
);
