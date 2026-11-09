use super::{
    generated::*,
    native,
    routes::{Failure, invalid},
    store::{self, Scope},
    validation,
};
use axum::{
    Extension, Json,
    extract::{Path, Query},
    http::StatusCode,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

// Authored semantic labels are generated from the wire contract; source is independent.
const LABELS: &[&str] = AGENT_EDGE_TYPES;
async fn read(
    tx: &mut Transaction<'_, Postgres>,
    s: &Scope,
    id: &str,
) -> Result<Option<Value>, Failure> {
    let edge: Option<Value> = sqlx::query_scalar("SELECT to_jsonb(e) FROM graph.edge e WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND relationship_type=ANY($4)").bind(&s.organization).bind(&s.project).bind(id).bind(LABELS).fetch_optional(&mut **tx).await.map_err(anyhow::Error::from)?;
    let Some(edge) = edge else {
        return Ok(None);
    };
    let edge: store::Edge = serde_json::from_value(edge).map_err(anyhow::Error::from)?;
    let nodes: Vec<Value> = sqlx::query_scalar("SELECT to_jsonb(n) FROM graph.node n WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)").bind(&s.organization).bind(&s.project).bind(vec![&edge.source_id,&edge.target_id]).fetch_all(&mut **tx).await.map_err(anyhow::Error::from)?;
    let nodes: Vec<store::Node> = nodes
        .into_iter()
        .map(serde_json::from_value)
        .collect::<Result<_, _>>()
        .map_err(anyhow::Error::from)?;
    let source = nodes
        .iter()
        .find(|n| n.id == edge.source_id)
        .ok_or_else(native::missing)?;
    let target = nodes
        .iter()
        .find(|n| n.id == edge.target_id)
        .ok_or_else(native::missing)?;
    Ok(Some(edge.agent_wire(source, target, true)))
}
fn semantics(value: &Value) -> Value {
    let mut v = value.clone();
    for key in [
        "id",
        "createdAt",
        "updatedAt",
        "sourceNodeName",
        "targetNodeName",
        "targetNodeType",
        "lastModifiedBySessionId",
    ] {
        v.as_object_mut().expect("edge object").remove(key);
    }
    native::object_without_nulls(&mut v);
    v
}
async fn validate(
    tx: &mut Transaction<'_, Postgres>,
    s: &Scope,
    v: &mut Value,
) -> Result<(), Failure> {
    let kind = v["type"].as_str().unwrap_or_default();
    if !LABELS.contains(&kind) {
        return Err(invalid("Type is not agent-authorable"));
    }
    let flow = matches!(kind, "STANDARD" | "CONDITIONAL" | "LOOP");
    let category = if flow { "flow" } else { "meta" };
    if !v["category"].is_null() && v["category"] != category {
        return Err(invalid("Category does not match type"));
    }
    v["category"] = json!(category);
    let kind = v["type"].as_str().expect("type");
    let direction = !v["direction"].is_null();
    let predicate = v["predicate"]
        .as_str()
        .is_some_and(|s| !s.trim().is_empty());
    if (!flow
        && (direction
            || predicate
            || !v["actionLabel"].is_null()
            || !v["transitionRole"].is_null()))
        || (matches!(kind, "STANDARD" | "CONDITIONAL") && !direction)
        || (kind == "LOOP" && direction)
        || (kind == "CONDITIONAL" && !predicate)
        || (kind == "STANDARD" && predicate)
    {
        return Err(invalid("Invalid workflow fields"));
    }
    if let Some(label) = v["actionLabel"].as_str() {
        native::text(label)?;
    }
    if !v["transitionRole"].is_null()
        && !matches!(
            v["transitionRole"].as_str(),
            Some("PRIMARY_PROGRESSION" | "ERROR_PATH" | "RECOVERY" | "RETURN")
        )
    {
        return Err(invalid("Invalid transition role"));
    }
    let participation = matches!(kind, "GUARANTEES" | "IMPLEMENTS" | "CONSUMES");
    if ((flow || participation)
        && (v["sourceEntityType"] != "TASK" || v["targetEntityType"] != "TASK"))
        || (kind == "FULFILLED_BY" && v["sourceEntityType"] != "TASK")
    {
        return Err(invalid("Invalid workflow endpoint types"));
    }
    if flow || participation {
        let rows: Vec<(String,Option<String>)> = sqlx::query_as("SELECT id,properties->>'type' FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)").bind(&s.organization).bind(&s.project).bind(vec![v["sourceNodeId"].as_str().unwrap(),v["targetNodeId"].as_str().unwrap()]).fetch_all(&mut **tx).await.map_err(anyhow::Error::from)?;
        let subtype = |id: &Value| {
            rows.iter()
                .find(|(key, _)| id == key)
                .and_then(|(_, t)| t.as_deref())
        };
        if participation
            && (subtype(&v["sourceNodeId"]) != Some("DIAGRAM_ELEMENT")
                || subtype(&v["targetNodeId"]) != Some("CONTRACT"))
        {
            return Err(invalid(
                "Contract participation requires DIAGRAM_ELEMENT to CONTRACT",
            ));
        }
        if flow && matches!(subtype(&v["sourceNodeId"]), Some("WORKFLOW" | "DIAGRAM")) {
            return Err(invalid("Flow source must be a workflow step"));
        }
    }
    Ok(())
}
async fn persist(
    tx: &mut Transaction<'_, Postgres>,
    s: &Scope,
    v: &Value,
    create: bool,
) -> Result<(), Failure> {
    for (id, kind) in [
        ("sourceNodeId", "sourceEntityType"),
        ("targetNodeId", "targetEntityType"),
    ] {
        native::endpoint(
            tx,
            s,
            v[id].as_str().expect("validated id"),
            v[kind].as_str().expect("validated type"),
        )
        .await?;
    }
    let mut properties = v.clone();
    for key in [
        "id",
        "sourceNodeId",
        "targetNodeId",
        "type",
        "createdAt",
        "updatedAt",
        "sourceNodeName",
        "targetNodeName",
        "targetNodeType",
    ] {
        properties.as_object_mut().unwrap().remove(key);
    }
    native::object_without_nulls(&mut properties);
    properties["source"] = json!(if v["type"] == "PROPOSED_TOGETHER" {
        "system"
    } else if v["createdBySessionId"].is_null() {
        "user"
    } else {
        "agent"
    });
    let sql = if create {
        "INSERT INTO graph.edge (organization_id,project_id,id,source_id,target_id,relationship_type,properties) VALUES ($1,$2,$3,$4,$5,$6,$7)"
    } else {
        "UPDATE graph.edge SET source_id=$4,target_id=$5,relationship_type=$6,properties=$7,updated_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND id=$3"
    };
    sqlx::query(sql)
        .bind(&s.organization)
        .bind(&s.project)
        .bind(v["id"].as_str())
        .bind(v["sourceNodeId"].as_str())
        .bind(v["targetNodeId"].as_str())
        .bind(v["type"].as_str())
        .bind(properties)
        .execute(&mut **tx)
        .await
        .map_err(anyhow::Error::from)?;
    Ok(())
}
async fn create_one(
    pool: &PgPool,
    s: &Scope,
    request: CreateAgentEdgeDto,
) -> Result<Value, Failure> {
    let mut value = serde_json::to_value(request).map_err(anyhow::Error::from)?;
    let mut tx = native::begin(pool, s).await?;
    if value["id"].is_null() {
        value["id"] = json!(native::uuid(&mut tx).await?);
    }
    validate(&mut tx, s, &mut value).await?;
    let id = value["id"].as_str().unwrap().to_owned();
    if let Some(existing) = read(&mut tx, s, &id).await? {
        if semantics(&existing) != semantics(&value) {
            return Err(native::conflict(
                "Relationship identity already has different semantics",
            ));
        }
        return Ok(existing);
    }
    persist(&mut tx, s, &value, true).await?;
    // A newly materialized identity starts a new lifetime, not a retry of an old deletion.
    sqlx::query("DELETE FROM graph.agent_edge_deletion WHERE organization_id=$1 AND project_id=$2 AND id=$3")
        .bind(&s.organization).bind(&s.project).bind(&id).execute(&mut *tx).await.map_err(anyhow::Error::from)?;

    let result = read(&mut tx, s, &id).await?.ok_or_else(native::missing)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(result)
}
pub async fn create(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<(StatusCode, Json<Value>), Failure> {
    let request = validation::decode("CreateAgentEdgeDto", value).map_err(invalid)?;
    Ok((
        StatusCode::CREATED,
        Json(create_one(&pool, &super::routes::scope(org, project)?, request).await?),
    ))
}
pub async fn batch(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: BatchCreateAgentEdgesRequest =
        validation::decode("BatchCreateAgentEdgesRequest", value).map_err(invalid)?;
    let s = super::routes::scope(org, project)?;
    let mut results = Vec::new();
    for (index, edge) in request.edges.into_iter().enumerate() {
        results.push(match create_one(&pool, &s, edge).await {
            Ok(edge) => json!({"index":index,"success":true,"edge":edge}),
            Err(error) => json!({"index":index,"success":false,"error":error.1}),
        });
    }
    Ok(Json(json!({"results":results})))
}
pub async fn get(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
) -> Result<Json<Value>, Failure> {
    let s = super::routes::scope(org, project)?;
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    Ok(Json(
        read(&mut tx, &s, &id).await?.ok_or_else(native::missing)?,
    ))
}
#[derive(Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filters {
    r#type: Option<String>,
    source_node_id: Option<String>,
    target_node_id: Option<String>,
    created_by_session_id: Option<String>,
    page: Option<i64>,
    size: Option<i64>,
    expected_updated_at: Option<String>,
}
pub async fn list(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Query(q): Query<Filters>,
) -> Result<Json<Value>, Failure> {
    let s = super::routes::scope(org, project)?;
    let page = q.page.unwrap_or(0);
    let size = q.size.unwrap_or(20).min(100);
    if page < 0 || size <= 0 {
        return Err(invalid("Invalid pagination"));
    }
    if q.r#type.as_deref().is_some_and(|t| !LABELS.contains(&t)) {
        return Err(invalid("Type is not agent-authorable"));
    }
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    let filter = "FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type=ANY($3) AND ($4::text IS NULL OR relationship_type=$4) AND ($5::text IS NULL OR source_id=$5) AND ($6::text IS NULL OR target_id=$6) AND ($7::text IS NULL OR properties->>'createdBySessionId'=$7)";
    let count_sql = format!("SELECT count(*) {filter}");
    let total: i64 = sqlx::query_scalar(&count_sql)
        .bind(&s.organization)
        .bind(&s.project)
        .bind(LABELS)
        .bind(&q.r#type)
        .bind(&q.source_node_id)
        .bind(&q.target_node_id)
        .bind(&q.created_by_session_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    let list_sql = format!("SELECT id {filter} ORDER BY created_at DESC,id LIMIT $8 OFFSET $9");
    let ids: Vec<String> = sqlx::query_scalar(&list_sql)
        .bind(&s.organization)
        .bind(&s.project)
        .bind(LABELS)
        .bind(&q.r#type)
        .bind(&q.source_node_id)
        .bind(&q.target_node_id)
        .bind(&q.created_by_session_id)
        .bind(size)
        .bind(page.saturating_mul(size))
        .fetch_all(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    let mut content = Vec::new();
    for id in &ids {
        if let Some(edge) = read(&mut tx, &s, id).await? {
            content.push(edge);
        }
    }
    Ok(Json(
        json!({"content":content,"page":{"number":page,"size":size,"totalElements":total,"totalPages":(total+size-1)/size}}),
    ))
}
pub async fn incident(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: FindIncidentAgentEdgesRequest =
        validation::decode("FindIncidentAgentEdgesRequest", value).map_err(invalid)?;
    let s = super::routes::scope(org, project)?;
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type=ANY($4) AND (source_id=ANY($3) OR target_id=ANY($3)) ORDER BY created_at DESC,id").bind(&s.organization).bind(&s.project).bind(&request.node_ids).bind(&request.types).fetch_all(&mut *tx).await.map_err(anyhow::Error::from)?;
    let mut result = Vec::new();
    for id in ids {
        if let Some(edge) = read(&mut tx, &s, &id).await? {
            result.push(edge);
        }
    }
    Ok(Json(json!(result)))
}
fn expected(current: Option<&Value>, q: &Filters) -> Result<(), Failure> {
    if let Some(timestamp) = &q.expected_updated_at {
        use time::{OffsetDateTime, format_description::well_known::Rfc3339};
        let wanted = OffsetDateTime::parse(timestamp, &Rfc3339)
            .map_err(|_| invalid("Invalid expectedUpdatedAt"))?;
        let actual = current
            .and_then(|v| v["updatedAt"].as_str())
            .and_then(|s| OffsetDateTime::parse(s, &Rfc3339).ok());
        if actual != Some(wanted) {
            return Err(native::conflict("Reviewed relationship has changed"));
        }
    }
    Ok(())
}
pub async fn update(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
    Query(q): Query<Filters>,
    Json(patch): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let _: UpdateAgentEdgeDto =
        validation::decode("UpdateAgentEdgeDto", patch.clone()).map_err(invalid)?;
    for (id, kind) in [
        ("sourceNodeId", "sourceEntityType"),
        ("targetNodeId", "targetEntityType"),
    ] {
        if patch.get(id).is_some() != patch.get(kind).is_some() {
            return Err(invalid("Reconnect requires ID and entity type"));
        }
    }
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    let current = read(&mut tx, &s, &id).await?;
    expected(current.as_ref(), &q)?;
    let mut value = current.ok_or_else(native::missing)?;
    if patch.get("type").is_some_and(|t| t != &value["type"]) {
        for key in ["category", "direction", "predicate"] {
            value.as_object_mut().unwrap().remove(key);
        }
        if !matches!(
            patch["type"].as_str(),
            Some("STANDARD" | "CONDITIONAL" | "LOOP")
        ) {
            let object = value.as_object_mut().unwrap();
            object.remove("actionLabel");
            object.remove("transitionRole");
        }
    }
    for (key, item) in patch.as_object().unwrap() {
        value[key] = item.clone();
    }
    validate(&mut tx, &s, &mut value).await?;
    persist(&mut tx, &s, &value, false).await?;
    let result = read(&mut tx, &s, &id).await?.ok_or_else(native::missing)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(result))
}
pub async fn delete(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
    Query(q): Query<Filters>,
) -> Result<StatusCode, Failure> {
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    let current = read(&mut tx, &s, &id).await?;
    if current.is_none() {
        // Structural edges are platform-owned: report them as not deletable here instead of a silent success.
        let owned_by_platform: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND NOT relationship_type=ANY($4))")
            .bind(&s.organization).bind(&s.project).bind(&id).bind(LABELS).fetch_one(&mut *tx).await.map_err(anyhow::Error::from)?;
        if owned_by_platform {
            return Err(native::missing());
        }
    }
    if current.is_none() && q.expected_updated_at.is_some() {
        let receipt: Option<Value> = sqlx::query_scalar("SELECT jsonb_build_object('updatedAt',deleted_basis) FROM graph.agent_edge_deletion WHERE organization_id=$1 AND project_id=$2 AND id=$3")
            .bind(&s.organization).bind(&s.project).bind(&id).fetch_optional(&mut *tx).await.map_err(anyhow::Error::from)?;
        expected(receipt.as_ref(), &q)?;
    } else {
        expected(current.as_ref(), &q)?;
    }
    // Record the actual removed version atomically, even for an unchecked delete.
    sqlx::query("WITH removed AS (DELETE FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND relationship_type=ANY($4) RETURNING updated_at) INSERT INTO graph.agent_edge_deletion (organization_id,project_id,id,deleted_basis) SELECT $1,$2,$3,updated_at FROM removed ON CONFLICT (organization_id,project_id,id) DO UPDATE SET deleted_basis=EXCLUDED.deleted_basis")
        .bind(&s.organization).bind(&s.project).bind(&id).bind(LABELS).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn delete_incident(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: DeleteIncidentAgentEdgesRequest =
        validation::decode("DeleteIncidentAgentEdgesRequest", value).map_err(invalid)?;
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    let changed=sqlx::query("DELETE FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type=ANY($4) AND properties->>'inferredBy' IS NULL AND (source_id=ANY($3) OR target_id=ANY($3))").bind(&s.organization).bind(&s.project).bind(&request.node_ids).bind(LABELS).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(json!({"deletedEdgeCount":changed.rows_affected()})))
}
