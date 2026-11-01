WITH RECURSIVE
settings AS (
 SELECT $1::text AS org, $2::text AS project, $3::text[] AS seeds, $4::jsonb AS request
),
-- Each branch is either bounded ordinary adjacency or an explicit hop chain.
branches AS (
 SELECT 0::bigint AS branch, COALESCE((request->'traversal'->>'depth')::int,2) AS max_depth,
        NULL::jsonb AS chain, '[]'::jsonb AS seed_types FROM settings
 UNION ALL
 SELECT ordinal, jsonb_array_length(expansion->'relationshipChain'), expansion->'relationshipChain',
        COALESCE(expansion->'seedEntityTypes','[]')
 FROM settings, jsonb_array_elements(COALESCE(request->'traversal'->'pathExpansions','[]'))
 WITH ORDINALITY AS expansions(expansion,ordinal)
),
-- Inline scoped endpoint checks at each node visit. Only the eligibility bit
-- enters the recursive work table; payload hydration happens after selection.
nodes AS NOT MATERIALIZED (
 SELECT n.*, (n.project_scoped AND NOT n.stub AND n.created_at IS NOT NULL AND n.updated_at IS NOT NULL
 AND (COALESCE(s.request->'filters'->'entityTypes','[]')='[]' OR s.request->'filters'->'entityTypes' ? n.entity_type)
 AND (COALESCE(s.request->'filters'->'labels','[]')='[]' OR EXISTS
      (SELECT 1 FROM unnest(n.labels) l WHERE s.request->'filters'->'labels' ? l))
 AND (COALESCE(s.request->'filters'->'statuses','[]')='[]' OR s.request->'filters'->'statuses' ? (n.properties->>'status'))
 AND (n.entity_type<>'TASK' OR COALESCE(s.request->'filters'->'taskTypes','[]')='[]' OR s.request->'filters'->'taskTypes' ? (n.properties->>'type'))
 AND (n.entity_type<>'TASK' OR COALESCE(s.request->'filters'->'tags','[]')='[]' OR s.request->'filters'->'tags' ? (n.properties->>'tag'))
 AND (s.request->'filters'->'dateRange'->>'from' IS NULL OR n.created_at >= (s.request->'filters'->'dateRange'->>'from')::timestamptz)
 AND (s.request->'filters'->'dateRange'->>'to' IS NULL OR n.created_at <= (s.request->'filters'->'dateRange'->>'to')::timestamptz)
 AND (s.request->'filters'->'updatedAtRange'->>'from' IS NULL OR n.updated_at >= (s.request->'filters'->'updatedAtRange'->>'from')::timestamptz)
 AND (s.request->'filters'->'updatedAtRange'->>'to' IS NULL OR n.updated_at <= (s.request->'filters'->'updatedAtRange'->>'to')::timestamptz)) AS endpoint_eligible
 FROM graph.node n CROSS JOIN settings s
 WHERE n.organization_id=s.org AND n.project_id=s.project
),
walk AS (
 SELECT b.branch,b.max_depth,b.chain,n.id AS seed,n.id,n.entity_type,n.stub,n.endpoint_eligible,0 AS depth,
        ARRAY[n.id] AS node_ids,ARRAY[]::text[] AS edge_ids,ARRAY[]::text[] AS restricted,
        0.0::double precision AS weight
 FROM settings s JOIN nodes n ON n.organization_id=s.org AND n.project_id=s.project AND n.id=ANY(s.seeds)
 CROSS JOIN branches b
 WHERE n.project_scoped AND NOT n.deleted
 AND (b.seed_types='[]' OR b.seed_types ? n.entity_type)
 AND NOT (n.entity_type='TASK' AND COALESCE(s.request->'filters'->'excludeTaskTypes' ? (n.properties->>'type'),false))
 AND NOT (n.entity_type='REPORT' AND COALESCE(s.request->'filters'->'excludeReportTypes' ? (n.properties->>'reportType'),false))
 UNION ALL
 SELECT w.branch,w.max_depth,w.chain,w.seed,n.id,n.entity_type,n.stub,n.endpoint_eligible,w.depth+1,
        w.node_ids||n.id,w.edge_ids||e.id,
        CASE WHEN w.depth>0 AND (w.stub OR w.entity_type='PROJECT') AND NOT w.id=ANY(s.seeds)
             THEN w.restricted||w.id ELSE w.restricted END,
        w.weight+COALESCE((s.request->'_weights'->>e.relationship_type)::real::double precision,1.0)
 FROM walk w CROSS JOIN settings s
 CROSS JOIN LATERAL (
   SELECT edge.* FROM graph.edge edge
   WHERE edge.organization_id=s.org AND edge.project_id=s.project AND edge.source_id=w.id
     AND (CASE WHEN w.chain IS NULL THEN COALESCE(s.request->'traversal'->>'direction','BOTH') ELSE COALESCE(w.chain->w.depth->>'direction','BOTH') END)<>'INCOMING'
   UNION ALL
   SELECT edge.* FROM graph.edge edge
   WHERE edge.organization_id=s.org AND edge.project_id=s.project AND edge.target_id=w.id AND edge.source_id<>w.id
     AND (CASE WHEN w.chain IS NULL THEN COALESCE(s.request->'traversal'->>'direction','BOTH') ELSE COALESCE(w.chain->w.depth->>'direction','BOTH') END)<>'OUTGOING'
 ) e
 JOIN nodes n ON n.organization_id=s.org AND n.project_id=s.project
   AND n.id=CASE WHEN e.source_id=w.id THEN e.target_id ELSE e.source_id END
 WHERE w.depth<w.max_depth AND (w.depth=0 OR w.entity_type<>'USER') AND NOT n.deleted
 AND NOT e.id=ANY(w.edge_ids)
 AND (w.chain IS NOT NULL AND e.relationship_type=w.chain->w.depth->>'type'
      OR w.chain IS NULL
         AND (COALESCE(s.request->'traversal'->'relationshipTypes','[]')='[]'
              OR s.request->'traversal'->'relationshipTypes' ? e.relationship_type)
         AND NOT COALESCE(s.request->'traversal'->'excludeRelationshipTypes','[]') ? e.relationship_type)
 AND NOT (n.entity_type='TASK' AND COALESCE(s.request->'filters'->'excludeTaskTypes' ? (n.properties->>'type'),false))
 AND NOT (n.entity_type='REPORT' AND COALESCE(s.request->'filters'->'excludeReportTypes' ? (n.properties->>'reportType'),false))
),
valid AS (
 SELECT DISTINCT w.seed,w.id,w.entity_type,w.depth,w.node_ids,w.edge_ids,
        CASE WHEN w.depth=0 THEN 0.0 ELSE w.weight/w.depth END AS mean_weight
 FROM walk w CROSS JOIN settings s
 WHERE (w.chain IS NULL OR w.depth=w.max_depth)
 AND (w.depth>0 OR COALESCE((s.request->>'includeSeedEntities')::boolean,false))
 AND (COALESCE((s.request->>'includeSeedEntities')::boolean,false) OR NOT w.id=ANY(s.seeds))
 AND (s.request->'_canonicalTypes' IS NULL OR s.request->'_canonicalTypes' ? w.entity_type)
 AND w.endpoint_eligible
 AND NOT EXISTS (SELECT 1 FROM unnest(w.restricted) r WHERE r<>w.id)
),
summary AS (
 SELECT seed,id,entity_type,depth,max(mean_weight) AS weight,count(*) AS count
 FROM valid CROSS JOIN settings s
 WHERE COALESCE(s.request->>'projection','')<>'IDENTITIES_BY_SEED'
 GROUP BY seed,id,entity_type,depth
),
representative AS (
 SELECT DISTINCT ON (seed,id,depth) seed,id,depth,node_ids,edge_ids
 FROM valid CROSS JOIN settings s
 WHERE COALESCE(s.request->>'projection','') NOT IN ('IDENTITIES_BY_SEED','COMPACT_RANKED')
 ORDER BY seed,id,depth,mean_weight DESC,node_ids
),
evidence AS (
 SELECT seed,id,depth,jsonb_agg(DISTINCT edge_ids) AS edges
 FROM valid CROSS JOIN settings s
 WHERE COALESCE(s.request->>'projection','') NOT IN ('IDENTITIES_BY_SEED','COMPACT_RANKED')
   AND (s.request->'includeRelationships'='true' OR s.request->'_neighborhood'='true')
 GROUP BY seed,id,depth
)
SELECT jsonb_build_object('seed',v.seed,'id',v.id,'entity_type',v.entity_type,'depth',v.depth,'weight',v.weight,'count',v.count,
                         'nodes',COALESCE(to_jsonb(r.node_ids),'[]'), 'edges',COALESCE(to_jsonb(r.edge_ids),'[]'),
                         'evidence',COALESCE(e.edges,CASE WHEN r.edge_ids IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(r.edge_ids) END))::text AS "data!"
FROM summary v LEFT JOIN representative r USING (seed,id,depth) LEFT JOIN evidence e USING (seed,id,depth)

UNION ALL
SELECT DISTINCT jsonb_build_object('seed',v.seed,'id',v.id,'entity_type',v.entity_type,'depth',0,'weight',0,'count',0,
                                  'nodes','[]'::jsonb,'edges','[]'::jsonb,'evidence','[]'::jsonb)::text
FROM valid v CROSS JOIN settings s WHERE s.request->>'projection'='IDENTITIES_BY_SEED'
