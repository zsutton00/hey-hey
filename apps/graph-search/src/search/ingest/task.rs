//! Work-item events: what is searchable about a task follows its events.

use anyhow::anyhow;
use serde_json::{Map, Value};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::{
    Ingest,
    error::IngestError,
    event::{
        ContentSnapshot, Event, Section, TaskArchived, TaskContentChanged, TaskCreated,
        TaskSnapshot, TaskStatusChanged, TaskUpdated,
    },
    requirements::{self, Requirements},
    text,
};
use crate::search::{
    store,
    wire::{Document, Level, MAX_TEXT_CHARS, parse_timestamp},
};

const FEATURE: &str = "FEATURE";
const STANDARD: &str = "STANDARD";

/// Metadata keys that a content change recomputes from the new content.
const CONTENT_KEYS: [&str; 4] = ["description", "acceptanceCriteria", "requirements", "tag"];

/// The content fields shared by a task snapshot and a content snapshot.
struct Content<'a> {
    task_type: &'a str,
    tag: Option<&'a str>,
    description: &'a str,
    acceptance_criteria: Option<&'a str>,
    requirements: Option<&'a str>,
    sections: Option<&'a [Section]>,
}

impl<'a> From<&'a TaskSnapshot> for Content<'a> {
    fn from(task: &'a TaskSnapshot) -> Self {
        Self {
            task_type: &task.task_type,
            tag: task.tag.as_deref(),
            description: &task.description,
            acceptance_criteria: task.acceptance_criteria.as_deref(),
            requirements: task.requirements.as_deref(),
            sections: task.sections.as_deref(),
        }
    }
}

impl<'a> From<&'a ContentSnapshot> for Content<'a> {
    fn from(content: &'a ContentSnapshot) -> Self {
        Self {
            task_type: &content.task_type,
            tag: content.tag.as_deref(),
            description: &content.description,
            acceptance_criteria: content.acceptance_criteria.as_deref(),
            requirements: content.requirements.as_deref(),
            sections: content.sections.as_deref(),
        }
    }
}

/// Everything derived from a task's current content.
struct Derived {
    text: String,
    /// Metadata fields that exist only while the content has them.
    fields: Map<String, Value>,
}

fn derive(name: &str, content: &Content<'_>) -> Result<Derived, IngestError> {
    if content.task_type.trim().is_empty() {
        return Err(IngestError::rejected("task type must not be empty"));
    }
    let is_feature = content.task_type == FEATURE;

    // Only FEATURE tasks carry a requirements collection.
    let requirements: Option<Requirements> = content
        .requirements
        .filter(|_| is_feature)
        .map(requirements::parse)
        .transpose()?;
    let requirements_text = requirements
        .as_ref()
        .map(|requirements| requirements.text.as_str())
        .filter(|text| !text.is_empty());

    // Complete sections replace the legacy description and criteria fields.
    let (description, acceptance_criteria, mut parts) = match content.sections {
        Some(sections) => (
            text::section_text(sections, "description")?,
            text::section_text(sections, "acceptanceCriteria")?,
            text::compose_sections(sections)?,
        ),
        None => {
            let acceptance = (content.task_type == STANDARD)
                .then_some(content.acceptance_criteria)
                .flatten()
                .filter(|criteria| !criteria.trim().is_empty())
                .map(str::to_owned);
            let mut parts = vec![content.description.to_owned()];
            if let Some(criteria) = &acceptance {
                parts.push(format!("Acceptance criteria: {criteria}"));
            }
            (Some(content.description.to_owned()), acceptance, parts)
        }
    };
    if let Some(statements) = requirements_text {
        parts.push(format!("Requirements:\n{statements}"));
    }
    parts.insert(0, name.to_owned());

    let mut fields = Map::new();
    let mut set = |key: &str, value: Option<String>| {
        if let Some(value) = value.filter(|value| !value.is_empty()) {
            fields.insert(key.to_owned(), Value::String(value));
        }
    };
    set("description", description);
    set("acceptanceCriteria", acceptance_criteria);
    set(
        "requirements",
        requirements.map(|requirements| requirements.canonical),
    );
    set("tag", content.tag.filter(|_| is_feature).map(str::to_owned));

    Ok(Derived {
        text: text::searchable_text(&parts),
        fields,
    })
}

