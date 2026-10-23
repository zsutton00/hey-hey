-- Read both graph migration states until saved-record reconciliation retires
-- the legacy vocabulary. Authoring policies remain on their owning definitions.
CREATE FUNCTION pg_temp.diagram_transition_reads(config jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $function$
DECLARE
  expansions jsonb;
  participants jsonb;
BEGIN
  IF config IS NULL THEN
    RAISE EXCEPTION 'Diagram transition requires an existing graph configuration';
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'key', 'contractLinkedDiagrams_' || first_type || '_' || first_direction || '_' || second_type || '_' || second_direction,
    'seed', 'graphNodes',
    'path', jsonb_build_array(
      jsonb_build_object('relationshipType', first_type, 'direction', first_direction,
        'target', jsonb_build_object('entityTypes',jsonb_build_array('TASK'),'workItemTypeKeys',jsonb_build_array('CONTRACT'))),
      jsonb_build_object('relationshipType', second_type, 'direction', second_direction,
        'target', jsonb_build_object('entityTypes',jsonb_build_array('TASK'),'workItemTypeKeys',jsonb_build_array('workflow_step','DIAGRAM_ELEMENT'))),
      jsonb_build_object('relationshipType','HAS_TASK','direction','INCOMING',
        'target', jsonb_build_object('entityTypes',jsonb_build_array('TASK'),'workItemTypeKeys',jsonb_build_array('workflow','DIAGRAM')))),
    'projectionKind','workItemReference','deduplicateBy','entityId','excludeRoot',true,'limit',100
  ) ORDER BY first_type, first_direction, second_type, second_direction)
  INTO expansions
  FROM unnest(ARRAY['DEPENDS_ON','GUARANTEES']) first_types(first_type)
  CROSS JOIN unnest(ARRAY['DEPENDS_ON','GUARANTEES']) second_types(second_type)
  CROSS JOIN unnest(ARRAY['OUTGOING','INCOMING']) first_directions(first_direction)
  CROSS JOIN unnest(ARRAY['OUTGOING','INCOMING']) second_directions(second_direction);

  SELECT jsonb_agg(jsonb_build_object(
    'edgeType', participant_type, 'category', 'meta',
    'sourceEndpoint', jsonb_build_object('role','graphNode','entityTypes',jsonb_build_array('TASK'),
      'workItemTypeKeys',jsonb_build_array('workflow_step','DIAGRAM_ELEMENT')),
    'targetEndpoint', jsonb_build_object('role','externalEntity','entityTypes',jsonb_build_array('TASK'),
      'workItemTypeKeys',jsonb_build_array('CONTRACT'))
  )) INTO participants FROM unnest(ARRAY['GUARANTEES','IMPLEMENTS','CONSUMES']) participant_types(participant_type)
  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(config->'readableRelationships') r
    WHERE r->>'edgeType' = participant_type);
  config := jsonb_set(config, '{readableRelationships}', config->'readableRelationships' || coalesce(participants,'[]'::jsonb));

  RETURN jsonb_set(config, '{readExpansions}',
    coalesce((SELECT jsonb_agg(e) FROM jsonb_array_elements(coalesce(config->'readExpansions','[]'::jsonb)) e
      WHERE e->>'key' <> 'contractLinkedWorkflows' AND e->>'key' NOT LIKE 'contractLinkedDiagrams_%'), '[]'::jsonb)
    || expansions);
END
$function$;

UPDATE work_item_type_template
SET graph_configuration = pg_temp.diagram_transition_reads(graph_configuration), updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('workflow','DIAGRAM');

UPDATE work_item_type
SET graph_configuration = pg_temp.diagram_transition_reads(graph_configuration), updated_at = CURRENT_TIMESTAMP
WHERE type_key IN ('workflow','DIAGRAM');
