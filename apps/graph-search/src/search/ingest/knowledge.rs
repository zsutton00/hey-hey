//! Project knowledge lifecycle projections. Validate transport data before writes.
use super::{
    Ingest,
    error::IngestError,
    event::{Event, Section},
    text,
};
use crate::search::{
    store,
    wire::{Document, EmbeddingRequest, Level},
};
use regex::Regex;
use serde::Deserialize;
use serde_json::{Map, Value, json};
use std::sync::LazyLock;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    organization_id: String,
    project_id: String,
    design_doc: Option<Snapshot>,
    service: Option<Snapshot>,
    implementation_hint: Option<Snapshot>,
    implementation_hint_id: Option<String>,
}

// The fields consumed from canonical API snapshots. Other DTO fields have no
// searchable meaning and are intentionally not copied into metadata.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    id: String,
    organization_id: Option<String>,
    name: Option<String>,
    summary: Option<String>,
    description: Option<String>,
    status: Option<String>,
    template: Option<String>,
    tags: Option<Vec<String>>,
    created_at: String,
    updated_at: String,
    archived_at: Option<String>,
    repository_url: Option<String>,
    repository_type: Option<String>,
    repository_id: Option<String>,
    service_type: Option<String>,
    language: Option<String>,
    framework: Option<String>,
    sections: Option<Vec<Section>>,
    service_id: Option<String>,
    feature_name: Option<String>,
    source_type: Option<String>,
    hint: Option<String>,
    extracted_from: Option<String>,
    confidence: Option<f64>,
    version: Option<i64>,
    agent_session_id: Option<String>,
    coding_prompt_ids: Option<Vec<String>>,
    file_references: Option<Vec<FileReference>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileReference {
    file_path: String,
}

fn required(value: Option<&str>) -> Result<&str, IngestError> {
    value
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| IngestError::rejected("missing required knowledge field"))
}

fn project(kind: &str, p: &Payload, s: &Snapshot) -> Result<Document, IngestError> {
    required(Some(&p.organization_id))?;
    required(Some(&p.project_id))?;
    if s.organization_id
        .as_ref()
        .is_some_and(|org| org != &p.organization_id)
    {
        return Err(IngestError::rejected(
            "snapshot organization does not match payload",
        ));
    }
    let mut m = Map::new();
    for (key, value) in [
        ("id", json!(s.id)),
        ("organizationId", json!(p.organization_id)),
        ("projectId", json!(p.project_id)),
        ("type", json!(kind)),
        ("sourceType", json!(kind)),
        ("sourceId", json!(s.id)),
        ("category", json!(kind)),
        ("createdAt", json!(s.created_at)),
        ("updatedAt", json!(s.updated_at)),
    ] {
        m.insert(key.into(), value);
    }
    let mut parts = Vec::new();
    let mut set = |key: &str, value: Value| {
        if !value.is_null() {
            m.insert(key.into(), value);
        }
    };
    if kind == "implementation_hint" {
        let feature = required(s.feature_name.as_deref())?;
        let description = required(s.description.as_deref())?;
        required(s.service_id.as_deref())?;
        required(s.source_type.as_deref())?;
        parts.extend([
            feature.to_owned(),
            description.to_owned(),
            s.hint.clone().unwrap_or_default(),
        ]);
        let paths: Vec<&str> = s
            .file_references
            .as_deref()
            .unwrap_or_default()
            .iter()
            .map(|f| required(Some(&f.file_path)))
            .collect::<Result<_, _>>()?;
        for path in &paths {
            parts.push(format!("File path: {path}"));
        }
        for (key, value) in [
            ("title", json!(feature)),
            ("featureName", json!(feature)),
            ("description", json!(description)),
            ("serviceId", json!(s.service_id)),
            ("sourceType", json!(s.source_type)),
            ("hint", json!(s.hint)),
            ("extractedFrom", json!(s.extracted_from)),
            ("confidence", json!(s.confidence)),
            ("version", json!(s.version)),
            (
                "agentSessionIds",
                json!(s.agent_session_id.as_ref().map(|id| vec![id])),
            ),
            ("codingPromptIds", json!(s.coding_prompt_ids)),
            ("filePaths", json!(paths)),
        ] {
            set(key, value);
        }
    } else {
        let name = required(s.name.as_deref())?;
        parts.push(name.to_owned());
        set("name", json!(name));
        set("title", json!(name));
        set("status", json!(s.status));
        set("tags", json!(s.tags));
        if kind == "design_doc" {
            set("summaryText", json!(s.summary));
            set("template", json!(s.template));
            parts.push(s.summary.clone().unwrap_or_default());
            let mut sections: Vec<&Section> =
                s.sections.as_deref().unwrap_or_default().iter().collect();
            sections.sort_by_key(|section| section.order);
            for section in sections {
                parts.push(section.key.clone());
                parts.push(section.materialized_markdown.clone().unwrap_or_default());
            }
        } else {
            required(s.status.as_deref())?;
            parts.push(s.description.clone().unwrap_or_default());
            for (key, label, value) in [
                ("serviceType", "Service type", &s.service_type),
                ("language", "Language", &s.language),
                ("framework", "Framework", &s.framework),
                ("repositoryUrl", "Repository", &s.repository_url),
                ("repositoryType", "Repository type", &s.repository_type),
            ] {
                set(key, json!(value));
                if let Some(value) = value.as_ref().filter(|v| !v.is_empty()) {
                    parts.push(format!("{label}: {value}"));
                }
            }
            set("description", json!(s.description));
            set("repositoryId", json!(s.repository_id));
            set("archivedAt", json!(s.archived_at));
        }
    }
    let raw = parts
        .iter()
        .map(|p| p.trim())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    // Knowledge processors use the deployed Markdown rule, which also removes
    // paired underscores inside identifiers. Work-item section rules differ.
    static UNDERSCORES: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"_(.*?)_").expect("valid pattern"));
    let raw = UNDERSCORES.replace_all(&raw, "$1");
    let mut text = text::strip_markdown(&raw);
    if kind == "service" {
        let tags = s.tags.as_deref().unwrap_or_default().join(" ");
        if !tags.is_empty() {
            text.push_str(&format!(" Tags: {tags}"));
        }
    }
    EmbeddingRequest {
        text,
        metadata: Some(m),
        level: Level::Document,
    }
    .validate()
    .map_err(|e| IngestError::rejected(e.message))
}

