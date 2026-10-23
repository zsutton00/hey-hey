-- Add the optional diagramGroups section and its graph declaration to the
-- canonical and project-owned Diagram definitions. Groups stay independent of
-- the authored graphLayout position map; existing Diagrams remain valid.

UPDATE "work_item_type"
SET
  "section_definitions" = CASE
    WHEN "section_definitions" @> '[{"key":"diagramGroups"}]'::jsonb
      THEN "section_definitions"
    ELSE "section_definitions" || '[{"key":"diagramGroups","label":"Diagram Groups","kind":"json","required":false,"schemaRef":"#/components/schemas/DiagramGroupsValue"}]'::jsonb
  END,
  "graph_configuration" = jsonb_set(
    "graph_configuration",
    '{groups}',
    '{"sectionKey":"diagramGroups","schemaRef":"#/components/schemas/DiagramGroupsValue"}'::jsonb,
    true
  )
WHERE "type_key" = 'DIAGRAM'
  AND "graph_configuration" IS NOT NULL;

UPDATE "work_item_type_template"
SET
  "section_definitions" = CASE
    WHEN "section_definitions" @> '[{"key":"diagramGroups"}]'::jsonb
      THEN "section_definitions"
    ELSE "section_definitions" || '[{"key":"diagramGroups","label":"Diagram Groups","kind":"json","required":false,"schemaRef":"#/components/schemas/DiagramGroupsValue"}]'::jsonb
  END,
  "graph_configuration" = jsonb_set(
    "graph_configuration",
    '{groups}',
    '{"sectionKey":"diagramGroups","schemaRef":"#/components/schemas/DiagramGroupsValue"}'::jsonb,
    true
  )
WHERE "type_key" = 'DIAGRAM'
  AND "graph_configuration" IS NOT NULL;
