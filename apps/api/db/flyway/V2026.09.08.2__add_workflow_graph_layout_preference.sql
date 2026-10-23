-- Add the reusable preferred-shape section and declaration to every canonical
-- and project-owned Workflow definition. Preference data remains independent
-- from the authored graphLayout position map.

UPDATE "work_item_type"
SET
  "section_definitions" = CASE
    WHEN "section_definitions" @> '[{"key":"graphLayoutPreference"}]'::jsonb
      THEN "section_definitions"
    ELSE "section_definitions" || '[{"key":"graphLayoutPreference","label":"Graph Layout Preference","kind":"json","schemaRef":"#/components/schemas/WorkItemGraphLayoutPreferenceValue"}]'::jsonb
  END,
  "graph_configuration" = jsonb_set(
    "graph_configuration",
    '{layoutPreference}',
    '{"sectionKey":"graphLayoutPreference","schemaRef":"#/components/schemas/WorkItemGraphLayoutPreferenceValue"}'::jsonb,
    true
  )
WHERE "type_key" = 'workflow'
  AND "graph_configuration" IS NOT NULL;

UPDATE "work_item_type_template"
SET
  "section_definitions" = CASE
    WHEN "section_definitions" @> '[{"key":"graphLayoutPreference"}]'::jsonb
      THEN "section_definitions"
    ELSE "section_definitions" || '[{"key":"graphLayoutPreference","label":"Graph Layout Preference","kind":"json","schemaRef":"#/components/schemas/WorkItemGraphLayoutPreferenceValue"}]'::jsonb
  END,
  "graph_configuration" = jsonb_set(
    "graph_configuration",
    '{layoutPreference}',
    '{"sectionKey":"graphLayoutPreference","schemaRef":"#/components/schemas/WorkItemGraphLayoutPreferenceValue"}'::jsonb,
    true
  )
WHERE "type_key" = 'workflow'
  AND "graph_configuration" IS NOT NULL;
