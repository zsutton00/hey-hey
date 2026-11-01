//! Durable, surface-local closure evidence and organization write barrier.
use crate::search::wire::DeletionIdentity;
use serde_json::Value;
use sqlx::PgPool;

pub enum Outcome {
    Deleted,
    Conflict(Value),
}

pub async fn delete(pool: &PgPool, identity: &DeletionIdentity) -> anyhow::Result<Outcome> {
    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))")
        .bind(&identity.organization_id)
        .execute(&mut *tx)
        .await?;
    let mut canonical = identity.clone();
    canonical.irreversible_closure_at = canonical
        .irreversible_closure_at
        .to_offset(time::UtcOffset::UTC);
    canonical.deletion_deadline = canonical.deletion_deadline.to_offset(time::UtcOffset::UTC);
    let requested = canonical.to_json();
    sqlx::query("INSERT INTO graph.projection_deletion (organization_id,identity) VALUES ($1,$2) ON CONFLICT DO NOTHING")
        .bind(&identity.organization_id).bind(&requested).execute(&mut *tx).await?;
    let retained: Value = sqlx::query_scalar(
        "SELECT identity FROM graph.projection_deletion WHERE organization_id=$1",
    )
    .bind(&identity.organization_id)
    .fetch_one(&mut *tx)
    .await?;
    if retained != requested {
        return Ok(Outcome::Conflict(retained));
    }
    sqlx::query("DELETE FROM graph.edge WHERE organization_id=$1")
        .bind(&identity.organization_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM graph.node WHERE organization_id=$1")
        .bind(&identity.organization_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM graph.template_copy_receipt WHERE organization_id=$1")
        .bind(&identity.organization_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM graph.agent_edge_deletion WHERE organization_id=$1")
        .bind(&identity.organization_id)
        .execute(&mut *tx)
        .await?;
    let remaining: bool = sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM graph.node WHERE organization_id=$1) OR EXISTS (SELECT 1 FROM graph.edge WHERE organization_id=$1) OR EXISTS (SELECT 1 FROM graph.template_copy_receipt WHERE organization_id=$1) OR EXISTS (SELECT 1 FROM graph.agent_edge_deletion WHERE organization_id=$1)")
        .bind(&identity.organization_id).fetch_one(&mut *tx).await?;
    anyhow::ensure!(!remaining, "Organization content remained after deletion");
    tx.commit().await?;
    Ok(Outcome::Deleted)
}