fn timestamp(value: &str, field: &'static str) -> Result<OffsetDateTime, IngestError> {
    parse_timestamp(value, field)
        .map_err(|invalid| IngestError::rejected(format!("{} {}", invalid.field, invalid.message)))
}

fn rfc3339(instant: OffsetDateTime) -> String {
    instant
        .format(&Rfc3339)
        .expect("valid instants format as RFC 3339")
}

fn required<'a>(value: &'a str, field: &str) -> Result<&'a str, IngestError> {
    if value.trim().is_empty() {
        return Err(IngestError::rejected(format!("{field} must not be empty")));
    }
    Ok(value)
}

/// Indexed text is capped like the HTTP surface; the full-text index cannot
/// hold more, and the encoder reads the start of the text anyway.
fn capped(text: String) -> String {
    match text.char_indices().nth(MAX_TEXT_CHARS) {
        Some((end, _)) => {
            tracing::warn!("searchable text exceeds the limit and is truncated");
            text[..end].to_owned()
        }
        None => text,
    }
}

pub async fn created(ingest: &Ingest, event: Event<TaskCreated>) -> Result<(), IngestError> {
    let payload = event.payload;
    let task = &payload.task;
    if task.id != event.aggregate_id {
        return Err(IngestError::rejected(
            "task.id does not match the event aggregate",
        ));
    }
    if task.organization_id != payload.organization_id {
        return Err(IngestError::rejected(
            "task.organizationId does not match the event organization",
        ));
    }
    required(&task.name, "task.name")?;
    required(&payload.project_id, "projectId")?;

    let created_at = timestamp(&task.created_at, "task.createdAt")?;
    let updated_at = timestamp(&task.updated_at, "task.updatedAt")?;
    let derived = derive(&task.name, &Content::from(task))?;

    let mut metadata = derived.fields;
    let mut set = |key: &str, value: Option<&str>| {
        if let Some(value) = value {
            metadata.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    };
    set("id", Some(&task.id));
    set("organizationId", Some(&task.organization_id));
    set("projectId", Some(&payload.project_id));
    set("type", Some("task"));
    set("sourceType", Some("task"));
    set("sourceId", Some(&task.id));
    set("category", Some("task"));
    set("taskType", Some(&task.task_type));
    set("name", Some(&task.name));
    set(
        "initiativeId",
        task.initiative_id
            .as_deref()
            .or(payload.initiative_id.as_deref()),
    );
    set("parentTaskId", task.parent_task_id.as_deref());
    set("assigneeId", task.assignee_id.as_deref());
    set("status", task.status.as_deref());
    set("priority", task.priority.as_deref());
    let due_date = task
        .due_date
        .as_deref()
        .map(|due| timestamp(due, "task.dueDate").map(rfc3339))
        .transpose()?;
    set("dueDate", due_date.as_deref());
    set("createdAt", Some(&rfc3339(created_at)));
    set("updatedAt", Some(&rfc3339(updated_at)));

    ingest
        .store(Document {
            id: task.id.clone(),
            organization_id: task.organization_id.clone(),
            project_id: Some(payload.project_id.clone()),
            kind: "task".into(),
            task_type: Some(task.task_type.clone()),
            title: task.name.clone(),
            text: capped(derived.text),
            level: Level::Document,
            metadata,
            created_at: Some(created_at),
            updated_at: Some(updated_at),
        })
        .await
}

pub async fn content_changed(
    ingest: &Ingest,
    event: Event<TaskContentChanged>,
) -> Result<(), IngestError> {
    let payload = event.payload;
    let task_id = event.aggregate_id;
    let organization_id = required(&payload.organization_id, "organizationId")?;

    let existing = store::load_document(&ingest.pool, organization_id, &task_id)
        .await?
        .filter(|document| document.kind == "task")
        .ok_or_else(|| {
            IngestError::Failed(anyhow!(
                "task content changed for a task that is not searchable"
            ))
        })?;
    let name = existing
        .metadata
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.trim().is_empty())
        .ok_or_else(|| IngestError::Failed(anyhow!("stored task has no name")))?
        .to_owned();

    let derived = derive(&name, &Content::from(&payload.content))?;
    let updated_at = payload
        .timestamp
        .as_deref()
        .map(|value| timestamp(value, "timestamp"))
        .transpose()?
        .or(existing.updated_at);

    // The new content replaces what was derived before, so a section that was
    // removed or cleared leaves nothing behind.
    let mut metadata = existing.metadata;
    for key in CONTENT_KEYS {
        metadata.remove(key);
    }
    metadata.extend(derived.fields);
    metadata.insert(
        "taskType".into(),
        Value::String(payload.content.task_type.clone()),
    );
    if let Some(initiative_id) = &payload.initiative_id {
        metadata.insert("initiativeId".into(), Value::String(initiative_id.clone()));
    }
    if let Some(updated_at) = updated_at {
        metadata.insert("updatedAt".into(), Value::String(rfc3339(updated_at)));
    }

    ingest
        .store(Document {
            id: task_id,
            organization_id: organization_id.to_owned(),
            project_id: existing.project_id,
            kind: "task".into(),
            task_type: Some(payload.content.task_type),
            title: name,
            text: capped(derived.text),
            level: Level::Document,
            metadata,
            created_at: existing.created_at,
            updated_at,
        })
        .await
}

