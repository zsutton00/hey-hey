//! Port of Graph's event handlers and relationship mappers. JSON is decoded at
//! this boundary; the resulting projection operations are applied atomically.
use super::*;
use sqlx::{Postgres, Transaction};
mod content;
mod sessions;
mod work_items;

pub const SUBSCRIBED: &[&str] = &[
    "proposal.approved",
    "task.created",
    "task.updated",
    "task.status_changed",
    "task.archived",
    "task.assigned",
    "task.unassigned",
    "initiative.created",
    "initiative.updated",
    "initiative.status_changed",
    "initiative.archived",
    "message.created",
    "message.updated",
    "message.deleted",
    "conversation.created",
    "conversation.updated",
    "conversation.deleted",
    "conversation.status_changed",
    "design_doc.created",
    "design_doc.updated",
    "design_doc.archived",
    "design_doc.restored",
    "service.created",
    "service.updated",
    "service.archived",
    "artifact.created",
    "artifact.updated",
    "artifact.deleted",
    "agent_session.created",
    "agent_session.status_changed",
    "agent_session.deleted",
    "implementation_hint.created",
    "implementation_hint.updated",
    "implementation_hint.deleted",
    "report.created",
    "mention.created",
    "mention.removed",
    "summary.created",
    "summary.updated",
    "summary.deleted",
    "organization.closed",
];

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, IngestError> {
    value[key]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| IngestError::rejected(format!("missing {key}")))
}
fn snapshot<'a>(payload: &'a Value, key: &str) -> Result<&'a Value, IngestError> {
    if payload[key].is_object() {
        Ok(&payload[key])
    } else {
        Err(IngestError::rejected(format!("missing {key} snapshot")))
    }
}
fn selected(value: &Value, fields: &[&str]) -> Value {
    let mut result = json!({});
    for field in fields {
        if !value[field].is_null() {
            result[*field] = value[*field].clone();
        }
    }
    result
}
fn process(value: &Value) -> Result<bool, IngestError> {
    value["shouldProcess"]
        .as_bool()
        .ok_or_else(|| IngestError::rejected("shouldProcess is required"))
}
fn normalized(kind: &str) -> String {
    kind.trim().to_uppercase().replace('-', "_")
}

struct Projection<'a> {
    tx: Transaction<'static, Postgres>,
    scope: Scope,
    id: &'a str,
    timestamp: String,
    source: String,
}
impl Projection<'_> {
    async fn node(
        &mut self,
        id: &str,
        kind: &str,
        props: Value,
        missing_only: bool,
    ) -> Result<(), IngestError> {
        let kind = normalized(kind);
        let label = match kind.as_str() {
            "REPORT" => "Report",
            "CATEGORY" => "Category",
            "FACET" => "Facet",
            _ => entity_label(&kind)?,
        };
        let mut props = props;
        props["id"] = json!(id);
        props["organizationId"] = json!(self.scope.organization);
        if kind != "USER" && kind != "PROJECT" {
            props["projectId"] = json!(self.scope.project);
        }
        props["source"] = json!(self.source);
        super::super::store::merge_event_node(
            &mut self.tx,
            &self.scope,
            id,
            (&kind, label),
            &props,
            &self.timestamp,
            missing_only,
        )
        .await?;
        Ok(())
    }
    async fn ensure(&mut self, id: Option<&str>, kind: &str) -> Result<(), IngestError> {
        if let Some(id) = id {
            self.node(id, kind, json!({}), true).await?;
        }
        Ok(())
    }
    async fn edge(
        &mut self,
        from: &str,
        to: &str,
        kind: &str,
        reason: &str,
        extra: Value,
    ) -> Result<(), IngestError> {
        let mut properties =
            json!({"source":"system","inferredBy":"system","confidence":1.0,"reasoning":reason});
        properties
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        // Neo4j MATCHes the endpoints; updates do not invent the subject node.
        let exists: bool = sqlx::query_scalar("SELECT count(*)=2 FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)")
            .bind(&self.scope.organization).bind(&self.scope.project).bind(vec![from,to]).fetch_one(&mut *self.tx).await.map_err(anyhow::Error::from)?;
        if exists {
            super::super::store::merge_event_edge(
                &mut self.tx,
                &self.scope,
                from,
                to,
                kind,
                &properties,
                &self.timestamp,
            )
            .await?;
        }
        Ok(())
    }
    async fn update(&mut self, kind: &str, mut props: Value) -> Result<(), IngestError> {
        props["updatedAt"] = json!(self.timestamp);
        sqlx::query("UPDATE graph.node SET deleted=COALESCE(($5->>'deleted')::boolean,deleted),properties=(properties||$5)-ARRAY(SELECT key FROM jsonb_each($5) WHERE value='null'::jsonb),updated_at=$6::text::timestamptz WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND entity_type=$4")
            .bind(&self.scope.organization).bind(&self.scope.project).bind(self.id).bind(kind).bind(props).bind(&self.timestamp).execute(&mut *self.tx).await.map_err(anyhow::Error::from)?;
        Ok(())
    }
    async fn remove_edges(&mut self, kind: &str, incoming: bool) -> Result<(), IngestError> {
        sqlx::query("DELETE FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type=$3 AND CASE WHEN $4 THEN target_id ELSE source_id END=$5")
            .bind(&self.scope.organization).bind(&self.scope.project).bind(kind).bind(incoming).bind(self.id).execute(&mut *self.tx).await.map_err(anyhow::Error::from)?;
        Ok(())
    }
    async fn cascade(&mut self, kind: &str, hard: bool, status: &str) -> Result<(), IngestError> {
        let ids: Vec<String> = sqlx::query_scalar("WITH RECURSIVE descendants(id) AS (SELECT id FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=$3 AND entity_type=$4 UNION SELECT e.target_id FROM descendants d JOIN graph.edge e ON e.organization_id=$1 AND e.project_id=$2 AND e.source_id=d.id WHERE e.relationship_type IN ('HAS_INITIATIVE','HAS_TASK','HAS_AGENT_SESSION','HAS_IMPLEMENTATION_HINT','HAS_DESIGN_DOC','HAS_SUB_DOC','HAS_MESSAGE','HAS_CATEGORY','HAS_FACET','HAS_KB_ENTRY')) SELECT id FROM descendants")
            .bind(&self.scope.organization).bind(&self.scope.project).bind(self.id).bind(kind).fetch_all(&mut *self.tx).await.map_err(anyhow::Error::from)?;
        if hard {
            sqlx::query(
                "DELETE FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)",
            )
            .bind(&self.scope.organization)
            .bind(&self.scope.project)
            .bind(ids)
            .execute(&mut *self.tx)
            .await
            .map_err(anyhow::Error::from)?;
        } else {
            let props = json!({"deleted":true,"archivedAt":self.timestamp,"updatedAt":self.timestamp,"status":status});
            sqlx::query("UPDATE graph.node SET deleted=true,properties=properties||$4,updated_at=$5::text::timestamptz WHERE organization_id=$1 AND project_id=$2 AND id=ANY($3)").bind(&self.scope.organization).bind(&self.scope.project).bind(ids).bind(props).bind(&self.timestamp).execute(&mut *self.tx).await.map_err(anyhow::Error::from)?;
        }
        Ok(())
    }
}

