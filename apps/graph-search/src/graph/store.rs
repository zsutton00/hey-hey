use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgPool;

#[derive(Clone, Debug)]
pub struct Scope {
    pub organization: String,
    pub project: String,
}

/// The projection owned by the graph store; event consumers use the same key.
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Node {
    pub id: String,
    pub entity_type: String,
    pub project_scoped: bool,
    pub labels: Vec<String>,
    pub properties: Value,
    pub stub: bool,
    pub deleted: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}
impl Node {
    pub fn wire(&self, scope: &Scope) -> Value {
        let mut properties = self.properties.clone();
        if properties.get("type").and_then(Value::as_str) == Some(&self.entity_type) {
            properties
                .as_object_mut()
                .expect("stored properties object")
                .remove("type");
        }
        json!({"id":self.id,"type":self.entity_type,"labels":self.labels,"properties":properties,
            "organizationId":scope.organization,"projectId":scope.project,
            "createdAt":self.created_at,"updatedAt":self.updated_at})
    }
    pub fn identity(&self) -> Value {
        json!({"entityId":self.id,"entityType":self.entity_type})
    }
    pub fn display(&self, incident: bool) -> Value {
        let first = if incident { "name" } else { "title" };
        let second = if incident { "title" } else { "name" };
        let name = self
            .properties
            .get(first)
            .or_else(|| self.properties.get(second))
            .and_then(Value::as_str)
            .unwrap_or("(unnamed)");
        let mut value =
            json!({"entityId":self.id,"entityType":self.entity_type,"displayName":name});
        if self.entity_type == "TASK" {
            let subtype = if incident {
                self.properties
                    .get("taskType")
                    .or_else(|| self.properties.get("type"))
            } else {
                self.properties.get("type")
            };
            if let Some(kind) = subtype {
                value["taskType"] = kind.clone();
            }
        }
        if !incident && let Some(status) = self.properties.get("status") {
            value["status"] = status.clone();
        }
        value
    }
}
#[derive(Clone, Debug, Deserialize)]
pub struct Edge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub relationship_type: String,
    pub properties: Value,
    pub created_at: String,
    pub updated_at: String,
}
impl Edge {
    pub fn wire(&self) -> Value {
        let category = self.properties.get("category").cloned().unwrap_or_else(|| {
            json!(if matches!(
                self.relationship_type.as_str(),
                "STANDARD" | "CONDITIONAL" | "LOOP"
            ) {
                "flow"
            } else {
                "meta"
            })
        });
        let mut result = json!({"id":self.id,"sourceNodeId":self.source_id,"targetNodeId":self.target_id,
            "type":self.relationship_type,"properties":self.properties,"category":category,
            "createdAt":self.created_at,"updatedAt":self.updated_at});
        if let Some(direction) = self.properties.get("direction") {
            result["direction"] = direction.clone();
        }
        result
    }
    pub fn agent_wire(&self, source: &Node, target: &Node, display: bool) -> Value {
        let mut value = json!({"id":self.id,"sourceNodeId":self.source_id,"targetNodeId":self.target_id,
            "sourceEntityType":source.entity_type,"targetEntityType":target.entity_type,
            "type":self.relationship_type,"category":self.wire()["category"],
            "createdAt":self.created_at,"updatedAt":self.updated_at});
        for key in [
            "reasoning",
            "direction",
            "predicate",
            "actionLabel",
            "metadata",
            "createdBySessionId",
            "lastModifiedBySessionId",
        ] {
            if let Some(item) = self.properties.get(key) {
                value[key] = item.clone();
            }
        }
        if display {
            for (key, node) in [("sourceNodeName", source), ("targetNodeName", target)] {
                if let Some(name) = node
                    .properties
                    .get("name")
                    .or_else(|| node.properties.get("title"))
                    .or_else(|| node.properties.get("label"))
                {
                    value[key] = name.clone();
                }
            }
            if let Some(kind) = target.properties.get("type") {
                value["targetNodeType"] = kind.clone();
            }
        }
        value
    }
}
#[derive(Clone, Debug, Deserialize)]
pub struct Candidate {
    pub entity_type: String,
    pub seed: String,
    pub id: String,
    pub depth: i32,
    pub weight: f64,
    pub count: i64,
    pub nodes: Vec<String>,
    pub edges: Vec<String>,
    pub evidence: Vec<Vec<String>>,
}

