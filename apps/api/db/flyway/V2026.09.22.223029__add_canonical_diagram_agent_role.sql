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
    RAISE EXCEPTION 'Cannot add Agent role: canonical Diagram Element policy is missing';
  END IF;
END
$migration$;

UPDATE work_item_type_template AS template
SET section_definitions = (
  SELECT jsonb_agg(
    CASE WHEN sections.section->>'key' = 'diagramElementMetadata' THEN
      jsonb_set(sections.section, '{diagramElementPolicy,roles}',
        (sections.section->'diagramElementPolicy'->'roles') ||
        '[{"key":"AGENT","label":"Agent","notation":"box"}]'::jsonb)
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
      AND roles.role->>'key' = 'AGENT'
  );

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM work_item_type_template,
      LATERAL jsonb_array_elements(section_definitions) AS sections(section),
      LATERAL jsonb_array_elements(sections.section->'diagramElementPolicy'->'roles') AS roles(role)
    WHERE type_key = 'DIAGRAM_ELEMENT'
      AND sections.section->>'key' = 'diagramElementMetadata'
      AND roles.role = '{"key":"AGENT","label":"Agent","notation":"box"}'::jsonb
  ) THEN
    RAISE EXCEPTION 'Canonical Agent role must use Agent label and box notation';
  END IF;
END
$migration$;
