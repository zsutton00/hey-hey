-- Publish corrected canonical templates for the two parent types that may
-- structurally own TASK_MONITOR work items. Existing project-owned definitions
-- deliberately remain on their accepted revisions until a reviewed template
-- refresh is approved for that project.

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
  "type_key",
  2,
  "name",
  "description",
  "section_definitions",
  "allowed_parent_types",
  "allowed_child_types" || '["TASK_MONITOR"]'::jsonb,
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
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "work_item_type_template"
WHERE "revision" = 1
  AND "type_key" IN ('FEATURE', 'STANDARD');

DO $migration$
DECLARE
  invalid_templates TEXT;
BEGIN
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
  INTO invalid_templates
  FROM (VALUES ('FEATURE'), ('STANDARD')) AS expected(type_key)
  LEFT JOIN "work_item_type_template" template
    ON template.type_key = expected.type_key
   AND template.revision = 2
  WHERE template.id IS NULL
     OR template.allowed_child_types <> (
       SELECT revision_one.allowed_child_types || '["TASK_MONITOR"]'::jsonb
       FROM "work_item_type_template" revision_one
       WHERE revision_one.type_key = expected.type_key
         AND revision_one.revision = 1
     );

  IF invalid_templates IS NOT NULL THEN
    RAISE EXCEPTION
      'Canonical TASK_MONITOR parent template revision failed for: %',
      invalid_templates;
  END IF;
END
$migration$;
