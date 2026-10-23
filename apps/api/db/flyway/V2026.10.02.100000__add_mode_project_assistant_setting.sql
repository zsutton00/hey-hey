-- Each Agent Mode chooses whether Project Assistant runs before its first
-- turn. The choice is a schema-backed `settings` section so it is typed,
-- validated through the MODE proposal path, and editable like `files`.
-- Absent settings keep Project Assistant on, so the section is optional and
-- existing MODE work items need no backfill.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE') THEN
    RAISE EXCEPTION 'Cannot add MODE Project Assistant setting; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    '{"key":"settings","label":"Session settings","kind":"json","schemaRef":"#/components/schemas/ProjectModeSettings","required":false,"writingStandard":"Provide a project-mode-settings.v1 value. Set projectAssistant.enabled deliberately: true when sessions in this mode benefit from Project Assistant preparing project context and keeping the project graph current before the first turn; false when the mode''s work does not need that. Omitting the section keeps Project Assistant on."}'::jsonb AS section_definition,
    'Decide whether Project Assistant should run before this mode''s first turn and record the choice in the settings section. It defaults to on; turn it off only when the mode''s work does not benefit from project context or graph upkeep.'::text AS create_standard,
    'Changing the Project Assistant setting affects only sessions launched afterward; sessions already launched keep the value captured at launch.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    mode.section_definitions || jsonb_build_array(guidance.section_definition) AS sections,
    jsonb_set(
      jsonb_set(COALESCE(mode.writing_standards, '{}'::jsonb), '{create}',
        to_jsonb(concat_ws(E'\n\n', NULLIF(mode.writing_standards->>'create', ''), guidance.create_standard)), true),
      '{edit}',
      to_jsonb(concat_ws(E'\n\n', NULLIF(mode.writing_standards->>'edit', ''), guidance.edit_standard)), true
    ) AS standards
  FROM work_item_type_template AS mode CROSS JOIN guidance
  WHERE mode.type_key = 'MODE'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(mode.section_definitions) AS existing(section)
      WHERE existing.section->>'key' = 'settings'
    )
)
UPDATE work_item_type_template AS mode
SET section_definitions = updated.sections,
    writing_standards = updated.standards,
    updated_at = CURRENT_TIMESTAMP
FROM updated
WHERE mode.id = updated.id;

-- Project-scoped MODE definitions are the effective definitions used for
-- proposal validation and snapshot capture, so they receive the same section.
WITH guidance AS (
  SELECT
    '{"key":"settings","label":"Session settings","kind":"json","schemaRef":"#/components/schemas/ProjectModeSettings","required":false,"writingStandard":"Provide a project-mode-settings.v1 value. Set projectAssistant.enabled deliberately: true when sessions in this mode benefit from Project Assistant preparing project context and keeping the project graph current before the first turn; false when the mode''s work does not need that. Omitting the section keeps Project Assistant on."}'::jsonb AS section_definition,
    'Decide whether Project Assistant should run before this mode''s first turn and record the choice in the settings section. It defaults to on; turn it off only when the mode''s work does not benefit from project context or graph upkeep.'::text AS create_standard,
    'Changing the Project Assistant setting affects only sessions launched afterward; sessions already launched keep the value captured at launch.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    mode.section_definitions || jsonb_build_array(guidance.section_definition) AS sections,
    jsonb_set(
      jsonb_set(COALESCE(mode.writing_standards, '{}'::jsonb), '{create}',
        to_jsonb(concat_ws(E'\n\n', NULLIF(mode.writing_standards->>'create', ''), guidance.create_standard)), true),
      '{edit}',
      to_jsonb(concat_ws(E'\n\n', NULLIF(mode.writing_standards->>'edit', ''), guidance.edit_standard)), true
    ) AS standards
  FROM work_item_type AS mode CROSS JOIN guidance
  WHERE mode.type_key = 'MODE'
    AND mode.project_id IS NOT NULL
    AND mode.lifecycle_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(mode.section_definitions) AS existing(section)
      WHERE existing.section->>'key' = 'settings'
    )
)
UPDATE work_item_type AS mode
SET section_definitions = updated.sections,
    writing_standards = updated.standards,
    updated_at = CURRENT_TIMESTAMP
FROM updated
WHERE mode.id = updated.id;
