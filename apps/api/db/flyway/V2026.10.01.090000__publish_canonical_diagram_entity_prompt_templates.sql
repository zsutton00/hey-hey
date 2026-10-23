-- Publish the canonical WORK_ITEM / DIAGRAM and WORK_ITEM / DIAGRAM_ELEMENT
-- entity prompt templates. Canonical rows are global, so every project with an
-- active Diagram type resolves them. Project-owned revisions are never touched,
-- and each insert is skipped when a published canonical revision for that
-- selector already exists (staging received these rows outside migrations).
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
  'entity_context.work_item.diagram',
  '{"entityType":"WORK_ITEM","workItemTypeKey":"DIAGRAM"}'::jsonb,
  'V1',
  1,
  E'\n\n## Diagram\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\nDiagram body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.',
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
  WHERE template_key = 'entity_context.work_item.diagram'
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
  'entity_context.work_item.diagram_element',
  '{"entityType":"WORK_ITEM","workItemTypeKey":"DIAGRAM_ELEMENT"}'::jsonb,
  'V1',
  1,
  E'\n\n## Diagram Element\n\n### Context identity:\n\n{{context.entityId}} / {{context.entityType}}.\n\nDiagram Element body: {{entity.name}};\n\ntype: {{entity.type}};\n\nstatus: {{entity.status}};\n\nsections: {{entity.sections}}.\n\n### Related entities:\n\n{{context.relatedEntities}}.\n\n### Feature hierarchy:\n\n{{context.featureHierarchy}}.\n\n### Proposals:\n\n{{context.proposals}}.\n\n### Agent sessions:\n\n{{context.agentSessions}}.',
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
  WHERE template_key = 'entity_context.work_item.diagram_element'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED'
);
