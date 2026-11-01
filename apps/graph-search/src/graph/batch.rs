use super::{generated::BatchRelationshipRequest, store::Scope};
use crate::auth::Principal;
use serde_json::{Value, json};
use sqlx::PgPool;

pub async fn create(
    pool: &PgPool,
    principal: &Principal,
    request: BatchRelationshipRequest,
) -> anyhow::Result<Value> {
    let organization = principal
        .current_org
        .as_deref()
        .ok_or_else(|| anyhow::anyhow!("Batch writes require current organization"))?;
    let invalid: Vec<_> = request
        .relationships
        .iter()
        .filter(|r| r.from_artifact_id == r.to_artifact_id)
        .map(|r| json!({"relationship":r,"error":"Invalid relationship data"}))
        .collect();
    if !invalid.is_empty() {
        return Ok(
            json!({"created":[],"failed":invalid,"summary":{"total":request.relationships.len(),"successful":0,"failed":invalid.len()}}),
        );
    }
    let mut created = Vec::new();
    let mut failed = Vec::new();
    for relationship in &request.relationships {
        let projects = sqlx::query!(
            r#"SELECT a.project_id FROM graph.node a JOIN graph.node b
          ON b.organization_id=$1 AND b.project_id=a.project_id AND b.id=$3
          WHERE a.organization_id=$1 AND a.id=$2 AND NOT a.deleted AND NOT b.deleted
          AND (cardinality($4::text[])=0 OR a.project_id=ANY($4))"#,
            organization,
            relationship.from_artifact_id,
            relationship.to_artifact_id,
            &principal.project_ids
        )
        .fetch_all(pool)
        .await?;
        if projects.len() != 1 {
            failed.push(json!({"relationship":relationship,"error":"Source or target artifact does not exist"}));
            continue;
        }
        let scope = Scope {
            organization: organization.into(),
            project: projects[0].project_id.clone(),
        };
        let mut properties = relationship
            .metadata
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?
            .unwrap_or_else(|| json!({"confidence":0.9}));
        properties["source"] = json!("system");
        if properties.get("inferredBy").is_none() {
            properties["inferredBy"] = json!("system");
        }
        let created_at = relationship
            .metadata
            .as_ref()
            .and_then(|m| m.created_at.as_deref());
        properties
            .as_object_mut()
            .expect("metadata object")
            .remove("createdAt");
        let metadata = properties.to_string();
        // Unique constraint arbitrates concurrent retries, including requests in the same batch.
        let row=sqlx::query!(r#"INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type,properties,created_at,deduplication_key)
          SELECT $1,$2,a.id,b.id,$5,$6::text::jsonb,COALESCE($7::text::timestamptz,now()),$3||':'||$4||':'||$5
          FROM graph.node a JOIN graph.node b ON b.organization_id=$1 AND b.project_id=$2 AND b.id=$4 AND NOT b.deleted
          WHERE a.organization_id=$1 AND a.project_id=$2 AND a.id=$3 AND NOT a.deleted
          AND NOT EXISTS (SELECT 1 FROM graph.edge existing WHERE existing.organization_id=$1 AND existing.project_id=$2 AND existing.source_id=$3 AND existing.target_id=$4 AND existing.relationship_type=$5)
          ON CONFLICT (organization_id,project_id,deduplication_key) DO NOTHING RETURNING id"#,
          scope.organization,scope.project,relationship.from_artifact_id,relationship.to_artifact_id,relationship.kind,metadata,created_at)
          .fetch_optional(pool).await?;
        if let Some(row) = row {
            created.push(row.id);
        } else {
            failed.push(json!({"relationship":relationship,"error":"Relationship already exists"}));
        }
    }
    Ok(
        json!({"created":created,"failed":failed,"summary":{"total":request.relationships.len(),"successful":created.len(),"failed":failed.len()}}),
    )
}