pub async fn updated(ingest: &Ingest, event: Event<TaskUpdated>) -> Result<(), IngestError> {
    let payload = event.payload;
    let update = payload.update;
    if update.task_type.is_some() {
        return Err(IngestError::rejected(
            "task.updated must not change the task type",
        ));
    }

    let mut patch = Map::new();
    let mut set = |key: &str, value: Option<&str>| {
        if let Some(value) = value {
            patch.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    };
    set("name", update.name.as_deref());
    set("status", update.status.as_deref());
    set("priority", update.priority.as_deref());
    set("assigneeId", update.assignee_id.as_deref());
    set("parentTaskId", update.parent_task_id.as_deref());
    let due_date = update
        .due_date
        .as_deref()
        .map(|due| timestamp(due, "update.dueDate").map(rfc3339))
        .transpose()?;
    set("dueDate", due_date.as_deref());

    if let Some(name) = &update.name {
        required(name, "update.name")?;
    }

    // A tag belongs to FEATURE tasks only; the update does not carry the type.
    if let Some(tag) = &update.tag {
        let stored =
            store::load_document(&ingest.pool, &payload.organization_id, &event.aggregate_id)
                .await?;
        if stored.is_some_and(|document| document.task_type.as_deref() == Some(FEATURE)) {
            patch.insert("tag".into(), Value::String(tag.clone()));
        }
    }
    if patch.is_empty() {
        return Ok(());
    }

    apply_patch(
        ingest,
        &payload.organization_id,
        &event.aggregate_id,
        patch,
        update.name.as_deref(),
        payload.timestamp.as_deref(),
        payload.initiative_id.as_deref(),
    )
    .await
}

pub async fn status_changed(
    ingest: &Ingest,
    event: Event<TaskStatusChanged>,
) -> Result<(), IngestError> {
    let payload = event.payload;
    let mut patch = Map::new();
    patch.insert("status".into(), Value::String(payload.new_status));

    apply_patch(
        ingest,
        &payload.organization_id,
        &event.aggregate_id,
        patch,
        None,
        payload.timestamp.as_deref(),
        payload.initiative_id.as_deref(),
    )
    .await
}

/// Metadata updates change what the search filters and shows, not the text.
async fn apply_patch(
    ingest: &Ingest,
    organization_id: &str,
    task_id: &str,
    mut patch: Map<String, Value>,
    title: Option<&str>,
    timestamp_text: Option<&str>,
    initiative_id: Option<&str>,
) -> Result<(), IngestError> {
    if let Some(initiative_id) = initiative_id {
        patch.insert(
            "initiativeId".into(),
            Value::String(initiative_id.to_owned()),
        );
    }
    let updated_at = timestamp_text
        .map(|value| timestamp(value, "timestamp"))
        .transpose()?;
    if let Some(updated_at) = updated_at {
        patch.insert("updatedAt".into(), Value::String(rfc3339(updated_at)));
    }

    let found = store::patch_document(
        &ingest.pool,
        organization_id,
        task_id,
        &patch,
        title,
        updated_at,
    )
    .await?;
    if !found {
        return Err(IngestError::Failed(anyhow!(
            "task update for a task that is not searchable"
        )));
    }
    Ok(())
}

pub async fn archived(ingest: &Ingest, event: Event<TaskArchived>) -> Result<(), IngestError> {
    let payload = event.payload;
    let removed = store::delete_task_tree(
        &ingest.pool,
        &payload.organization_id,
        &payload.project_id,
        &event.aggregate_id,
    )
    .await?;
    tracing::info!(removed, "archived task removed from search");
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn section(key: &str, order: i64, content: Value) -> Section {
        Section {
            key: key.into(),
            order,
            materialized_markdown: content.as_str().map(str::to_owned),
        }
    }

    fn content<'a>(task_type: &'a str, sections: Option<&'a [Section]>) -> Content<'a> {
        Content {
            task_type,
            tag: None,
            description: "legacy description",
            acceptance_criteria: Some("legacy criteria"),
            requirements: None,
            sections,
        }
    }

    #[test]
    fn current_sections_replace_earlier_text_and_clearing_removes_it() {
        let before = [section("description", 1, json!("Quarterly ledgers."))];
        let after = [section("description", 1, json!("Yearly statements."))];

        let first = derive("Export", &content("STANDARD", Some(&before))).unwrap();
        let second = derive("Export", &content("STANDARD", Some(&after))).unwrap();
        let cleared = derive("Export", &content("STANDARD", Some(&[]))).unwrap();

        assert_eq!(first.text, "Export\n\ndescription:\nQuarterly ledgers.");
        assert_eq!(second.text, "Export\n\ndescription:\nYearly statements.");
        assert_eq!(cleared.text, "Export");
        assert!(cleared.fields.is_empty());
    }

    #[test]
    fn sections_take_precedence_over_legacy_fields() {
        let sections = [section("description", 1, json!("From sections."))];
        let derived = derive("Item", &content("STANDARD", Some(&sections))).unwrap();
        assert!(!derived.text.contains("legacy"));
        assert_eq!(derived.fields["description"], "From sections.");
    }

    #[test]
    fn producers_without_sections_use_the_legacy_fields() {
        let standard = derive("Item", &content("STANDARD", None)).unwrap();
        assert_eq!(
            standard.text,
            "Item\n\nlegacy description\n\nAcceptance criteria: legacy criteria"
        );
        // Acceptance criteria belong to STANDARD tasks only.
        let other = derive("Item", &content("BUG", None)).unwrap();
        assert_eq!(other.text, "Item\n\nlegacy description");
    }

    #[test]
    fn feature_requirements_join_the_text_and_other_types_ignore_them() {
        let requirements = r#"{"records":[{"id":"6f5b8c1e-2d40-4c0a-9a7e-0f4e8f2c7a11","statement":"Export works.","designedBy":[],"fulfilledBy":[],"contracts":[]}]}"#;
        let mut feature = content("FEATURE", Some(&[]));
        feature.requirements = Some(requirements);
        let derived = derive("Billing", &feature).unwrap();
        assert_eq!(derived.text, "Billing\n\nRequirements:\nExport works.");

        let mut other = content("ResearchFinding", Some(&[]));
        other.requirements = Some("not a collection");
        assert_eq!(derive("Finding", &other).unwrap().text, "Finding");
    }

    #[test]
    fn a_malformed_feature_requirements_copy_is_rejected_not_repaired() {
        let mut feature = content("FEATURE", Some(&[]));
        feature.requirements = Some("- legacy bullet");
        assert!(matches!(
            derive("Billing", &feature),
            Err(IngestError::Rejected(_))
        ));
    }

    #[test]
    fn the_exact_type_key_is_required_and_preserved() {
        assert!(matches!(
            derive("Item", &content(" ", None)),
            Err(IngestError::Rejected(_))
        ));
        assert!(derive("Item", &content("ResearchFinding", None)).is_ok());
    }

    #[test]
    fn indexed_text_is_capped_at_the_http_limit() {
        let long = "a".repeat(MAX_TEXT_CHARS + 10);
        assert_eq!(capped(long).chars().count(), MAX_TEXT_CHARS);
        assert_eq!(capped("short".into()), "short");
    }
}
