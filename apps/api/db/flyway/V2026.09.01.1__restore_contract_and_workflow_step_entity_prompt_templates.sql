DO $$
DECLARE
  published_contract_count INTEGER;
  published_workflow_step_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO published_contract_count
  FROM entity_prompt_template_revisions
  WHERE template_key = 'entity_context.work_item.contract'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  IF published_contract_count <> 0 THEN
    RAISE EXCEPTION
      'Expected no published canonical Contract entity prompt template before restoration, found %',
      published_contract_count;
  END IF;

  SELECT COUNT(*)
  INTO published_workflow_step_count
  FROM entity_prompt_template_revisions
  WHERE template_key = 'entity_context.work_item.workflow_step'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  IF published_workflow_step_count <> 1 THEN
    RAISE EXCEPTION
      'Expected one published canonical workflow-step entity prompt template before restoration, found %',
      published_workflow_step_count;
  END IF;
END
$$;

UPDATE entity_prompt_template_revisions
SET lifecycle_state = 'RETIRED',
    retired_at = CURRENT_TIMESTAMP
WHERE template_key = 'entity_context.work_item.workflow_step'
  AND ownership_scope = 'CANONICAL'
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
  ('entity_context.work_item.contract', '{"entityType":"WORK_ITEM","workItemTypeKey":"CONTRACT"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Contract context. Preserve the provider, owned boundary, durable promise, participants, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.workflow_step', '{"entityType":"WORK_ITEM","workItemTypeKey":"workflow_step"}'::jsonb, 'V1', 3, 'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Workflow Step context. Preserve state, action, handoff, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP);
