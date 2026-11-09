use super::{
    generated::*,
    routes::{Failure, invalid},
    store::Scope,
};
use axum::http::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use std::collections::BTreeMap;

pub async fn snapshot(pool: &PgPool, scope: &Scope) -> Result<TemplateGraphSnapshot, Failure> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    lock(&mut tx, scope).await?;
    let rows: Vec<(Value, String, String)> = sqlx::query_as(
        "SELECT jsonb_build_object('id',e.id,'type',e.relationship_type,'sourceNodeId',e.source_id,
        'targetNodeId',e.target_id,'properties',e.properties,'createdAt',e.created_at,'updatedAt',e.updated_at),
        s.labels[1],t.labels[1] FROM graph.edge e
        JOIN graph.node s ON (s.organization_id,s.project_id,s.id)=(e.organization_id,e.project_id,e.source_id)
        JOIN graph.node t ON (t.organization_id,t.project_id,t.id)=(e.organization_id,e.project_id,e.target_id)
        WHERE e.organization_id=$1 AND e.project_id=$2
        AND (e.relationship_type='AGENT_LINKED' OR e.properties ? 'category' OR e.properties->>'source' IN ('agent','user')) ORDER BY e.id")
        .bind(&scope.organization).bind(&scope.project).fetch_all(&mut *tx).await.map_err(anyhow::Error::from)?;
    let mut nodes = BTreeMap::new();
    let mut edges = Vec::new();
    for (value, source, target) in rows {
        let edge: GraphRelationship = serde_json::from_value(value).map_err(anyhow::Error::from)?;
        nodes.insert(edge.source_node_id.clone(), source);
        nodes.insert(edge.target_node_id.clone(), target);
        edges.push(edge);
    }
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(TemplateGraphSnapshot {
        nodes: nodes
            .into_iter()
            .map(|(id, label)| TemplateGraphNode { id, label })
            .collect(),
        edges,
    })
}
async fn lock(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    scope: &Scope,
) -> Result<(), Failure> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))")
        .bind(&scope.organization)
        .execute(&mut **tx)
        .await
        .map_err(anyhow::Error::from)?;
    let closed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM graph.projection_deletion WHERE organization_id=$1)",
    )
    .bind(&scope.organization)
    .fetch_one(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    if closed {
        return Err(Failure(
            StatusCode::GONE,
            "Organization projection is closed".into(),
        ));
    }
    Ok(())
}
pub async fn apply(
    pool: &PgPool,
    scope: &Scope,
    command: TemplateGraphCopyCommand,
) -> Result<(), Failure> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    lock(&mut tx, scope).await?;
    let value = serde_json::to_value(&command).map_err(anyhow::Error::from)?;
    let existing:Option<Value>=sqlx::query_scalar("SELECT command FROM graph.template_copy_receipt WHERE organization_id=$1 AND project_id=$2 AND id=$3")
        .bind(&scope.organization).bind(&scope.project).bind(&command.id).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?;
    if let Some(existing) = existing {
        if existing != value {
            return Err(Failure(
                StatusCode::CONFLICT,
                "Copy command identity conflicts".into(),
            ));
        }
        return Ok(());
    }
    let mut nodes = BTreeMap::new();
    let label_pattern = regex::Regex::new("^[A-Za-z][A-Za-z0-9_]*$").expect("label regex");
    for node in &command.snapshot.nodes {
        if !label_pattern.is_match(&node.label) {
            return Err(invalid("Invalid topology label"));
        }
        nodes.insert(&node.id, &node.label);
        // Labels are data, never interpolated into SQL. Existing canonical payloads survive copying.
        let entity_type = match node.label.as_str() {
            "DesignDoc" => "DESIGN_DOC".into(),
            "AgentSession" => "AGENT_SESSION".into(),
            "ImplementationHint" => "IMPLEMENTATION_HINT".into(),
            "ValidationSession" => "VALIDATION_SESSION".into(),
            other => other.to_uppercase(),
        };
        sqlx::query("INSERT INTO graph.node (organization_id,project_id,id,entity_type,labels,stub) VALUES($1,$2,$3,$4,$5,true) ON CONFLICT DO NOTHING")
            .bind(&scope.organization).bind(&scope.project).bind(&node.id).bind(entity_type).bind(vec![&node.label]).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    }
    for edge in &command.snapshot.edges {
        if !nodes.contains_key(&edge.source_node_id) || !nodes.contains_key(&edge.target_node_id) {
            return Err(invalid("Edge endpoint outside snapshot"));
        }
        let mut properties = edge.properties.clone();
        properties["id"] = json!(edge.id);
        properties["organizationId"] = json!(scope.organization);
        properties["projectId"] = json!(scope.project);
        sqlx::query("INSERT INTO graph.edge(organization_id,project_id,id,source_id,target_id,relationship_type,properties,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz) ON CONFLICT (organization_id,project_id,id) DO UPDATE SET properties=graph.edge.properties || EXCLUDED.properties")
            .bind(&scope.organization).bind(&scope.project).bind(&edge.id).bind(&edge.source_node_id).bind(&edge.target_node_id).bind(&edge.kind).bind(properties).bind(&edge.created_at).bind(&edge.updated_at).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    }
    sqlx::query("INSERT INTO graph.template_copy_receipt VALUES($1,$2,$3,$4)")
        .bind(&scope.organization)
        .bind(&scope.project)
        .bind(&command.id)
        .bind(value)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(())
}
