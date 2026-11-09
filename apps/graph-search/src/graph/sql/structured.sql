WITH RECURSIVE settings AS (SELECT $1::text AS org,$2::text AS project,$3::jsonb AS expansion),
walk AS (
 SELECT n.id,n.entity_type,0 AS depth,ARRAY[]::text[] AS edges,
        jsonb_build_array(jsonb_build_object('entityId',n.id,'entityType',n.entity_type)) AS identities
 FROM settings s, jsonb_array_elements(s.expansion->'seeds') seed
 JOIN graph.node n ON n.id=seed->>'entityId' AND n.entity_type=seed->>'entityType'
 WHERE n.organization_id=s.org AND n.project_id=s.project AND n.project_scoped AND NOT n.deleted AND NOT n.stub AND n.properties->>'archivedAt' IS NULL AND COALESCE(n.properties->>'status','')<>'ARCHIVED'
 UNION ALL
 SELECT n.id,n.entity_type,w.depth+1,w.edges||e.id,
        w.identities||jsonb_build_array(jsonb_build_object('entityId',n.id,'entityType',n.entity_type))
 FROM walk w CROSS JOIN settings s
 CROSS JOIN LATERAL (
   SELECT * FROM graph.edge WHERE organization_id=s.org AND project_id=s.project AND source_id=w.id
     AND s.expansion->'path'->w.depth->>'direction'='OUTGOING'
   UNION ALL
   SELECT * FROM graph.edge WHERE organization_id=s.org AND project_id=s.project AND target_id=w.id
     AND s.expansion->'path'->w.depth->>'direction'='INCOMING'
 ) e
 JOIN graph.node n ON n.organization_id=s.org AND n.project_id=s.project
   AND n.id=CASE WHEN s.expansion->'path'->w.depth->>'direction'='OUTGOING' THEN e.target_id ELSE e.source_id END
 WHERE w.depth<jsonb_array_length(s.expansion->'path') AND (w.depth=0 OR w.entity_type<>'USER')
 AND NOT e.id=ANY(w.edges) AND n.project_scoped AND NOT n.deleted AND NOT n.stub AND n.properties->>'archivedAt' IS NULL AND COALESCE(n.properties->>'status','')<>'ARCHIVED'
 AND e.relationship_type=s.expansion->'path'->w.depth->>'relationshipType'
 AND s.expansion->'path'->w.depth->'entityTypes' ? n.entity_type
 AND (COALESCE(s.expansion->'path'->w.depth->'workItemTypeKeys','[]')='[]'
      OR n.entity_type='TASK' AND s.expansion->'path'->w.depth->'workItemTypeKeys' ? (n.properties->>'type'))
), targets AS (
 SELECT id,entity_type,jsonb_agg(DISTINCT jsonb_build_object('identities',identities)) AS paths
 FROM walk w CROSS JOIN settings s
 WHERE w.depth=jsonb_array_length(s.expansion->'path')
 AND NOT (COALESCE((s.expansion->>'excludeRoot')::boolean,false) AND id=$4 AND entity_type=$5)
 GROUP BY id,entity_type ORDER BY entity_type,id LIMIT ($3::jsonb->>'limit')::int
)
SELECT jsonb_build_object('identity',jsonb_build_object('entityId',id,'entityType',entity_type),'paths',paths)::text AS "data!"
FROM targets ORDER BY entity_type,id
