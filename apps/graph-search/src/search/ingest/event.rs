//! Event shapes of `openapi/specs/schemas/events.yaml` that the search
//! consumer reads. Events arrive from Redis, so they are validated here once;
//! the handlers receive typed values.

use serde::Deserialize;
use serde_json::Value;

use super::error::IngestError;

pub const TASK_CREATED: &str = "task.created";
pub const TASK_UPDATED: &str = "task.updated";
pub const TASK_CONTENT_CHANGED: &str = "task.content_changed";
pub const TASK_STATUS_CHANGED: &str = "task.status_changed";
pub const TASK_ARCHIVED: &str = "task.archived";
pub const ORGANIZATION_CLOSED: &str = "organization.closed";

/// The event types the consumer subscribes to: the ones the deployed
/// Embeddings service handles that this store can represent.
pub const SUBSCRIBED: [&str; 24] = [
    "message.created",
    "message.updated",
    "message.deleted",
    "conversation.created",
    "conversation.updated",
    "conversation.deleted",
    "report.created",
    TASK_CREATED,
    TASK_UPDATED,
    TASK_CONTENT_CHANGED,
    TASK_STATUS_CHANGED,
    TASK_ARCHIVED,
    ORGANIZATION_CLOSED,
    "design_doc.created",
    "design_doc.updated",
    "design_doc.content_changed",
    "design_doc.archived",
    "design_doc.restored",
    "service.created",
    "service.updated",
    "service.archived",
    "implementation_hint.created",
    "implementation_hint.updated",
    "implementation_hint.deleted",
];

/// The event inside an envelope. The API publishes `{"event": {...}}` with
/// trace fields beside it; a bare event is accepted too.
pub fn unwrap_envelope(envelope: &Value) -> &Value {
    envelope.get("event").unwrap_or(envelope)
}

/// The identity events are ordered by. It must be exact: an event is never
/// routed by a guessed or normalized identity.
pub fn aggregate_id(event: &Value) -> Result<&str, IngestError> {
    match event.get("aggregateId").and_then(Value::as_str) {
        Some(id) if !id.is_empty() && id.trim() == id => Ok(id),
        _ => Err(IngestError::rejected(
            "event.aggregateId must be a non-empty string",
        )),
    }
}

pub fn event_type(event: &Value) -> Result<&str, IngestError> {
    event
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| IngestError::rejected("event.type must be a string"))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event<P> {
    pub id: String,
    pub aggregate_id: String,
    pub payload: P,
}

impl<P: for<'de> Deserialize<'de>> Event<P> {
    pub fn parse(event: &Value) -> Result<Self, IngestError> {
        Self::deserialize(event).map_err(|error| IngestError::rejected(error.to_string()))
    }
}

/// A section of the complete current section snapshot.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub key: String,
    pub order: i64,
    /// Current content: a string, or `null` for an empty section. Anything
    /// else is not a section payload and fails to parse. The field itself must
    /// be present.
    #[serde(deserialize_with = "Option::deserialize")]
    pub materialized_markdown: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskSnapshot {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(rename = "type")]
    pub task_type: String,
    pub tag: Option<String>,
    pub acceptance_criteria: Option<String>,
    pub requirements: Option<String>,
    pub sections: Option<Vec<Section>>,
    pub initiative_id: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub assignee_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub organization_id: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSnapshot {
    #[serde(rename = "type")]
    pub task_type: String,
    pub tag: Option<String>,
    pub description: String,
    pub acceptance_criteria: Option<String>,
    pub requirements: Option<String>,
    pub sections: Option<Vec<Section>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSnapshot {
    pub name: Option<String>,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub tag: Option<String>,
    pub status: Option<String>,
    pub priority: Option<String>,
    pub due_date: Option<String>,
    pub assignee_id: Option<String>,
    pub parent_task_id: Option<String>,
}

/// The execution context every task payload carries.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskCreated {
    pub organization_id: String,
    pub project_id: String,
    pub timestamp: Option<String>,
    pub initiative_id: Option<String>,
    pub task: TaskSnapshot,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskContentChanged {
    pub organization_id: String,
    pub project_id: String,
    pub timestamp: Option<String>,
    pub initiative_id: Option<String>,
    pub content: ContentSnapshot,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskUpdated {
    pub organization_id: String,
    pub project_id: String,
    pub timestamp: Option<String>,
    pub initiative_id: Option<String>,
    pub update: UpdateSnapshot,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskStatusChanged {
    pub organization_id: String,
    pub project_id: String,
    pub timestamp: Option<String>,
    pub initiative_id: Option<String>,
    pub new_status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskArchived {
    pub organization_id: String,
    pub project_id: String,
}

/// `organization.closed` has a project-less payload with exactly these keys.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OrganizationClosed {
    pub payload_type: String,
    pub organization_id: String,
    pub marker_id: String,
    pub irreversible_closure_at: String,
    pub deletion_deadline: String,
    #[allow(dead_code)]
    pub correlation_id: Option<String>,
    #[allow(dead_code)]
    pub causation_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn events_are_routed_only_by_an_exact_aggregate_id() {
        assert_eq!(aggregate_id(&json!({"aggregateId": "abc"})).unwrap(), "abc");
        for event in [
            json!({}),
            json!({"aggregateId": ""}),
            json!({"aggregateId": " abc"}),
            json!({"aggregateId": 7}),
        ] {
            assert!(aggregate_id(&event).is_err(), "{event}");
        }
    }

    #[test]
    fn envelopes_and_bare_events_unwrap_to_the_same_event() {
        let bare = json!({"type": "task.created"});
        assert_eq!(
            unwrap_envelope(&json!({"event": bare, "traceparent": "x"})),
            &bare
        );
        assert_eq!(unwrap_envelope(&bare), &bare);
    }

    #[test]
    fn a_section_must_state_its_content_as_text_or_null() {
        for content in [json!(null), json!("words")] {
            let valid = json!({"key": "description", "order": 1, "materializedMarkdown": content});
            assert!(serde_json::from_value::<Section>(valid).is_ok());
        }
        let missing = json!({"key": "description", "order": 1});
        assert!(serde_json::from_value::<Section>(missing).is_err());
        for content in [json!(3), json!({"html": "<p>x</p>"}), json!(["a"])] {
            let invalid =
                json!({"key": "description", "order": 1, "materializedMarkdown": content});
            assert!(
                serde_json::from_value::<Section>(invalid).is_err(),
                "{content}"
            );
        }
    }
}
