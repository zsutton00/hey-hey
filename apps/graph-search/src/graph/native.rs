//! Transaction helpers shared by the graph-owned write surfaces.
use super::{
    routes::{Failure, invalid},
    store::Scope,
};
use axum::http::StatusCode;
use serde_json::Value;
use sqlx::{PgPool, Postgres, Transaction};

pub fn missing() -> Failure {
    Failure(StatusCode::NOT_FOUND, "Not found in this project".into())
}
pub fn conflict(message: &str) -> Failure {
    Failure(StatusCode::CONFLICT, message.into())
}
pub async fn begin(
    pool: &PgPool,
    scope: &Scope,
) -> Result<Transaction<'static, Postgres>, Failure> {
    let mut tx = pool.begin().await.map_err(anyhow::Error::from)?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1,1))")
        .bind(&scope.organization)
        .execute(&mut *tx)
        .await
        .map_err(anyhow::Error::from)?;
    let closed: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM graph.projection_deletion WHERE organization_id=$1)",
    )
    .bind(&scope.organization)
    .fetch_one(&mut *tx)
    .await
    .map_err(anyhow::Error::from)?;
    if closed {
        return Err(conflict("Organization projection is closed"));
    }
    Ok(tx)
}

/// Serializes proposal cohort reads and pair writes within one project.
/// Keep the organization barrier from `begin` first so all graph writers use
/// the same lock order as organization closure.
pub async fn lock_project_cohort(
    tx: &mut Transaction<'_, Postgres>,
    scope: &Scope,
) -> anyhow::Result<()> {
    let lock_key = format!("{}:{}", scope.organization, scope.project);
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 2))")
        .bind(lock_key)
        .execute(&mut **tx)
        .await?;
    Ok(())
}
pub async fn uuid(tx: &mut Transaction<'_, Postgres>) -> Result<String, Failure> {
    Ok(sqlx::query_scalar("SELECT gen_random_uuid()::text")
        .fetch_one(&mut **tx)
        .await
        .map_err(anyhow::Error::from)?)
}
pub async fn endpoint(
    tx: &mut Transaction<'_, Postgres>,
    s: &Scope,
    id: &str,
    kind: &str,
) -> Result<(), Failure> {
    if kind == "HINT" {
        let live: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND entity_type='HINT' AND properties->>'retiredAt' IS NULL)").bind(&s.organization).bind(&s.project).bind(id).fetch_one(&mut **tx).await.map_err(anyhow::Error::from)?;
        if !live {
            return Err(invalid("Target hint is not live in this project"));
        }
        return Ok(());
    }
    let label = kind
        .to_lowercase()
        .split('_')
        .map(|part| format!("{}{}", part[..1].to_uppercase(), &part[1..]))
        .collect::<String>();
    sqlx::query("INSERT INTO graph.node (organization_id,project_id,id,entity_type,labels,stub) VALUES ($1,$2,$3,$4,ARRAY[$5],true) ON CONFLICT (organization_id,project_id,id) DO UPDATE SET entity_type=CASE WHEN graph.node.stub THEN EXCLUDED.entity_type ELSE graph.node.entity_type END, labels=CASE WHEN graph.node.stub THEN EXCLUDED.labels ELSE graph.node.labels END")
        .bind(&s.organization).bind(&s.project).bind(id).bind(kind).bind(label).execute(&mut **tx).await.map_err(anyhow::Error::from)?;
    let actual: String = sqlx::query_scalar(
        "SELECT entity_type FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=$3",
    )
    .bind(&s.organization)
    .bind(&s.project)
    .bind(id)
    .fetch_one(&mut **tx)
    .await
    .map_err(anyhow::Error::from)?;
    if actual != kind {
        return Err(invalid("Endpoint entity type does not match"));
    }
    Ok(())
}
pub fn text(value: &str) -> Result<(), Failure> {
    if value.trim().is_empty() {
        return Err(invalid("Text must not be blank"));
    }
    Ok(())
}
pub fn object_without_nulls(value: &mut Value) {
    value
        .as_object_mut()
        .expect("internal object")
        .retain(|_, v| !v.is_null());
}
