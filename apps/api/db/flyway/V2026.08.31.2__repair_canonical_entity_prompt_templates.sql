DO $$
DECLARE
  published_canonical_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO published_canonical_count
  FROM entity_prompt_template_revisions
  WHERE ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  IF published_canonical_count <> 10 THEN
    RAISE EXCEPTION
      'Expected 10 published canonical entity prompt templates before repair, found %',
      published_canonical_count;
  END IF;
END
$$;

UPDATE entity_prompt_template_revisions
SET lifecycle_state = 'RETIRED',
    retired_at = CURRENT_TIMESTAMP
WHERE ownership_scope = 'CANONICAL'
  AND lifecycle_state = 'PUBLISHED';

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
VALUES
  ('entity_context.project', '{"entityType":"PROJECT"}'::jsonb, 'V1', 2, 'Use {{entity.id}} and {{context.entityId}} as authoritative project context. Preserve entity types, hierarchy, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.plan', '{"entityType":"PLAN"}'::jsonb, 'V1', 2, 'Use {{entity.id}} and {{context.entityId}} as authoritative plan context. Preserve stages, steps, design decisions, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.design_doc', '{"entityType":"DESIGN_DOC"}'::jsonb, 'V1', 2, 'Use {{entity.id}} and {{context.entityId}} as authoritative design-document context. Preserve decisions, requirements, linked implementation work, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.agent_session', '{"entityType":"AGENT_SESSION"}'::jsonb, 'V1', 2, 'Use {{entity.id}} and {{context.entityId}} as authoritative Agent Session context. Preserve task, messages, decisions, handoffs, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.standard', '{"entityType":"WORK_ITEM","workItemTypeKey":"STANDARD"}'::jsonb, 'V1', 2, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Work Item context. Preserve type, hierarchy, requirements, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.feature', '{"entityType":"WORK_ITEM","workItemTypeKey":"FEATURE"}'::jsonb, 'V1', 2, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Feature context. Preserve product intent, requirements, hierarchy, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.goal', '{"entityType":"WORK_ITEM","workItemTypeKey":"GOAL"}'::jsonb, 'V1', 2, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Goal context. Preserve outcome, scope, linked work, hierarchy, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.bug', '{"entityType":"WORK_ITEM","workItemTypeKey":"BUG"}'::jsonb, 'V1', 2, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Bug context. Preserve the defect, required fix, affected hierarchy, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.workflow', '{"entityType":"WORK_ITEM","workItemTypeKey":"WORKFLOW"}'::jsonb, 'V1', 2, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Workflow context. Preserve purpose, steps, handoffs, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.workflow_step', '{"entityType":"WORK_ITEM","workItemTypeKey":"WORKFLOW_STEP"}'::jsonb, 'V1', 2, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Workflow Step context. Preserve state, action, handoff, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP);
