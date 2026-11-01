//! Independent graph projection input. Redis has no replay or rebuild.
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

use super::{native, store::Scope};
use crate::search::ingest::{error::IngestError, event};

mod lifecycle;
pub use lifecycle::SUBSCRIBED;

#[derive(Clone)]
pub struct Ingest {
    pool: PgPool,
}

// Decoded once at the Redis trust boundary, following events.yaml.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Approval {
    proposal_id: String,
    organization_id: String,
    project_id: String,
    target_entity_id: String,
    target_entity_type: String,
    resulting_entity_id: Option<String>,
    should_process: bool,
    action: String,
    requestor_id: String,
    created_at: String,
    conversation_id: Option<String>,
    message_id: Option<String>,
    generated_with_version: Option<String>,
    #[serde(default)]
    influences: Vec<Influence>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Influence {
    entity_id: String,
    entity_type: String,
    reason_type: String,
    reasoning: String,
    confidence: Option<f64>,
}

fn entity_label(kind: &str) -> Result<&'static str, IngestError> {
    match kind {
        "TASK" => Ok("Task"),
        "PROJECT" => Ok("Project"),
        "USER" => Ok("User"),
        "DESIGN_DOC" => Ok("DesignDoc"),
        "SERVICE" => Ok("Service"),
        "AGENT_SESSION" => Ok("AgentSession"),
        "CONVERSATION" => Ok("Conversation"),
        "MESSAGE" => Ok("Message"),
        "PROPOSAL" => Ok("Proposal"),
        "ARTIFACT" => Ok("Artifact"),
        "INITIATIVE" => Ok("Initiative"),
        "GOAL" => Ok("Goal"),
        "IMPLEMENTATION_HINT" => Ok("ImplementationHint"),
        _ => Err(IngestError::rejected("unsupported entity type")),
    }
}

impl Ingest {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn handle(&self, envelope: &Value) -> Result<(), IngestError> {
        let value = event::unwrap_envelope(envelope);
        if event::event_type(value)? != "proposal.approved" {
            return lifecycle::handle(self, value).await;
        }
        let approval: Approval = serde_json::from_value(value["payload"].clone())
            .map_err(|_| IngestError::rejected("invalid proposal approval payload"))?;
        if !approval.should_process {
            return Ok(());
        }
        entity_label(&approval.target_entity_type)?;
        for influence in &approval.influences {
            entity_label(&influence.entity_type)?;
        }
        if approval.organization_id.trim().is_empty() || approval.project_id.trim().is_empty() {
            return Err(IngestError::rejected(
                "approval requires organization and project",
            ));
        }
        let subject = match approval.action.as_str() {
            "CREATE" => approval.resulting_entity_id.as_deref().ok_or_else(|| {
                IngestError::rejected("CREATE approval requires resultingEntityId")
            })?,
            "UPDATE" | "DELETE" => approval
                .resulting_entity_id
                .as_deref()
                .unwrap_or(&approval.target_entity_id),
            _ => return Err(IngestError::rejected("unsupported approval action")),
        };
        let scope = Scope {
            organization: approval.organization_id.clone(),
            project: approval.project_id.clone(),
        };
        let mut tx = native::begin(&self.pool, &scope).await.map_err(|error| {
            IngestError::Failed(anyhow::anyhow!("graph transaction failed: {}", error.1))
        })?;
        if !super::store::claim_event(
            &mut tx,
            &scope,
            value["id"]
                .as_str()
                .filter(|id| !id.is_empty())
                .ok_or_else(|| IngestError::rejected("event id is required"))?,
        )
        .await?
        {
            return Ok(());
        }
        let props = json!({"status":"APPROVED", "targetEntityId":approval.target_entity_id,
            "targetEntityType":approval.target_entity_type,"resultingEntityId":approval.resulting_entity_id,
            "conversationId":approval.conversation_id,"action":approval.action,"requestorId":approval.requestor_id,
            "generatedWithVersion":approval.generated_with_version,"source":"proposal_event"});
        super::store::merge_event_node(
            &mut tx,
            &scope,
            &approval.proposal_id,
            ("PROPOSAL", "Proposal"),
            &props,
            &approval.created_at,
            false,
        )
        .await?;
        for (id, kind) in [
            (&scope.project, "PROJECT"),
            (
                &approval.target_entity_id,
                approval.target_entity_type.as_str(),
            ),
            (&subject.to_owned(), approval.target_entity_type.as_str()),
        ] {
            super::store::merge_event_node(
                &mut tx,
                &scope,
                id,
                (kind, entity_label(kind)?),
                &json!({"source":"proposal_event"}),
                &approval.created_at,
                true,
            )
            .await?;
        }
        for influence in &approval.influences {
            super::store::merge_event_node(
                &mut tx,
                &scope,
                &influence.entity_id,
                (
                    &influence.entity_type,
                    entity_label(&influence.entity_type)?,
                ),
                &json!({"source":"proposal_event"}),
                &approval.created_at,
                true,
            )
            .await?;
            if approval.action != "DELETE" || approval.resulting_entity_id.is_some() {
                super::store::merge_event_edge(&mut tx, &scope, &influence.entity_id, subject, "INFLUENCES", &json!({
                    "reasonType":influence.reason_type,"reasoning":influence.reasoning,"entityType":influence.entity_type,
                    "confidence":influence.confidence.unwrap_or(0.8),"inferredBy":"llm","source":"system",
                    "requestorId":approval.requestor_id,"conversationId":approval.conversation_id
                }), &approval.created_at).await?;
            }
        }
        super::store::merge_event_edge(&mut tx, &scope, &approval.proposal_id, subject, "TARGET_OF", &json!({"source":"system","inferredBy":"system","confidence":1.0,"reasoning":"Proposal targets subject entity"}), &approval.created_at).await?;
        if let Some(message) = &approval.message_id {
            super::store::merge_event_node(&mut tx, &scope, message, ("MESSAGE", "Message"), &json!({"content":"","authorId":"unknown","messageType":"UNKNOWN","conversationId":approval.conversation_id,"source":"proposal_event_message"}), &approval.created_at, true).await?;
            super::store::merge_event_edge(&mut tx, &scope, &approval.proposal_id, message, "AUTHORED_IN", &json!({"source":"system","inferredBy":"system","confidence":1.0,"reasoning":"Proposal authored in message context"}), &approval.created_at).await?;
        }
        if let Some(version) = &approval.generated_with_version {
            super::store::merge_event_edge(&mut tx, &scope, &approval.target_entity_id, &approval.proposal_id, "CREATED_VIA", &json!({"source":"system","inferredBy":"system","confidence":1.0,"reasoning":"Entity created/modified via proposal","generatedWithVersion":version,"action":approval.action,"targetEntityType":approval.target_entity_type}), &approval.created_at).await?;
        }
        tx.commit().await.map_err(anyhow::Error::from)?;
        Ok(())
    }
}
