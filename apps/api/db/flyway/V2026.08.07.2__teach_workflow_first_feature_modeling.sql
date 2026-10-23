-- Publish revision 2 of the FEATURE and workflow templates, then immediately
-- advance every existing project-owned definition. The guidance is additive:
-- project-specific changes on other definition axes remain intact.

DO $migration$
DECLARE
  coverage_guidance text := E'\n\n## Workflow coverage\n\nBefore finalizing a behavior-bearing feature, identify the workflow the\nfeature owns or participates in. A feature may own its workflow or be\nmeaningfully represented by an ancestor or cross-feature workflow. Broader\ncoverage counts only when the workflow steps actually represent the feature\'s\nbehavior; do not create a ceremonial duplicate workflow for every nested\nfeature.\n\nKeep the modeling surfaces distinct. Feature requirements declare durable\noutcomes. workflow_step items describe states, actions, decisions, and\nhandoffs; STANDARD, CONDITIONAL, and LOOP describe flow between those steps.\nWhen a meaningful workflow step has concrete implementation, author\nFULFILLED_BY from the workflow_step to the implementing STANDARD task.\n\nIf no meaningful workflow, step, or STANDARD-task implementation target\nexists, surface the missing coverage for user review. Do not automatically\ngenerate a workflow, task, or fulfillment link merely to make the graph look\ncomplete.';
  invalid_baselines text;
  invalid_definitions text;
BEGIN
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
  INTO invalid_baselines
  FROM (VALUES ('FEATURE'), ('workflow')) AS expected(type_key)
  LEFT JOIN "work_item_type_template" template
    ON template."type_key" = expected.type_key
   AND template."revision" = 1
  WHERE template."id" IS NULL
     OR template."writing_standards"->>'create' IS NULL
     OR template."writing_standards"->>'edit' IS NULL;

  SELECT string_agg(
    COALESCE(definition."project_id", 'global') || ':' || definition."type_key",
    ', '
    ORDER BY definition."project_id", definition."type_key"
  )
  INTO invalid_definitions
  FROM "work_item_type" definition
  WHERE definition."type_key" IN ('FEATURE', 'workflow')
    AND (
      definition."writing_standards"->>'create' IS NULL
      OR definition."writing_standards"->>'edit' IS NULL
    );

  IF invalid_baselines IS NOT NULL OR invalid_definitions IS NOT NULL THEN
    RAISE EXCEPTION
      'Workflow-first writing standards are missing (baselines: %, definitions: %)',
      COALESCE(invalid_baselines, 'none'),
      COALESCE(invalid_definitions, 'none');
  END IF;

  INSERT INTO "work_item_type_template" (
    "type_key",
    "revision",
    "name",
    "description",
    "section_definitions",
    "allowed_parent_types",
    "allowed_child_types",
    "edge_targets",
    "allowed_statuses",
    "required_scalars",
    "forbidden_scalars",
    "parentage",
    "tracking",
    "agent_settable_statuses",
    "anchorable_report_types",
    "writing_standards",
    "capabilities",
    "graph_configuration",
    "created_at",
    "updated_at"
  )
  SELECT
    baseline."type_key",
    2,
    baseline."name",
    baseline."description",
    baseline."section_definitions",
    baseline."allowed_parent_types",
    baseline."allowed_child_types",
    baseline."edge_targets",
    baseline."allowed_statuses",
    baseline."required_scalars",
    baseline."forbidden_scalars",
    baseline."parentage",
    baseline."tracking",
    baseline."agent_settable_statuses",
    baseline."anchorable_report_types",
    jsonb_set(
      jsonb_set(
        baseline."writing_standards",
        '{create}',
        to_jsonb(baseline."writing_standards"->>'create' || coverage_guidance),
        false
      ),
      '{edit}',
      to_jsonb(baseline."writing_standards"->>'edit' || coverage_guidance),
      false
    ),
    baseline."capabilities",
    baseline."graph_configuration",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "work_item_type_template" baseline
  WHERE baseline."revision" = 1
    AND baseline."type_key" IN ('FEATURE', 'workflow');

  UPDATE "work_item_type"
  SET
    "writing_standards" = jsonb_set(
      jsonb_set(
        "writing_standards",
        '{create}',
        to_jsonb(
          CASE
            WHEN position('## Workflow coverage' IN "writing_standards"->>'create') = 0
              THEN "writing_standards"->>'create' || coverage_guidance
            ELSE "writing_standards"->>'create'
          END
        ),
        false
      ),
      '{edit}',
      to_jsonb(
        CASE
          WHEN position('## Workflow coverage' IN "writing_standards"->>'edit') = 0
            THEN "writing_standards"->>'edit' || coverage_guidance
          ELSE "writing_standards"->>'edit'
        END
      ),
      false
    ),
    "template_revision" = CASE
      WHEN "template_key" = "type_key" THEN 2
      ELSE "template_revision"
    END,
    "updated_at" = CURRENT_TIMESTAMP
  WHERE "type_key" IN ('FEATURE', 'workflow');

  IF EXISTS (
    SELECT 1
    FROM "work_item_type_template"
    WHERE "type_key" IN ('FEATURE', 'workflow')
      AND "revision" = 2
      AND (
        position('## Workflow coverage' IN "writing_standards"->>'create') = 0
        OR position('## Workflow coverage' IN "writing_standards"->>'edit') = 0
      )
  ) OR (
    SELECT COUNT(*)
    FROM "work_item_type_template"
    WHERE "type_key" IN ('FEATURE', 'workflow')
      AND "revision" = 2
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM "work_item_type"
    WHERE "type_key" IN ('FEATURE', 'workflow')
      AND (
        position('## Workflow coverage' IN "writing_standards"->>'create') = 0
        OR position('## Workflow coverage' IN "writing_standards"->>'edit') = 0
        OR ("template_key" = "type_key" AND "template_revision" <> 2)
      )
  ) THEN
    RAISE EXCEPTION 'Workflow-first revision 2 materialization was incomplete';
  END IF;
END
$migration$;