pub async fn handle(ingest: &Ingest, event_type: &str, raw: &Value) -> Result<(), IngestError> {
    let event: Event<Payload> = Event::parse(raw)?;
    let p = &event.payload;
    required(Some(&p.organization_id))?;
    required(Some(&p.project_id))?;
    let (kind, action) = event_type.split_once('.').expect("registered event");
    let snapshot = match kind {
        "design_doc" => &p.design_doc,
        "service" => &p.service,
        _ => &p.implementation_hint,
    };
    if action == "deleted" {
        if required(p.implementation_hint_id.as_deref())? != event.aggregate_id {
            return Err(IngestError::rejected("hint identity mismatch"));
        }
    } else if snapshot.as_ref().map(|s| s.id.as_str()) != Some(event.aggregate_id.as_str()) {
        return Err(IngestError::rejected("snapshot identity mismatch"));
    }
    // Content events replace the entire searchable document. An absent snapshot
    // cannot mean an empty snapshot; only an explicit [] clears sections.
    if kind == "design_doc" && matches!(action, "created" | "content_changed" | "restored") {
        let content = snapshot
            .as_ref()
            .ok_or_else(|| IngestError::rejected("designDoc is required"))?;
        if content.sections.is_none() {
            return Err(IngestError::rejected(
                "designDoc.sections is required for content events",
            ));
        }
    }
    if let Some(snapshot) = snapshot {
        project(kind, p, snapshot)?;
    }
    if action == "archived" || action == "deleted" {
        sqlx::query("WITH conversations AS (SELECT DISTINCT document_id FROM search.unit WHERE organization_id=$1 AND project_id=$2 AND type='conversation' AND metadata->>'workflowAboutId'=$3 AND metadata->>'workflowAboutType'='design-doc' AND $4='design_doc') DELETE FROM search.unit WHERE organization_id=$1 AND project_id=$2 AND (document_id=$3 OR document_id IN (SELECT document_id FROM conversations) OR metadata->>'conversationId' IN (SELECT document_id FROM conversations))")
            .bind(&p.organization_id).bind(&p.project_id).bind(&event.aggregate_id).bind(kind).execute(&ingest.pool).await.map_err(anyhow::Error::from)?;
        return Ok(());
    }
    let s = snapshot.as_ref().expect("identity validated");
    let document = project(kind, p, s)?;
    if kind == "design_doc" && action == "updated" {
        store::patch_document(
            &ingest.pool,
            &p.organization_id,
            &s.id,
            &document.metadata,
            Some(&document.title),
            document.updated_at,
        )
        .await?;
        return Ok(());
    }
    ingest.store(document).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(key: &str, snapshot: Value) -> Payload {
        let mut value = json!({"organizationId": "org", "projectId": "project"});
        value[key] = snapshot;
        serde_json::from_value(value).unwrap()
    }

    fn snapshot() -> Value {
        json!({"id": "document", "organizationId": "org", "name": "**Guide**",
            "createdAt": "2026-11-01T09:00:00Z", "updatedAt": "2026-11-01T10:00:00Z"})
    }

    #[test]
    fn design_text_includes_ordered_keys_and_metadata() {
        let mut s = snapshot();
        s["summary"] = json!("Overview");
        s["sections"] = json!([
            {"key": "second", "order": 2, "materializedMarkdown": "Later"},
            {"key": "first", "order": 1, "materializedMarkdown": "Earlier"}
        ]);
        let p = payload("designDoc", s);
        let d = project("design_doc", &p, p.design_doc.as_ref().unwrap()).unwrap();
        assert_eq!(
            d.text,
            "Guide\n\nOverview\n\nfirst\n\nEarlier\n\nsecond\n\nLater"
        );
        assert_eq!(d.metadata["summaryText"], "Overview");
        assert_eq!(d.metadata["sourceId"], "document");
    }

    #[test]
    fn canonical_design_doc_fixture_matches_deployed_update_fields() {
        let raw: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/knowledge/design_doc.content_changed.json"
        ))
        .unwrap();
        let event: Event<Payload> = Event::parse(&raw["event"]).unwrap();
        let document = project(
            "design_doc",
            &event.payload,
            event.payload.design_doc.as_ref().unwrap(),
        )
        .unwrap();
        assert_eq!(
            document.metadata["summaryText"],
            raw["event"]["payload"]["designDoc"]["summary"]
        );
        assert!(!document.metadata.contains_key("summary"));
        let expected: Map<String, Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/knowledge/design_doc.content_changed.expected.json"
        ))
        .unwrap();
        for (key, value) in expected {
            if key == "textFeatures" {
                assert_eq!(document.text, value.as_str().unwrap());
            } else if key == "createdAt" || key == "updatedAt" {
                let timestamp = crate::search::wire::parse_timestamp(
                    document.metadata[&key].as_str().unwrap(),
                    "timestamp",
                )
                .unwrap();
                assert_eq!(
                    timestamp.unix_timestamp_nanos() / 1_000_000,
                    i128::from(value.as_i64().unwrap()),
                    "{key}"
                );
            } else {
                assert_eq!(document.metadata.get(&key), Some(&value), "{key}");
            }
        }
    }

    #[test]
    fn service_and_hint_text_follow_deployed_composition() {
        let mut s = snapshot();
        s["status"] = json!("ACTIVE");
        s["description"] = json!("Description");
        s["language"] = json!("Rust");
        s["tags"] = json!(["local", "search"]);
        let p = payload("service", s);
        let d = project("service", &p, p.service.as_ref().unwrap()).unwrap();
        assert_eq!(
            d.text,
            "Guide\n\nDescription\n\nLanguage: Rust Tags: local search"
        );
        let mut s = snapshot();
        s["featureName"] = json!("Search");
        s["description"] = json!("Use scopes");
        s["hint"] = json!("Always");
        s["serviceId"] = json!("service");
        s["sourceType"] = json!("USER");
        s["fileReferences"] = json!([{"filePath": "src/main.rs"}]);
        let p = payload("implementationHint", s);
        let d = project(
            "implementation_hint",
            &p,
            p.implementation_hint.as_ref().unwrap(),
        )
        .unwrap();
        assert_eq!(
            d.text,
            "Search\n\nUse scopes\n\nAlways\n\nFile path: src/main.rs"
        );
        assert_eq!(d.metadata["filePaths"], json!(["src/main.rs"]));
    }

    #[test]
    fn invalid_metadata_never_becomes_a_document() {
        for field in ["serviceId", "featureName", "description", "sourceType"] {
            let mut s = snapshot();
            for key in ["serviceId", "featureName", "description", "sourceType"] {
                s[key] = json!("value");
            }
            s[field] = Value::Null;
            let p = payload("implementationHint", s);
            assert!(
                project(
                    "implementation_hint",
                    &p,
                    p.implementation_hint.as_ref().unwrap()
                )
                .is_err()
            );
        }
        let mut s = snapshot();
        s["organizationId"] = json!("other");
        let p = payload("designDoc", s);
        assert!(project("design_doc", &p, p.design_doc.as_ref().unwrap()).is_err());
    }
}
