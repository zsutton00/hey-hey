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
      'Expected 12 published canonical entity prompt templates before structured-context publication, found %',
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
  (
    'entity_context.project',
    '{"entityType":"PROJECT"}'::jsonb,
    'V1',
    3,
    'Project body: {{entity.name}}; status: {{entity.status}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.plan',
    '{"entityType":"PLAN"}'::jsonb,
    'V1',
    3,
    'Plan body: {{entity.title}}; outcome: {{entity.outcome}}; status: {{entity.status}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.design_doc',
    '{"entityType":"DESIGN_DOC"}'::jsonb,
    'V1',
    3,
    'Design document body: {{entity.name}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.agent_session',
    '{"entityType":"AGENT_SESSION"}'::jsonb,
    'V1',
    3,
    'Agent Session body: {{entity.title}}; status: {{entity.status}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.standard',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"STANDARD"}'::jsonb,
    'V1',
    3,
    'Work Item body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.feature',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"FEATURE"}'::jsonb,
    'V1',
    3,
    'Feature body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.goal',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"GOAL"}'::jsonb,
    'V1',
    3,
    'Goal body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.bug',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"BUG"}'::jsonb,
    'V1',
    3,
    'Bug body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.contract',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"CONTRACT"}'::jsonb,
    'V1',
    2,
    'Contract body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.task_monitor',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"TASK_MONITOR"}'::jsonb,
    'V1',
    2,
    'Task Monitor body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
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
    4,
    'Workflow body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  ),
  (
    'entity_context.work_item.workflow_step',
    '{"entityType":"WORK_ITEM","workItemTypeKey":"workflow_step"}'::jsonb,
    'V1',
    4,
    'Workflow Step body: {{entity.name}}; type: {{entity.type}}; status: {{entity.status}}; sections: {{entity.sections}}. Context identity: {{context.entityId}} / {{context.entityType}}. Related entities: {{context.relatedEntities}}. Feature hierarchy: {{context.featureHierarchy}}. Proposals: {{context.proposals}}. Agent sessions: {{context.agentSessions}}.',
    'CANONICAL',
    'PUBLISHED',
    'VALID',
    '[]'::jsonb,
    CURRENT_TIMESTAMP,
    'entity-prompt-template-v1',
    CURRENT_TIMESTAMP
  );