pub async fn handle(ingest: &Ingest, e: &Value) -> Result<(), IngestError> {
    let kind = event::event_type(e)?;
    if !SUBSCRIBED.contains(&kind) {
        return Err(IngestError::rejected("unsupported graph event"));
    }
    if kind == "organization.closed" {
        return closed(ingest, e).await;
    }
    // These are subscribed but deliberately unhandled by the deployed handlers.
    if matches!(kind, "design_doc.restored" | "conversation.status_changed") {
        return Ok(());
    }
    let p = snapshot(e, "payload")?;
    if p["payloadType"].as_str().is_some_and(|s| s != kind) {
        return Err(IngestError::rejected("payloadType mismatch"));
    }
    let scope = Scope {
        organization: required(p, "organizationId")
            .or_else(|_| required(e, "organizationId"))?
            .into(),
        project: required(p, "projectId")
            .or_else(|_| required(e, "projectId"))?
            .into(),
    };
    let id = event::aggregate_id(e)?;
    let timestamp = p["service"]["archivedAt"]
        .as_str()
        .or(p["archivedAt"].as_str())
        .or(p["timestamp"].as_str())
        .or(e["createdAt"].as_str())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            time::OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap()
        });
    let (family, action) = kind.split_once('.').unwrap();
    let tx = native::begin(&ingest.pool, &scope)
        .await
        .map_err(|err| IngestError::Failed(anyhow::anyhow!("{}", err.1)))?;
    let mut projection = Projection {
        tx,
        scope,
        id,
        timestamp,
        source: format!("{family}_event"),
    };
    if !super::super::store::claim_event(&mut projection.tx, &projection.scope, required(e, "id")?)
        .await?
    {
        return Ok(());
    }
    match family {
        "task" | "initiative" | "service" | "design_doc" | "conversation" | "artifact" => {
            work_items::simple(&mut projection, family, action, p).await?
        }
        "message" => content::message(&mut projection, action, p, e).await?,
        "agent_session" => sessions::session(&mut projection, action, p, e).await?,
        "implementation_hint" => sessions::hint(&mut projection, action, p, e).await?,
        "report" => content::report(&mut projection, p).await?,
        "mention" => content::mention(&mut projection, action, p, e).await?,
        "summary" => content::summary(&mut projection, action, p).await?,
        _ => return Err(IngestError::rejected("unsupported graph family")),
    }
    projection.tx.commit().await.map_err(anyhow::Error::from)?;
    Ok(())
}

async fn closed(ingest: &Ingest, e: &Value) -> Result<(), IngestError> {
    use crate::search::wire::ProjectionDeletionCommand;
    let p = &e["payload"];
    if event::aggregate_id(e)? != required(p, "organizationId")?
        || p["payloadType"] != "organization.closed"
    {
        return Err(IngestError::rejected("closure identity mismatch"));
    }
    let command: ProjectionDeletionCommand = serde_json::from_value(selected(
        p,
        &[
            "organizationId",
            "markerId",
            "irreversibleClosureAt",
            "deletionDeadline",
        ],
    ))
    .map_err(|_| IngestError::rejected("invalid closure payload"))?;
    let identity = command
        .validate()
        .map_err(|_| IngestError::rejected("invalid closure identity"))?;
    match super::super::lifecycle::delete(&ingest.pool, &identity).await? {
        super::super::lifecycle::Outcome::Deleted => Ok(()),
        super::super::lifecycle::Outcome::Conflict(_) => {
            Err(IngestError::rejected("closure marker conflict"))
        }
    }
}
