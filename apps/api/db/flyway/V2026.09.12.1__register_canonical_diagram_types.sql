-- Register the canonical family without migrating records or rewriting history.
-- The subsequent identity-preserving cutover owns stored workflow conversion.
DO $migration$
BEGIN
  IF (SELECT count(*) FROM work_item_type_template WHERE type_key IN ('workflow', 'workflow_step')) <> 2 THEN
    RAISE EXCEPTION 'Cannot register Diagram family: canonical Workflow definitions are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM work_item_type WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT'))
     OR EXISTS (SELECT 1 FROM work_item_type_template WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')) THEN
    RAISE EXCEPTION 'Cannot reserve Diagram keys: definitions already exist';
  END IF;
END
$migration$;

CREATE FUNCTION pg_temp.diagram_definition(original jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $function$
DECLARE
  element boolean := original->>'type_key' = 'workflow_step';
  sections jsonb := original->'section_definitions';
  graph_config jsonb := original->'graph_configuration';
  roles jsonb;
  participants jsonb;
BEGIN
  SELECT jsonb_agg(jsonb_build_object(
    'key', role, 'label', initcap(replace(role, '_', ' ')),
    'notation', CASE role WHEN 'PERSON' THEN 'person' WHEN 'DATABASE' THEN 'cylinder'
      WHEN 'DECISION' THEN 'diamond' WHEN 'DIAGRAM_REFERENCE' THEN 'frame' ELSE 'box' END
  ) ORDER BY ordinal)
  INTO roles FROM unnest(ARRAY['GENERIC','PERSON','SOFTWARE_SYSTEM','CONTAINER','COMPONENT',
    'CODE','DATABASE','UI','PRODUCT','DECISION','EXTERNAL_SYSTEM','DIAGRAM_REFERENCE'])
    WITH ORDINALITY AS r(role, ordinal);

  SELECT jsonb_agg(jsonb_build_object(
    'edgeType', edge_type, 'category', 'meta',
    'sourceEndpoint', jsonb_build_object('role','graphNode','entityTypes',jsonb_build_array('TASK'),
      'workItemTypeKeys',jsonb_build_array('DIAGRAM_ELEMENT')),
    'targetEndpoint', jsonb_build_object('role','externalEntity','entityTypes',jsonb_build_array('TASK'),
      'workItemTypeKeys',jsonb_build_array('CONTRACT'))
  )) INTO participants FROM unnest(ARRAY['GUARANTEES','IMPLEMENTS','CONSUMES']) AS e(edge_type);

  IF element THEN
    sections := sections || jsonb_build_array(jsonb_build_object(
      'key','diagramElementMetadata','label','Element metadata','kind','json','required',true,
      'schemaRef','#/components/schemas/DiagramElementMetadata',
      'diagramElementPolicy',jsonb_build_object('roles',roles,'referenceTargets',
        jsonb_build_array(jsonb_build_object('entityType','TASK'),jsonb_build_object('entityType','SERVICE')))));
  ELSE
    sections := sections || '[{"key":"diagramMetadata","label":"Diagram metadata","kind":"json","required":true,"schemaRef":"#/components/schemas/DiagramMetadata"}]'::jsonb;
    graph_config := replace(replace(graph_config::text, '"workflow_step"', '"DIAGRAM_ELEMENT"'),
      '"workflow"', '"DIAGRAM"')::jsonb;
    graph_config := jsonb_set(graph_config, '{readableRelationships}',
      coalesce(graph_config->'readableRelationships','[]'::jsonb) || participants);
    graph_config := jsonb_set(graph_config, '{editableRelationships}',
      coalesce(graph_config->'editableRelationships','[]'::jsonb) || participants);
    -- Keep the existing renderer/editor keys until the consumer cutover.
    graph_config := jsonb_set(graph_config, '{rendererKey}', original->'graph_configuration'->'rendererKey');
    graph_config := jsonb_set(graph_config, '{editorKey}', original->'graph_configuration'->'editorKey');
  END IF;

  RETURN original || jsonb_build_object(
    'id',gen_random_uuid(), 'type_key',CASE WHEN element THEN 'DIAGRAM_ELEMENT' ELSE 'DIAGRAM' END,
    'name',CASE WHEN element THEN 'Diagram Element' ELSE 'Diagram' END,
    'description',CASE WHEN element THEN 'A semantic element in a Diagram with an optional canonical reference.'
      ELSE 'A graph-shaped design artifact with explicit kind and abstraction level.' END,
    'section_definitions',sections,
    'edge_targets',replace(replace((original->'edge_targets')::text,
      '"workflow_step"','"DIAGRAM_ELEMENT"'),'"workflow"','"DIAGRAM"')::jsonb
      || CASE WHEN element THEN '[{"edgeType":"GUARANTEES","targetTypeKeys":["CONTRACT"]},{"edgeType":"IMPLEMENTS","targetTypeKeys":["CONTRACT"]},{"edgeType":"CONSUMES","targetTypeKeys":["CONTRACT"]}]'::jsonb ELSE '[]'::jsonb END,
    'allowed_parent_types',CASE WHEN element THEN '["DIAGRAM"]'::jsonb ELSE original->'allowed_parent_types' END,
    'graph_configuration',graph_config,
    'agent_guidance',jsonb_build_object('overview',CASE WHEN element
      THEN 'A Diagram Element is a placement in a Diagram. Its optional canonical reference identifies a represented entity without cloning it. Role and notation are governed by this effective definition. Contract participation is explicit topology.'
      ELSE 'A Diagram is a graph-shaped design artifact with explicit kind and abstraction level. It is project knowledge and never implies runtime execution.' END),
    'writing_standards',jsonb_build_object('create','Author Diagram semantics through metadata sections. References preserve canonical entity identities and never imply execution.',
      'edit','Review the complete Diagram result. Preserve canonical references, topology and layout.'),
    'created_at',CURRENT_TIMESTAMP,'updated_at',CURRENT_TIMESTAMP);
END
$function$;

INSERT INTO work_item_type_template
SELECT (jsonb_populate_record(NULL::work_item_type_template,
  pg_temp.diagram_definition(to_jsonb(t)))).*
FROM work_item_type_template t WHERE type_key IN ('workflow','workflow_step');

INSERT INTO work_item_type
SELECT (jsonb_populate_record(NULL::work_item_type,
  pg_temp.diagram_definition(to_jsonb(t)))).*
FROM work_item_type t WHERE type_key IN ('workflow','workflow_step');
