-- Correct the canonical TASK_MONITOR parent contract in place. The preceding
-- migration published revision 2 without updating project-owned definitions;
-- this migration restores revision 1 as the single canonical definition and
-- immediately backfills every existing project snapshot.

UPDATE "work_item_type_template"
SET
  "allowed_child_types" = CASE
    WHEN "allowed_child_types" @> '["TASK_MONITOR"]'::jsonb
      THEN "allowed_child_types"
    ELSE "allowed_child_types" || '["TASK_MONITOR"]'::jsonb
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "revision" = 1
  AND "type_key" IN ('FEATURE', 'STANDARD');

UPDATE "work_item_type"
SET
  "allowed_child_types" = CASE
    WHEN "allowed_child_types" @> '["TASK_MONITOR"]'::jsonb
      THEN "allowed_child_types"
    ELSE "allowed_child_types" || '["TASK_MONITOR"]'::jsonb
  END,
  "template_revision" = CASE
    WHEN "template_key" = "type_key" THEN 1
    ELSE "template_revision"
  END,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "type_key" IN ('FEATURE', 'STANDARD');

DELETE FROM "work_item_type_template"
WHERE "revision" = 2
  AND "type_key" IN ('FEATURE', 'STANDARD');

DO $migration$
DECLARE
  invalid_templates TEXT;
  invalid_projects TEXT;
BEGIN
  SELECT string_agg(expected.type_key, ', ' ORDER BY expected.type_key)
  INTO invalid_templates
  FROM (VALUES ('FEATURE'), ('STANDARD')) AS expected(type_key)
  LEFT JOIN "work_item_type_template" template
    ON template.type_key = expected.type_key
   AND template.revision = 1
  WHERE template.id IS NULL
     OR NOT template.allowed_child_types @> '["TASK_MONITOR"]'::jsonb;

  SELECT string_agg(
    project_definition.project_id || ':' || project_definition.type_key,
    ', '
    ORDER BY project_definition.project_id, project_definition.type_key
  )
  INTO invalid_projects
  FROM "work_item_type" project_definition
  WHERE project_definition.type_key IN ('FEATURE', 'STANDARD')
    AND NOT project_definition.allowed_child_types @> '["TASK_MONITOR"]'::jsonb;

  IF invalid_templates IS NOT NULL OR invalid_projects IS NOT NULL THEN
    RAISE EXCEPTION
      'Canonical TASK_MONITOR parent backfill failed (templates: %, projects: %)',
      COALESCE(invalid_templates, 'none'),
      COALESCE(invalid_projects, 'none');
  END IF;
END
$migration$;
