//! Conversation-side projections mirror the deployed canonical-document path.
use super::{Ingest, error::IngestError, event::Event};
use crate::search::{
    store,
    wire::{Document, EmbeddingRequest, Level},
};
use serde::Deserialize;
use serde_json::{Map, Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    organization_id: String,
    project_id: String,
    conversation_id: Option<String>,
    workflow_id: Option<String>,
    workflow_about_id: Option<String>,
    workflow_about_type: Option<String>,
    workflow_name: Option<String>,
    initiated_by: Option<String>,
    status: Option<String>,
    conversation_title: Option<String>,
    timestamp: Option<String>,
    message_data_type: Option<String>,
    message: Option<Message>,
    update: Option<Message>,
    should_process: Option<bool>,
    report: Option<Report>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Message {
    #[serde(rename = "type")]
    kind: Option<String>,
    project_id: Option<String>,
    conversation_id: Option<String>,
    status: Option<String>,
    created_at: Option<String>,
    user_message: Option<String>,
    system_message: Option<String>,
    parent_message: Option<Parent>,
    should_process: Option<bool>,
    rag_enabled: Option<bool>,
}
#[derive(Deserialize)]
struct Parent {
    id: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    id: String,
    rag_enabled: Option<bool>,
    entities: Vec<Entity>,
    payload: Map<String, Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entity {
    entity_id: String,
    entity_type: String,
}
fn required(value: Option<&str>) -> Result<&str, IngestError> {
    value
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| IngestError::rejected("missing conversation-content field"))
}
fn metadata(p: &Payload, id: &str, kind: &str) -> Map<String, Value> {
    let mut m = Map::new();
    for (key, value) in [
        ("id", json!(id)),
        ("organizationId", json!(p.organization_id)),
        ("projectId", json!(p.project_id)),
        ("type", json!(kind)),
        ("sourceType", json!(kind)),
        ("sourceId", json!(id)),
        ("category", json!(kind)),
    ] {
        m.insert(key.into(), value);
    }
    m
}
fn set(m: &mut Map<String, Value>, key: &str, v: &Option<String>) {
    if let Some(v) = v {
        m.insert(key.into(), json!(v));
    }
}
fn document(m: Map<String, Value>, text: String) -> Result<Document, IngestError> {
    let canonical_only = text.is_empty();
    EmbeddingRequest {
        text,
        metadata: Some(m),
        level: Level::Document,
    }
    .validate_content(canonical_only)
    .map_err(|e| IngestError::rejected(e.message))
}
async fn canonical(ingest: &Ingest, d: Document) -> Result<(), IngestError> {
    if !d.text.is_empty() {
        return ingest.store(d).await;
    }
    let units = store::units(&d);
    let vector = ingest.encoder.encode("").await?;
    store::replace_document(&ingest.pool, &d, &units, &[vector])
        .await?
        .map_err(|_| IngestError::rejected("organization closed"))
}
fn report_text(p: &Map<String, Value>) -> Result<String, IngestError> {
    let mut parts = Vec::new();
    for (key, label) in [
        ("summary", "Summary"),
        ("implementationNotes", "Implementation notes"),
        ("validationRecommendationsSummary", "Validation summary"),
    ] {
        if let Some(v) = p.get(key).filter(|v| !v.is_null()) {
            let v = v
                .as_str()
                .ok_or_else(|| IngestError::rejected("report text must be a string"))?;
            if !v.trim().is_empty() {
                parts.push(format!("{label}: {}", v.trim()));
            }
        }
    }
    for (key, fields) in [
        (
            "nextSteps",
            vec![("title", "Next step: "), ("description", "")],
        ),
        (
            "verificationTasks",
            vec![("title", "Verification task: "), ("instructions", "")],
        ),
        (
            "recommendedUpdates",
            vec![("summary", "Recommended update: ")],
        ),
        (
            "openQuestions",
            vec![("question", "Open question: "), ("reason", "")],
        ),
        (
            "artifactUpdateSuggestions",
            vec![("reasoning", "Artifact update reasoning: ")],
        ),
        (
            "validationRecommendations",
            vec![
                ("title", "Validation recommendation: "),
                ("stepDescription", ""),
                ("expectedResult", ""),
            ],
        ),
    ] {
        if let Some(items) = p.get(key).filter(|v| !v.is_null()) {
            for item in items
                .as_array()
                .ok_or_else(|| IngestError::rejected("report items must be an array"))?
            {
                let item = item
                    .as_object()
                    .ok_or_else(|| IngestError::rejected("report item must be an object"))?;
                for (field, label) in &fields {
                    if let Some(v) = item.get(*field).filter(|v| !v.is_null()) {
                        let text = v.as_str().ok_or_else(|| {
                            IngestError::rejected("report item text must be a string")
                        })?;
                        if !text.trim().is_empty() {
                            parts.push(format!("{label}{}", text.trim()));
                        }
                    }
                }
            }
        }
    }
    if let Some(v) = p.get("taskAssessment").filter(|v| !v.is_null()) {
        let assessment = v
            .as_object()
            .ok_or_else(|| IngestError::rejected("task assessment must be an object"))?;
        for (v, label) in [
            (assessment.get("summary"), "Task assessment"),
            (
                assessment
                    .get("statusRecommendation")
                    .and_then(|v| v.get("reason")),
                "Status recommendation",
            ),
        ] {
            if let Some(v) = v {
                let text = v
                    .as_str()
                    .ok_or_else(|| IngestError::rejected("assessment text must be a string"))?;
                if !text.trim().is_empty() {
                    parts.push(format!("{label}: {}", text.trim()));
                }
            }
        }
    }
    let text = parts.join("\n");
    required(Some(&text))?;
    Ok(text)
}

pub async fn handle(ingest: &Ingest, kind: &str, raw: &Value) -> Result<(), IngestError> {
    let event: Event<Payload> = Event::parse(raw)?;
    let p = &event.payload;
    required(Some(&p.organization_id))?;
    required(Some(&p.project_id))?;
    required(Some(&event.aggregate_id))?;
    if kind == "conversation.updated" {
        return Ok(());
    }
    if kind.ends_with(".deleted") {
        store::delete_conversation_content(
            &ingest.pool,
            &p.organization_id,
            &p.project_id,
            &event.aggregate_id,
            kind == "conversation.deleted",
        )
        .await?;
        return Ok(());
    }
    if kind == "report.created" {
        let r = p
            .report
            .as_ref()
            .ok_or_else(|| IngestError::rejected("report required"))?;
        if r.rag_enabled == Some(false) || p.should_process == Some(false) {
            return Ok(());
        }
        if r.id != event.aggregate_id || r.entities.is_empty() {
            return Err(IngestError::rejected("invalid report identity or entities"));
        }
        report_text(&r.payload)?;
        for e in &r.entities {
            required(Some(&e.entity_id))?;
            required(Some(&e.entity_type))?;
        }
        for e in &r.entities {
            let doc_type = match e.entity_type.trim().to_uppercase().as_str() {
                "MESSAGE" => "message",
                "TASK" | "PLAN" => "task",
                "DESIGN_DOC" => "design_doc",
                "SERVICE" => "service",
                _ => continue,
            };
            if let Err(error) = store::append_enrichment(
                &ingest.pool,
                &p.organization_id,
                &p.project_id,
                &e.entity_id,
                doc_type,
                (&r.id, "REPORT"),
            )
            .await
            {
                tracing::warn!(%error,"report enrichment failed");
            }
        }
        return Ok(());
    }
    if kind == "conversation.created" {
        required(p.workflow_name.as_deref())?;
        required(p.initiated_by.as_deref())?;
        required(p.status.as_deref())?;
        let mut m = metadata(p, &event.aggregate_id, "conversation");
        for (k, v) in [
            ("title", &p.conversation_title),
            ("workflowId", &p.workflow_id),
            ("workflowAboutId", &p.workflow_about_id),
            ("workflowAboutType", &p.workflow_about_type),
            ("workflowName", &p.workflow_name),
            ("initiatedBy", &p.initiated_by),
            ("status", &p.status),
            ("createdAt", &p.timestamp),
            ("updatedAt", &p.timestamp),
        ] {
            set(&mut m, k, v);
        }
        return canonical(ingest, document(m, String::new())?).await;
    }
    let updated = kind == "message.updated";
    let msg = if updated { &p.update } else { &p.message };
    let msg = msg
        .as_ref()
        .ok_or_else(|| IngestError::rejected("message snapshot required"))?;
    if msg.should_process == Some(false) || msg.rag_enabled == Some(false) {
        return Ok(());
    }
    let mut m = metadata(p, &event.aggregate_id, "message");
    let conv = if updated {
        p.conversation_id.as_ref().or(msg.conversation_id.as_ref())
    } else {
        msg.conversation_id.as_ref().or(p.conversation_id.as_ref())
    };
    m.insert(
        "conversationId".into(),
        json!(required(conv.map(String::as_str))?),
    );
    if !updated {
        set(&mut m, "projectId", &msg.project_id);
        set(&mut m, "messageType", &msg.kind);
        set(&mut m, "createdAt", &msg.created_at);
    } else {
        set(&mut m, "updatedAt", &p.timestamp);
    }
    set(&mut m, "workflowId", &p.workflow_id);
    set(&mut m, "dataType", &p.message_data_type);
    set(&mut m, "status", &msg.status);
    let mut parent_id = None;
    let text = if updated {
        match msg
            .system_message
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty())
        {
            Some(v) => v.to_owned(),
            None => return Ok(()),
        }
    } else {
        match required(msg.kind.as_deref())? {
            "SYSTEM" => String::new(),
            "USER" => {
                let user = required(msg.user_message.as_deref())?.trim();
                match &msg.parent_message {
                    Some(parent) if !parent.content.trim().is_empty() => {
                        parent_id = Some(parent.id.as_str());
                        format!("ASSISTANT: {}\nUSER: {user}", parent.content.trim())
                    }
                    _ => user.to_owned(),
                }
            }
            _ => return Err(IngestError::rejected("unsupported message type")),
        }
    };
    let d = document(m, text.clone())?;
    canonical(ingest, d).await?;
    let Some(id) = parent_id else {
        return Ok(());
    };
    let parent = match store::load_document(&ingest.pool, &p.organization_id, id).await {
        Ok(Some(parent)) => parent,
        Ok(None) => return Ok(()),
        Err(error) => {
            tracing::warn!(%error, "parent lookup failed");
            return Ok(());
        }
    };
    if parent.kind != "message" || parent.project_id.as_deref() != Some(&p.project_id) {
        return Ok(());
    }
    let d = document(parent.metadata, text)?;
    ingest.store(d).await
}
