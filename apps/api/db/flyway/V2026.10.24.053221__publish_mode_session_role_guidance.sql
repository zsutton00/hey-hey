-- Publish session role choices without rewriting authored modes or existing eligibility guidance.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE') THEN
    RAISE EXCEPTION 'Cannot publish MODE session role guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    'Set sessionRole to implementation, research, planning, or review. Omitted sessionRole, including an omitted settings section, resolves to implementation. Multiple modes may share a role; this is separate from the MODE registry role. Keep role selection in settings, not MODE.md.'::text AS section_standard,
    'Choose the kind of work this mode performs using settings.sessionRole: implementation, research, planning, or review. Omission defaults to implementation.'::text AS create_standard,
    'Keep settings.sessionRole aligned with the mode purpose. Use implementation, research, planning, or review; omission defaults to implementation. Preserve other session settings.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    (
      SELECT jsonb_agg(
        CASE WHEN section->>'key' = 'settings' AND position(guidance.section_standard IN COALESCE(section->>'writingStandard', '')) = 0 THEN
          jsonb_set(section, '{writingStandard}',
            to_jsonb(concat_ws(' ', NULLIF(section->>'writingStandard', ''), guidance.section_standard)), true)
        ELSE section END ORDER BY position)
      FROM jsonb_array_elements(mode.section_definitions) WITH ORDINALITY AS definitions(section, position)
    ) AS sections,
    jsonb_set(
      jsonb_set(COALESCE(mode.writing_standards, '{}'::jsonb), '{create}',
        to_jsonb(concat_ws(E'\n\n', NULLIF(mode.writing_standards->>'create', ''), guidance.create_standard)), true),
      '{edit}',
      to_jsonb(concat_ws(E'\n\n', NULLIF(mode.writing_standards->>'edit', ''), guidance.edit_standard)), true
    ) AS standards
  FROM work_item_type_template AS mode CROSS JOIN guidance
  WHERE mode.type_key = 'MODE'
)
UPDATE work_item_type_template AS mode
SET section_definitions = updated.sections,
    writing_standards = updated.standards,
    updated_at = CURRENT_TIMESTAMP
FROM updated
WHERE mode.id = updated.id;

WITH guidance AS (
  SELECT
    'Set sessionRole to implementation, research, planning, or review. Omitted sessionRole, including an omitted settings section, resolves to implementation. Multiple modes may share a role; this is separate from the MODE registry role. Keep role selection in settings, not MODE.md.'::text AS section_standard,
    'Choose the kind of work this mode performs using settings.sessionRole: implementation, research, planning, or review. Omission defaults to implementation.'::text AS create_standard,
    'Keep settings.sessionRole aligned with the mode purpose. Use implementation, research, planning, or review; omission defaults to implementation. Preserve other session settings.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    (
      SELECT jsonb_agg(
        CASE WHEN section->>'key' = 'settings' AND position(guidance.section_standard IN COALESCE(section->>'writingStandard', '')) = 0 THEN
          jsonb_set(section, '{writingStandard}',
            to_jsonb(concat_ws(' ', NULLIF(section->>'writingStandard', ''), guidance.section_standard)), true)
        ELSE section END ORDER BY position)
      FROM jsonb_array_elements(mode.section_definitions) WITH ORDINALITY AS definitions(section, position)
    ) AS sections,
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
)
UPDATE work_item_type AS mode
SET section_definitions = updated.sections,
    writing_standards = updated.standards,
    updated_at = CURRENT_TIMESTAMP
FROM updated
WHERE mode.id = updated.id;
