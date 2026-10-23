-- Preserve complete MODE descriptions; the first sentence appears in AgentSetup.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key = 'MODE') THEN
    RAISE EXCEPTION 'Cannot publish MODE picker guidance; canonical MODE template is missing';
  END IF;
END
$migration$;

WITH guidance AS (
  SELECT
    'Make the first sentence of the catalog description a concise, standalone summary for the launch picker. Keep the full description in this section.'::text AS section_standard,
    'Make the first sentence of the catalog description a concise, standalone launch-picker summary; keep the full description in the description section.'::text AS create_standard,
    'When editing the catalog description, keep its first sentence a concise, standalone launch-picker summary and retain the full description in the description section.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    (
      SELECT jsonb_agg(
        CASE WHEN section->>'key' = 'description' THEN
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
    'Make the first sentence of the catalog description a concise, standalone summary for the launch picker. Keep the full description in this section.'::text AS section_standard,
    'Make the first sentence of the catalog description a concise, standalone launch-picker summary; keep the full description in the description section.'::text AS create_standard,
    'When editing the catalog description, keep its first sentence a concise, standalone launch-picker summary and retain the full description in the description section.'::text AS edit_standard
),
updated AS (
  SELECT mode.id,
    (
      SELECT jsonb_agg(
        CASE WHEN section->>'key' = 'description' THEN
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
