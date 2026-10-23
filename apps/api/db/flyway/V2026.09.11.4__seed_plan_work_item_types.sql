-- PLAN and PLAN_STAGE are protected canonical work-item types; refuse to
-- reinterpret a pre-existing project-authored type with either reserved key.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_item_type WHERE type_key IN ('PLAN', 'PLAN_STAGE')
  ) THEN
    RAISE EXCEPTION
      'Cannot reserve PLAN and PLAN_STAGE: project-owned definitions already use a protected key';
  END IF;
END
$migration$;

ALTER TABLE work_item_type_template
  DROP CONSTRAINT work_item_type_template_icon_key_check,
  ADD CONSTRAINT work_item_type_template_icon_key_check
    CHECK (icon_key IS NULL OR icon_key IN (
      'task', 'bug', 'feature', 'goal', 'contract', 'workflow', 'plan', 'plan-stage'
    ));

ALTER TABLE work_item_type
  DROP CONSTRAINT work_item_type_icon_key_check,
  ADD CONSTRAINT work_item_type_icon_key_check
    CHECK (icon_key IS NULL OR icon_key IN (
      'task', 'bug', 'feature', 'goal', 'contract', 'workflow', 'plan', 'plan-stage'
    ));

INSERT INTO work_item_type_template (
  id, type_key, name, role, icon_key, description, section_definitions,
  allowed_parent_types, edge_targets, allowed_statuses, required_scalars,
  forbidden_scalars, parentage, tracking, agent_settable_statuses,
  anchorable_report_types, writing_standards, capabilities,
  graph_configuration, accepted_config_kinds, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'PLAN',
  'Plan',
  'project-info',
  'plan',
  'A dependency-ordered collection of durable implementation stages.',
  '[{"key":"outcome","label":"Outcome","kind":"markdown","writingStandard":"State the concrete product outcome this Plan delivers."},{"key":"description","label":"Description","kind":"markdown","writingStandard":"Describe the Plan scope and constraints without duplicating scheduling edges."},{"key":"planConfiguration","label":"Plan configuration","kind":"json","schemaRef":"#/components/schemas/PlanConfigurationV1","writingStandard":"Store only the versioned Plan type and nullable worktree branch."}]'::jsonb,
  '["FEATURE"]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DERIVES_FROM","targetTypeKeys":[]}]'::jsonb,
  '["BACKLOG","REFINING","READY","ACTIVE","ON_HOLD","BLOCKED","COMPLETED","ARCHIVED"]'::jsonb,
  '[]'::jsonb,
  '["dueDate","tag"]'::jsonb,
  '{"allowedParentEntityTypes":["TASK"]}'::jsonb,
  '{"allowedSourceEntityTypes":["TASK"],"allowedSourceTaskTypes":["GOAL"]}'::jsonb,
  '["BACKLOG","REFINING","READY","ACTIVE","ON_HOLD","BLOCKED","COMPLETED","ARCHIVED"]'::jsonb,
  standard.anchorable_report_types,
  '{"create":"Create a Plan under its parent Feature after intake and the up-front Design Doc are complete. Author outcome, description, and plan configuration; represent chronology and prerequisites with DEPENDS_ON edges.","edit":"Edit Plan sections and status through generic work-item operations. Preserve Stage ordering as DEPENDS_ON edges rather than content or position fields."}'::jsonb,
  '{"requiresParent":true,"isHierarchyNode":false,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false,"showsInExplorerSidebar":true}'::jsonb,
  NULL,
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM work_item_type_template standard
WHERE standard.type_key = 'STANDARD';

INSERT INTO work_item_type_template (
  id, type_key, name, role, icon_key, description, section_definitions,
  allowed_parent_types, edge_targets, allowed_statuses, required_scalars,
  forbidden_scalars, parentage, tracking, agent_settable_statuses,
  anchorable_report_types, writing_standards, capabilities,
  graph_configuration, accepted_config_kinds, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'PLAN_STAGE',
  'Plan stage',
  'project-info',
  'plan-stage',
  'A durable dependency-ordered stage containing concrete Standard Tasks.',
  '[{"key":"description","label":"Description","kind":"markdown","writingStandard":"Describe the coherent implementation milestone represented by this Stage."}]'::jsonb,
  '["PLAN"]'::jsonb,
  '[{"edgeType":"RELATED_TO","targetTypeKeys":[]},{"edgeType":"DEPENDS_ON","targetTypeKeys":["PLAN_STAGE"]}]'::jsonb,
  '["BACKLOG","REFINING","ACTIVE","BLOCKED","COMPLETED","ARCHIVED"]'::jsonb,
  '[]'::jsonb,
  '["dueDate","tag"]'::jsonb,
  '{"allowedParentEntityTypes":["TASK"]}'::jsonb,
  '{"allowedSourceEntityTypes":[],"allowedSourceTaskTypes":[]}'::jsonb,
  '["BACKLOG","REFINING","ACTIVE","BLOCKED","COMPLETED","ARCHIVED"]'::jsonb,
  standard.anchorable_report_types,
  '{"create":"Create a Plan Stage under a PLAN. Every Stage after the first must DEPEND_ON its immediate predecessor; concrete work is authored as direct STANDARD children.","edit":"Edit Stage content and lifecycle through generic work-item operations. Do not add execution-guidance content or position fields."}'::jsonb,
  '{"requiresParent":true,"isHierarchyNode":false,"planEligible":false,"hasSetInitialStatus":false,"rendersInline":false,"showsInExplorerSidebar":false}'::jsonb,
  NULL,
  '[]'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM work_item_type_template standard
WHERE standard.type_key = 'STANDARD';

UPDATE work_item_type_template
SET allowed_parent_types = CASE
      WHEN allowed_parent_types @> '["PLAN_STAGE"]'::jsonb
        THEN allowed_parent_types
      ELSE allowed_parent_types || '["PLAN_STAGE"]'::jsonb
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'STANDARD';

UPDATE work_item_type
SET allowed_parent_types = CASE
      WHEN allowed_parent_types @> '["PLAN_STAGE"]'::jsonb
        THEN allowed_parent_types
      ELSE allowed_parent_types || '["PLAN_STAGE"]'::jsonb
    END,
    updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'STANDARD';

DO $migration$
DECLARE
  missing TEXT;
BEGIN
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
  INTO missing
  FROM (VALUES ('PLAN'), ('PLAN_STAGE')) AS expected(type_key)
  LEFT JOIN work_item_type_template template
    ON template.type_key = expected.type_key
  WHERE template.id IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical Plan work-item definitions missing: %', missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template
    WHERE type_key = 'STANDARD'
      AND allowed_parent_types @> '["PLAN_STAGE"]'::jsonb
  ) THEN
    RAISE EXCEPTION 'STANDARD does not allow PLAN_STAGE parentage';
  END IF;
END
$migration$;
