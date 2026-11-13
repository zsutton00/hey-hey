-- Extend only the canonical policy. Complete project overrides retain authority.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template,
      LATERAL jsonb_array_elements(section_definitions) AS sections(section)
    WHERE type_key = 'DIAGRAM_ELEMENT'
      AND sections.section->>'key' = 'diagramElementMetadata'
      AND jsonb_typeof(sections.section->'diagramElementPolicy'->'roles') = 'array'
  ) THEN
    RAISE EXCEPTION 'Cannot add UI Start role: canonical Diagram Element policy is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template AS template
SET section_definitions = (
  SELECT jsonb_agg(
    CASE WHEN sections.section->>'key' = 'diagramElementMetadata' THEN
      jsonb_set(sections.section, '{diagramElementPolicy,roles}',
        (sections.section->'diagramElementPolicy'->'roles') ||
        '[{"key":"UI_START","label":"UI Start","notation":"box"}]'::jsonb)
    ELSE sections.section END ORDER BY sections.ordinal
  )
  FROM jsonb_array_elements(template.section_definitions)
    WITH ORDINALITY AS sections(section, ordinal)
), updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM_ELEMENT'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(template.section_definitions) AS sections(section),
      LATERAL jsonb_array_elements(sections.section->'diagramElementPolicy'->'roles') AS roles(role)
    WHERE sections.section->>'key' = 'diagramElementMetadata'
      AND roles.role->>'key' = 'UI_START'
  );

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template,
      LATERAL jsonb_array_elements(section_definitions) AS sections(section),
      LATERAL jsonb_array_elements(sections.section->'diagramElementPolicy'->'roles') AS roles(role)
    WHERE type_key = 'DIAGRAM_ELEMENT'
      AND sections.section->>'key' = 'diagramElementMetadata'
      AND roles.role = '{"key":"UI_START","label":"UI Start","notation":"box"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Canonical UI Start role must use UI Start label and box notation';
  END IF;
END
$migration$;

-- Teach UI_START in the canonical writing standards. Each replacement targets one
-- unchanged canonical fragment, so edited standards and repeat runs are left alone.
CREATE FUNCTION pg_temp.teach_ui_start(standards text) RETURNS text
LANGUAGE sql IMMUTABLE AS $function$
  SELECT replace(replace(replace(standards,
    'UI for an interface surface;',
    'UI for an interface surface, with UI_START instead for the entrance or primary screen of a UX_FLOW (every other screen is UI);'),
    'Good: role UI and canonical reference',
    'Good: role UI (UI_START for the flow''s entrance or primary screen) and canonical reference'),
    'UI screens "Public landing page" and "Demo project page"',
    'a UI_START screen "Public landing page" and a UI screen "Demo project page"')
$function$;

UPDATE work_item_type_template
SET writing_standards = jsonb_set(
      jsonb_set(writing_standards, '{create}', to_jsonb(pg_temp.teach_ui_start(writing_standards->>'create'))),
      '{edit}', to_jsonb(pg_temp.teach_ui_start(writing_standards->>'edit'))
    ),
    updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')
  AND writing_standards->>'create' IS NOT NULL
  AND writing_standards->>'edit' IS NOT NULL
  AND (writing_standards->>'create' <> pg_temp.teach_ui_start(writing_standards->>'create')
    OR writing_standards->>'edit' <> pg_temp.teach_ui_start(writing_standards->>'edit'));
