-- Let Diagram Elements carry the ordinary informational links the rest of the
-- project uses. SUPERSEDES stays excluded: it keeps its supersede-transition
-- path. Allowed source/target type pairs still come from edge_targets.
CREATE FUNCTION pg_temp.diagram_element_informational_links(config jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $function$
DECLARE
  declarations jsonb;
  readable jsonb;
  editable jsonb;
BEGIN
  IF config IS NULL THEN
    RAISE EXCEPTION 'Diagram element links require an existing graph configuration';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'edgeType', edge_type, 'category', 'meta',
    'sourceEndpoint', jsonb_build_object('role','graphNode','entityTypes',jsonb_build_array('TASK'),
      'workItemTypeKeys',jsonb_build_array('DIAGRAM_ELEMENT')),
    'targetEndpoint', jsonb_build_object('role','externalEntity','entityTypes',jsonb_build_array('TASK')),
    'direction', jsonb_build_object('required',false,'allowedDirections','[]'::jsonb,'predicateRequired',false),
    'metadataSchemaRef', '#/components/schemas/RelationshipMetadata'
  ) ORDER BY ordinal)
  INTO declarations
  FROM unnest(ARRAY['RELATED_TO','DERIVES_FROM','CONTRADICTS','EVOLVES'])
    WITH ORDINALITY AS e(edge_type, ordinal);

  SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO readable
  FROM jsonb_array_elements(declarations) d
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(config->'readableRelationships','[]'::jsonb)) r
    WHERE r->>'edgeType' = d->>'edgeType');

  SELECT coalesce(jsonb_agg(d), '[]'::jsonb) INTO editable
  FROM jsonb_array_elements(declarations) d
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(config->'editableRelationships','[]'::jsonb)) r
    WHERE r->>'edgeType' = d->>'edgeType');

  config := jsonb_set(config, '{readableRelationships}',
    coalesce(config->'readableRelationships','[]'::jsonb) || readable);
  RETURN jsonb_set(config, '{editableRelationships}',
    coalesce(config->'editableRelationships','[]'::jsonb) || editable);
END
$function$;

UPDATE work_item_type_template
SET graph_configuration = pg_temp.diagram_element_informational_links(graph_configuration),
  updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM';

UPDATE work_item_type
SET graph_configuration = pg_temp.diagram_element_informational_links(graph_configuration),
  updated_at = CURRENT_TIMESTAMP
WHERE type_key = 'DIAGRAM';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM work_item_type_template,
      LATERAL jsonb_array_elements(graph_configuration->'editableRelationships') r
    WHERE type_key = 'DIAGRAM' AND r->>'edgeType' = 'SUPERSEDES'
  ) THEN
    RAISE EXCEPTION 'SUPERSEDES must not be an editable Diagram relationship';
  END IF;
  IF (
    SELECT count(DISTINCT r->>'edgeType') FROM work_item_type_template,
      LATERAL jsonb_array_elements(graph_configuration->'editableRelationships') r
    WHERE type_key = 'DIAGRAM'
      AND r->>'edgeType' IN ('RELATED_TO','DERIVES_FROM','CONTRADICTS','EVOLVES')
  ) <> 4 THEN
    RAISE EXCEPTION 'Canonical Diagram must allow informational element links';
  END IF;
END
$migration$;
