use super::{
    generated::*,
    native,
    routes::{Failure, invalid},
    store::Scope,
    validation,
};
use axum::{Extension, Json, extract::Path, http::StatusCode};
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};

async fn load(tx: &mut Transaction<'_, Postgres>, s: &Scope, id: &str) -> Result<Value, Failure> {
    let value: Option<Value> = sqlx::query_scalar("SELECT properties || jsonb_build_object('id',id,'projectId',project_id,'createdAt',created_at,'updatedAt',updated_at) FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND entity_type='HINT' FOR UPDATE")
        .bind(&s.organization).bind(&s.project).bind(id).fetch_optional(&mut **tx).await.map_err(anyhow::Error::from)?;
    let mut value = value.ok_or_else(native::missing)?;
    let connections: Vec<Value> = sqlx::query_scalar("SELECT properties || jsonb_build_object('id',id,'targetNodeId',target_id,'createdAt',created_at,'updatedAt',updated_at) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND source_id=$3 AND relationship_type='CONNECTED_TO' ORDER BY created_at,id")
        .bind(&s.organization).bind(&s.project).bind(id).fetch_all(&mut **tx).await.map_err(anyhow::Error::from)?;
    value["connections"] = json!(connections);
    Ok(value)
}
fn live(h: &Value) -> Result<(), Failure> {
    if !h["retiredAt"].is_null() {
        return Err(native::conflict("Hint is retired"));
    }
    Ok(())
}
async fn connect(
    tx: &mut Transaction<'_, Postgres>,
    s: &Scope,
    id: &str,
    input: HintConnectionInput,
) -> Result<(), Failure> {
    if id == input.target_node_id {
        return Err(invalid("A hint cannot connect to itself"));
    }
    native::endpoint(tx, s, &input.target_node_id, &input.target_entity_type).await?;
    let exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND source_id=$3 AND target_id=$4 AND relationship_type='CONNECTED_TO')").bind(&s.organization).bind(&s.project).bind(id).bind(&input.target_node_id).fetch_one(&mut **tx).await.map_err(anyhow::Error::from)?;
    if exists {
        return Err(native::conflict("Hint already connected to this item"));
    }
    sqlx::query("INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type,properties) VALUES ($1,$2,$3,$4,'CONNECTED_TO',$5)").bind(&s.organization).bind(&s.project).bind(id).bind(&input.target_node_id).bind(json!({"targetEntityType":input.target_entity_type,"strength":input.strength})).execute(&mut **tx).await.map_err(anyhow::Error::from)?;
    Ok(())
}
async fn touch(tx: &mut Transaction<'_, Postgres>, s: &Scope, id: &str) -> Result<(), Failure> {
    sqlx::query("UPDATE graph.node SET updated_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND id=$3").bind(&s.organization).bind(&s.project).bind(id).execute(&mut **tx).await.map_err(anyhow::Error::from)?;
    Ok(())
}
pub async fn create(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<(StatusCode, Json<Value>), Failure> {
    let request: CreateHintDto = validation::decode("CreateHintDto", value).map_err(invalid)?;
    native::text(&request.text)?;
    let mut targets = std::collections::HashSet::new();
    if request
        .connections
        .iter()
        .any(|c| !targets.insert(&c.target_node_id))
    {
        return Err(invalid("Duplicate connection target"));
    }
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    let id = native::uuid(&mut tx).await?;
    sqlx::query("INSERT INTO graph.node (organization_id,project_id,id,entity_type,labels,properties,created_at,updated_at) VALUES ($1,$2,$3,'HINT',ARRAY['Hint'],$4,now(),now())").bind(&s.organization).bind(&s.project).bind(&id).bind(json!({"text":request.text,"origin":request.origin})).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    for connection in request.connections {
        connect(&mut tx, &s, &id, connection).await?;
    }
    let result = load(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok((StatusCode::CREATED, Json(result)))
}
pub async fn list(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<Value>, Failure> {
    find(&pool, super::routes::scope(org, project)?, None).await
}
pub async fn query(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: FindHintsByConnectedItemsRequest =
        validation::decode("FindHintsByConnectedItemsRequest", value).map_err(invalid)?;
    find(
        &pool,
        super::routes::scope(org, project)?,
        Some(request.node_ids),
    )
    .await
}
async fn find(pool: &PgPool, s: Scope, ids: Option<Vec<String>>) -> Result<Json<Value>, Failure> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    let keys: Vec<String> = sqlx::query_scalar("SELECT id FROM graph.node n WHERE organization_id=$1 AND project_id=$2 AND entity_type='HINT' AND properties->>'retiredAt' IS NULL AND ($3::text[] IS NULL OR EXISTS(SELECT 1 FROM graph.edge e WHERE e.organization_id=n.organization_id AND e.project_id=n.project_id AND e.source_id=n.id AND e.relationship_type='CONNECTED_TO' AND e.target_id=ANY($3))) ORDER BY created_at DESC,id")
        .bind(&s.organization).bind(&s.project).bind(ids).fetch_all(&mut *tx).await.map_err(anyhow::Error::from)?;
    let mut hints = Vec::new();
    for id in keys {
        hints.push(load(&mut tx, &s, &id).await?);
    }
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(json!({"hints":hints})))
}
pub async fn get(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
) -> Result<Json<Value>, Failure> {
    let s = super::routes::scope(org, project)?;
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    let result = load(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(result))
}
pub async fn update(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: UpdateHintTextDto =
        validation::decode("UpdateHintTextDto", value).map_err(invalid)?;
    native::text(&request.text)?;
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    live(&load(&mut tx, &s, &id).await?)?;
    sqlx::query("UPDATE graph.node SET properties=jsonb_set(properties,'{text}',$4),updated_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND id=$3").bind(&s.organization).bind(&s.project).bind(&id).bind(json!(request.text)).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    let result = load(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(result))
}
async fn retire_inner(
    tx: &mut Transaction<'_, Postgres>,
    s: &Scope,
    id: &str,
) -> Result<(), Failure> {
    sqlx::query("DELETE FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND source_id=$3 AND relationship_type='CONNECTED_TO'").bind(&s.organization).bind(&s.project).bind(id).execute(&mut **tx).await.map_err(anyhow::Error::from)?;
    sqlx::query("UPDATE graph.node SET properties=properties || jsonb_build_object('retiredAt',clock_timestamp()),updated_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND properties->>'retiredAt' IS NULL").bind(&s.organization).bind(&s.project).bind(id).execute(&mut **tx).await.map_err(anyhow::Error::from)?;
    Ok(())
}
pub async fn retire(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
) -> Result<StatusCode, Failure> {
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    load(&mut tx, &s, &id).await?;
    retire_inner(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(StatusCode::NO_CONTENT)
}
pub async fn add(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
    Json(value): Json<Value>,
) -> Result<(StatusCode, Json<Value>), Failure> {
    let request = validation::decode("HintConnectionInput", value).map_err(invalid)?;
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    live(&load(&mut tx, &s, &id).await?)?;
    connect(&mut tx, &s, &id, request).await?;
    touch(&mut tx, &s, &id).await?;
    let result = load(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok((StatusCode::CREATED, Json(result)))
}
pub async fn strength(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id, connection)): Path<(String, String, String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: SetHintConnectionStrengthDto =
        validation::decode("SetHintConnectionStrengthDto", value).map_err(invalid)?;
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    live(&load(&mut tx, &s, &id).await?)?;
    let changed = sqlx::query("UPDATE graph.edge SET properties=jsonb_set(properties,'{strength}',$5),updated_at=clock_timestamp() WHERE organization_id=$1 AND project_id=$2 AND source_id=$3 AND id=$4 AND relationship_type='CONNECTED_TO'").bind(&s.organization).bind(&s.project).bind(&id).bind(&connection).bind(json!(request.strength)).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    if changed.rows_affected() == 0 {
        return Err(native::missing());
    }
    touch(&mut tx, &s, &id).await?;
    let result = load(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(result))
}
pub async fn remove(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id, connection)): Path<(String, String, String, String)>,
) -> Result<Json<Value>, Failure> {
    let s = super::routes::scope(org, project)?;
    let mut tx = native::begin(&pool, &s).await?;
    live(&load(&mut tx, &s, &id).await?)?;
    let changed = sqlx::query("DELETE FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND source_id=$3 AND id=$4 AND relationship_type='CONNECTED_TO'").bind(&s.organization).bind(&s.project).bind(&id).bind(&connection).execute(&mut *tx).await.map_err(anyhow::Error::from)?;
    if changed.rows_affected() == 0 {
        return Err(native::missing());
    }
    touch(&mut tx, &s, &id).await?;
    let hint = load(&mut tx, &s, &id).await?;
    let retired = hint["connections"]
        .as_array()
        .expect("connections")
        .is_empty();
    if retired {
        retire_inner(&mut tx, &s, &id).await?;
    }
    let hint = load(&mut tx, &s, &id).await?;
    tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(Json(json!({"hint":hint,"hintRetired":retired})))
}
