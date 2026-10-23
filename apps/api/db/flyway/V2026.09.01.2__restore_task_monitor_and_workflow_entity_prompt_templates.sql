DO $$
DECLARE
  published_task_monitor_count INTEGER;
  published_workflow_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO published_task_monitor_count
  FROM entity_prompt_template_revisions
  WHERE template_key = 'entity_context.work_item.task_monitor'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  IF published_task_monitor_count <> 0 THEN
    RAISE EXCEPTION
      'Expected no published canonical Task Monitor entity prompt template before restoration, found %',
      published_task_monitor_count;
  END IF;

  SELECT COUNT(*)
  INTO published_workflow_count
  FROM entity_prompt_template_revisions
  WHERE template_key = 'entity_context.work_item.workflow'
    AND ownership_scope = 'CANONICAL'
    AND lifecycle_state = 'PUBLISHED';

  IF published_workflow_count <> 1 THEN
    RAISE EXCEPTION
      'Expected one published canonical Workflow entity prompt template before restoration, found %',
      published_workflow_count;
  END IF;
END
$$;

UPDATE entity_prompt_template_revisions
SET lifecycle_state = 'RETIRED',
    retired_at = CURRENT_TIMESTAMP
WHERE template_key = 'entity_context.work_item.workflow'
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
  (
    'entity_context.work_item.task_monitor',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"TASK_MONITOR"}'::jsonb,
    'V1',
    1,
    'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Task Monitor context. Preserve selected-work execution intent, dependencies, policies, cursor, linked sessions, checkpoints, halt state, and provenance. Do not invent missing fields or relationships.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.workflow',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"workflow"}'::jsonb,
    'V1',
    3,
    'Use {{entity.id}}, {{entity.type}}, and {{context.entityId}} as authoritative Workflow context. Preserve purpose, steps, handoffs, links, and provenance. Do not invent missing fields or relationships.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  );