pub async fn upsert_node(pool: &PgPool, scope: &Scope, node: &Node) -> anyhow::Result<()> {
    let properties = serde_json::to_string(&node.properties)?;
    sqlx::query!(r#"INSERT INTO graph.node
      (organization_id,project_id,id,entity_type,labels,properties,stub,deleted,created_at,updated_at,project_scoped)
      VALUES ($1,$2,$3,$4,$5,$6::text::jsonb,$7,$8,$9::text::timestamptz,$10::text::timestamptz,$11)
      ON CONFLICT (organization_id,project_id,id) DO UPDATE SET entity_type=EXCLUDED.entity_type,
      labels=EXCLUDED.labels,properties=EXCLUDED.properties,stub=EXCLUDED.stub,deleted=EXCLUDED.deleted,
      created_at=EXCLUDED.created_at,updated_at=EXCLUDED.updated_at,project_scoped=EXCLUDED.project_scoped"#,
      scope.organization,scope.project,node.id,node.entity_type,&node.labels,&properties,node.stub,node.deleted,
      node.created_at,node.updated_at,node.project_scoped).execute(pool).await?;
    Ok(())
}
pub async fn delete_node(pool: &PgPool, scope: &Scope, id: &str) -> anyhow::Result<()> {
    sqlx::query!(
        "DELETE FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=$3",
        scope.organization,
        scope.project,
        id
    )
    .execute(pool)
    .await?;
    Ok(())
}
pub async fn nodes(pool: &PgPool, scope: &Scope, ids: &[String]) -> anyhow::Result<Vec<Node>> {
    let rows = sqlx::query!(
        r#"SELECT (to_jsonb(n)-'organization_id'-'project_id')::text AS "data!"
        FROM graph.node n WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)"#,
        scope.organization,
        scope.project,
        ids
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|r| Ok(serde_json::from_str(&r.data)?))
        .collect()
}
pub async fn edges(pool: &PgPool, scope: &Scope, ids: &[String]) -> anyhow::Result<Vec<Edge>> {
    let rows = sqlx::query!(
        r#"SELECT to_jsonb(e)::text AS "data!" FROM graph.edge e
        WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)"#,
        scope.organization,
        scope.project,
        ids
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|r| Ok(serde_json::from_str(&r.data)?))
        .collect()
}
pub async fn walk(
    pool: &PgPool,
    scope: &Scope,
    seeds: &[String],
    request: &Value,
) -> anyhow::Result<Vec<Candidate>> {
    let rows = sqlx::query_file!(
        "src/graph/sql/walk.sql",
        scope.organization,
        scope.project,
        seeds,
        request
    )
    .fetch_all(pool)
    .await?;
    rows.into_iter()
        .map(|r| Ok(serde_json::from_str(&r.data)?))
        .collect()
}
pub async fn incident(
    pool: &PgPool,
    scope: &Scope,
    seeds: &[String],
    types: &[String],
) -> anyhow::Result<Vec<Edge>> {
    let rows=sqlx::query!(r#"SELECT DISTINCT to_jsonb(e)::text AS "data!"
      FROM unnest($3::text[]) seed
      JOIN graph.node a ON a.organization_id=$1 AND a.project_id=$2 AND a.id=seed AND a.project_scoped AND NOT a.deleted
      CROSS JOIN LATERAL (
        SELECT * FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND source_id=a.id AND relationship_type=ANY($4)
        UNION
        SELECT * FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND target_id=a.id AND relationship_type=ANY($4)
      ) e
      JOIN graph.node b ON b.organization_id=$1 AND b.project_id=$2
        AND b.id=CASE WHEN e.source_id=a.id THEN e.target_id ELSE e.source_id END
      WHERE b.project_scoped AND NOT b.deleted AND NOT b.stub AND b.created_at IS NOT NULL AND b.updated_at IS NOT NULL"#,
      scope.organization,scope.project,seeds,types).fetch_all(pool).await?;
    rows.into_iter()
        .map(|r| Ok(serde_json::from_str(&r.data)?))
        .collect()
}
pub async fn structured(
    pool: &PgPool,
    scope: &Scope,
    request: &super::generated::StructuredGraphReadRequest,
) -> anyhow::Result<Value> {
    let seed_ids: Vec<_> = request.seeds.iter().map(|s| s.entity_id.clone()).collect();
    let resolved = nodes(pool, scope, &seed_ids).await?;
    let valid: Vec<_> = resolved
        .iter()
        .filter(|n| {
            n.project_scoped
                && !n.deleted
                && !n.stub
                && n.properties.get("archivedAt").is_none_or(Value::is_null)
                && n.properties.get("status").and_then(Value::as_str) != Some("ARCHIVED")
                && request
                    .seeds
                    .iter()
                    .any(|s| s.entity_id == n.id && s.entity_type == n.entity_type)
        })
        .map(|n| n.id.clone())
        .collect();
    let rows=sqlx::query!(r#"SELECT DISTINCT to_jsonb(e)::text AS "data!" FROM unnest($3::text[]) seed
       CROSS JOIN LATERAL (
         SELECT * FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND source_id=seed AND relationship_type=ANY($4)
         UNION SELECT * FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND target_id=seed AND relationship_type=ANY($4)
       ) e"#,scope.organization,scope.project,&valid,&request.direct_edge_types).fetch_all(pool).await?;
    let direct: Result<Vec<Edge>, _> = rows
        .into_iter()
        .map(|r| serde_json::from_str(&r.data))
        .collect();
    let direct = agent_wire(pool, scope, &direct?, true).await?;
    let mut expansions = Vec::new();
    for expansion in &request.expansions {
        let data = serde_json::to_value(expansion)?;
        let rows = sqlx::query_file!(
            "src/graph/sql/structured.sql",
            scope.organization,
            scope.project,
            data,
            request.root.entity_id,
            request.root.entity_type
        )
        .fetch_all(pool)
        .await?;
        let targets: Result<Vec<Value>, _> = rows
            .into_iter()
            .map(|r| serde_json::from_str(&r.data))
            .collect();
        expansions.push(json!({"key":expansion.key,"targets":targets?}));
    }
    Ok(json!({"structuredRead":{"directEdges":direct,"expansions":expansions}}))
}
pub async fn feature_connections(
    pool: &PgPool,
    scope: &Scope,
    ids: &[String],
) -> anyhow::Result<i64> {
    let row=sqlx::query!(r#"SELECT count(DISTINCT f.id) AS "count!" FROM graph.node f
      JOIN graph.edge e ON e.organization_id=$1 AND e.project_id=$2 AND e.source_id=f.id
        AND e.relationship_type='SCOPED_TO_PROJECT' AND e.target_id=$2
      JOIN graph.node p ON p.organization_id=$1 AND p.project_id=$2 AND p.id=$2
      WHERE f.organization_id=$1 AND f.project_id=$2 AND f.id=ANY($3)
        AND f.entity_type='TASK' AND f.properties->>'type'='FEATURE' AND NOT f.stub AND NOT f.deleted
        AND p.entity_type='PROJECT' AND NOT p.stub AND NOT p.deleted"#,
      scope.organization,scope.project,ids).fetch_one(pool).await?;
    Ok(row.count)
}
pub async fn provenance(
    pool: &PgPool,
    scope: &Scope,
    id: &str,
    depth: i32,
) -> anyhow::Result<Value> {
    let rows = sqlx::query!(
        r#"WITH RECURSIVE walk AS (
      SELECT n.id,0 AS depth,ARRAY[]::text[] AS edges,n.entity_type
      FROM graph.node n WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND project_scoped AND NOT deleted
      UNION ALL
      SELECT n.id,w.depth+1,w.edges||e.id,n.entity_type
      FROM walk w JOIN graph.edge e ON e.organization_id=$1 AND e.project_id=$2 AND e.source_id=w.id
      JOIN graph.node n ON n.organization_id=$1 AND n.project_id=$2 AND n.id=e.target_id
      WHERE w.depth<$4 AND NOT e.id=ANY(w.edges) AND NOT n.deleted
        AND (w.depth=0 OR w.entity_type<>'USER')
        AND e.relationship_type IN ('CREATED_VIA','DERIVES_FROM','INFLUENCES')
    ), selected AS (
      SELECT edges[depth] AS id,min(depth) AS depth FROM walk WHERE depth>0 GROUP BY edges[depth]
      ORDER BY min(depth),edges[depth] LIMIT 500
    ) SELECT jsonb_build_object('sourceNodeId',e.source_id,'targetNodeId',e.target_id,
        'sourceNodeType',a.labels[1],'targetNodeType',b.labels[1],'type',e.relationship_type,
        'depth',s.depth,'createdAt',e.created_at)||
        (e.properties-'source'-'id'-'organizationId'-'projectId') AS "data!"
    FROM selected s JOIN graph.edge e ON e.organization_id=$1 AND e.project_id=$2 AND e.id=s.id
    JOIN graph.node a ON a.organization_id=$1 AND a.project_id=$2 AND a.id=e.source_id
    JOIN graph.node b ON b.organization_id=$1 AND b.project_id=$2 AND b.id=e.target_id"#,
        scope.organization,
        scope.project,
        id,
        depth
    )
    .fetch_all(pool)
    .await?;
    let edges: Vec<_> = rows.into_iter().map(|r| r.data).collect();
    let actual = edges
        .iter()
        .filter_map(|e| e["depth"].as_i64())
        .max()
        .unwrap_or(0);
    Ok(json!({"entityId":id,"edges":edges,"depth":actual}))
}
pub async fn topology(pool: &PgPool, scope: &Scope) -> anyhow::Result<Value> {
    let rows=sqlx::query!(r#"SELECT c.id AS category_id,c.properties->>'name' AS category_name,
       f.id AS facet_id,f.properties->>'name' AS facet_name,
       COALESCE(jsonb_agg(DISTINCT to_jsonb(n)) FILTER (WHERE n.id IS NOT NULL),'[]') AS "nodes!"
      FROM graph.node c
      JOIN graph.edge cf ON cf.organization_id=$1 AND cf.project_id=$2 AND cf.source_id=c.id AND cf.relationship_type='HAS_FACET'
      JOIN graph.node f ON f.organization_id=$1 AND f.project_id=$2 AND f.id=cf.target_id AND f.entity_type='FACET' AND NOT f.deleted
      LEFT JOIN graph.edge fe ON fe.organization_id=$1 AND fe.project_id=$2 AND fe.source_id=f.id AND fe.relationship_type='HAS_KB_ENTRY'
      LEFT JOIN graph.node n ON n.organization_id=$1 AND n.project_id=$2 AND n.id=fe.target_id AND n.project_scoped AND NOT n.deleted AND n.created_at IS NOT NULL AND n.updated_at IS NOT NULL
      WHERE c.organization_id=$1 AND c.project_id=$2 AND c.entity_type='CATEGORY' AND NOT c.deleted
      GROUP BY c.id,c.properties->>'name',f.id,f.properties->>'name'
      ORDER BY c.properties->>'name',f.properties->>'name'"#,scope.organization,scope.project).fetch_all(pool).await?;
    let mut categories: Vec<Value> = Vec::new();
    for row in rows {
        let nodes: Vec<Node> = serde_json::from_value(row.nodes)?;
        let facet = json!({"id":row.facet_id,"name":row.facet_name,"entities":nodes.iter().map(|n|n.wire(scope)).collect::<Vec<_>>()});
        if let Some(category) = categories.iter_mut().find(|c| c["id"] == row.category_id) {
            category["subfacets"]
                .as_array_mut()
                .expect("category subfacets")
                .push(facet);
        } else {
            categories
                .push(json!({"id":row.category_id,"name":row.category_name,"subfacets":[facet]}));
        }
    }
    let rows = sqlx::query!(
        r#"SELECT to_jsonb(e)::text AS "data!" FROM graph.edge e
      WHERE organization_id=$1 AND project_id=$2 AND relationship_type IN ('RELATED_TO','DEPENDS_ON','DERIVES_FROM','SUPERSEDES','CONTRADICTS','EVOLVES','TRACKS','FULFILLED_BY','STANDARD','CONDITIONAL','LOOP','GUARANTEES','IMPLEMENTS','CONSUMES') ORDER BY created_at DESC,id LIMIT 500"#,
        scope.organization,
        scope.project
    )
    .fetch_all(pool)
    .await?;
    let edges: Result<Vec<Edge>, _> = rows
        .into_iter()
        .map(|r| serde_json::from_str(&r.data))
        .collect();
    Ok(json!({"categories":categories,"agentEdges":agent_wire(pool,scope,&edges?,false).await?}))
}

async fn agent_wire(
    pool: &PgPool,
    scope: &Scope,
    edges: &[Edge],
    display: bool,
) -> anyhow::Result<Vec<Value>> {
    let ids: Vec<_> = edges
        .iter()
        .flat_map(|e| [e.source_id.clone(), e.target_id.clone()])
        .collect();
    let endpoints: std::collections::BTreeMap<_, _> = nodes(pool, scope, &ids)
        .await?
        .into_iter()
        .map(|n| (n.id.clone(), n))
        .collect();
    edges
        .iter()
        .map(|e| {
            let source = endpoints
                .get(&e.source_id)
                .ok_or_else(|| anyhow::anyhow!("Graph source disappeared"))?;
            let target = endpoints
                .get(&e.target_id)
                .ok_or_else(|| anyhow::anyhow!("Graph target disappeared"))?;
            Ok(e.agent_wire(source, target, display))
        })
        .collect()
}
