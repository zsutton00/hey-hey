//! Global Help content. Help belongs to no organization or project: it is
//! stored under `store::GLOBAL_ORGANIZATION`, which organization deletion never
//! matches, and search returns it beside project results. One event replaces or
//! removes every chunk of one Help node.
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::{
    Ingest,
    error::IngestError,
    event::{Event, HELP_CONTENT_CHANGED},
};
use crate::search::{
    store::{self, GLOBAL_ORGANIZATION},
    wire::{Document, Level},
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Payload {
    payload_type: String,
    change_kind: Option<ChangeKind>,
    help_node: Option<Node>,
    help_node_id: Option<String>,
    content_version: Option<Version>,
    content_hash: Option<String>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
enum ChangeKind {
    Upsert,
    Retire,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Version {
    Number(i64),
    Text(String),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Node {
    id: String,
    parent_id: Option<String>,
    slug: String,
    title: String,
    ordering: i64,
    body: String,
    demos: Vec<Demo>,
    path: Option<String>,
    section: Option<String>,
    root: Option<String>,
}

/// Only the caption of a demo is text; its preset or definition is inert.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Demo {
    id: String,
    #[allow(dead_code)]
    ordering: i64,
    caption: String,
    kind: DemoKind,
    preset_key: Option<String>,
    definition: Option<Value>,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum DemoKind {
    Preset,
    Dsl,
}

fn blank(value: &str) -> bool {
    value.trim().is_empty()
}

impl Node {
    fn validate(&self) -> Result<(), IngestError> {
        let invalid = |reason: &str| Err(IngestError::rejected(format!("Help node {reason}")));
        if blank(&self.id) || blank(&self.slug) || blank(&self.title) {
            return invalid("id, slug and title must not be blank");
        }
        if self.parent_id.as_deref().is_some_and(blank) {
            return invalid("parentId must not be blank when supplied");
        }
        for demo in &self.demos {
            let missing_payload = match demo.kind {
                DemoKind::Preset => demo.preset_key.as_deref().is_none_or(blank),
                DemoKind::Dsl => demo.definition.is_none(),
            };
            if blank(&demo.id) || blank(&demo.caption) || missing_payload {
                return invalid("has an incomplete demo");
            }
        }
        Ok(())
    }
}

/// The version and hash an event states; at least one is required.
struct Revision {
    version: Option<String>,
    hash: Option<String>,
}

impl Payload {
    fn revision(&self) -> Result<Revision, IngestError> {
        let version = match &self.content_version {
            Some(Version::Number(number)) => Some(number.to_string()),
            Some(Version::Text(text)) => Some(text.clone()),
            None => None,
        }
        .filter(|version| !blank(version));
        let hash = self.content_hash.clone().filter(|hash| !blank(hash));
        if version.is_none() && hash.is_none() {
            return Err(IngestError::rejected(
                "Help events require contentVersion or contentHash",
            ));
        }
        Ok(Revision { version, hash })
    }
}

/// The document id; its chunk ids are `<id>_chunk_<n>`, as deployed.
fn document_id(node_id: &str) -> String {
    format!("help_{node_id}")
}

/// Title, body and demo captions, as the deployed projection composes them.
fn text(node: &Node) -> String {
    let captions = node.demos.iter().map(|demo| demo.caption.as_str());
    [node.title.as_str(), node.body.as_str()]
        .into_iter()
        .chain(captions)
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn document(node: &Node, revision: &Revision) -> Document {
    let captions: Vec<&str> = node
        .demos
        .iter()
        .map(|demo| demo.caption.as_str())
        .collect();
    let mut metadata = Map::new();
    for (key, value) in [
        ("id", json!(node.id)),
        ("helpNodeId", json!(node.id)),
        ("type", json!("help")),
        ("contentType", json!("help")),
        ("sourceType", json!("HELP")),
        ("sourceId", json!(node.id)),
        ("title", json!(node.title)),
        ("slug", json!(node.slug)),
        ("path", json!(node.path)),
        ("parentHelpNodeId", json!(node.parent_id)),
        ("helpSection", json!(node.section)),
        ("helpRoot", json!(node.root)),
        ("scope", json!("global")),
        ("markdownBody", json!(node.body)),
        ("demoCaptions", json!(captions)),
        ("contentVersion", json!(revision.version)),
        ("contentHash", json!(revision.hash)),
        ("ordering", json!(node.ordering)),
    ] {
        if !value.is_null() {
            metadata.insert(key.into(), value);
        }
    }
    Document {
        id: document_id(&node.id),
        organization_id: GLOBAL_ORGANIZATION.into(),
        project_id: None,
        kind: "help".into(),
        task_type: None,
        title: node.title.clone(),
        text: text(node),
        level: Level::Chunk,
        metadata,
        created_at: None,
        updated_at: None,
    }
}

/// What a stored node's revision says about an incoming one.
#[derive(Debug, PartialEq)]
enum Ordering {
    Apply,
    /// The stored node already has a later version.
    Stale,
}

fn compare(stored: &Map<String, Value>, revision: &Revision) -> Result<Ordering, IngestError> {
    let stored_text = |key: &str| {
        stored
            .get(key)
            .and_then(Value::as_str)
            .filter(|v| !blank(v))
    };
    let (Some(incoming), Some(current)) = (&revision.version, stored_text("contentVersion")) else {
        return Ok(Ordering::Apply);
    };

    if let (Ok(incoming), Ok(current)) = (incoming.parse::<i64>(), current.parse::<i64>())
        && incoming < current
    {
        return Ok(Ordering::Stale);
    }
    let reused = incoming == current
        && revision
            .hash
            .as_deref()
            .zip(stored_text("contentHash"))
            .is_some_and(|(incoming, current)| incoming != current);
    if reused {
        return Err(IngestError::rejected(
            "Help content version is reused with a different content hash",
        ));
    }
    Ok(Ordering::Apply)
}

pub async fn handle(ingest: &Ingest, raw: &Value) -> Result<(), IngestError> {
    let event: Event<Payload> = Event::parse(raw)?;
    let payload = &event.payload;
    if payload.payload_type != HELP_CONTENT_CHANGED {
        return Err(IngestError::rejected(
            "help.content_changed payload.payloadType must match the event type",
        ));
    }
    let revision = payload.revision()?;
    if let Some(node) = &payload.help_node {
        node.validate()?;
    }

    // The combined publisher event is an upsert unless it says otherwise.
    let kind = match (&payload.change_kind, &payload.help_node) {
        (Some(kind), _) => kind,
        (None, Some(_)) => &ChangeKind::Upsert,
        (None, None) => {
            return Err(IngestError::rejected(
                "help.content_changed payload.changeKind must be UPSERT or RETIRE",
            ));
        }
    };

    let node_id = match (&payload.help_node, &payload.help_node_id) {
        (Some(node), Some(id)) if node.id != *id => {
            return Err(IngestError::rejected("helpNodeId must match helpNode.id"));
        }
        (Some(node), _) => &node.id,
        (None, Some(id)) if !blank(id) => id,
        _ => {
            return Err(IngestError::rejected(
                "Help event requires helpNodeId or helpNode",
            ));
        }
    };
    // Events are ordered by aggregate id, so it must be the node.
    if event.aggregate_id != *node_id {
        return Err(IngestError::rejected(
            "aggregateId must be the Help node id",
        ));
    }

    match (kind, &payload.help_node) {
        (ChangeKind::Retire, _) => {
            store::delete_global_document(&ingest.pool, &document_id(node_id)).await?;
            Ok(())
        }
        (ChangeKind::Upsert, Some(node)) => {
            if let Some(stored) =
                store::load_document(&ingest.pool, GLOBAL_ORGANIZATION, &document_id(node_id))
                    .await?
                && compare(&stored.metadata, &revision)? == Ordering::Stale
            {
                return Ok(());
            }
            ingest.store(document(node, &revision)).await
        }
        (ChangeKind::Upsert, None) => Err(IngestError::rejected("Help UPSERT requires helpNode")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn node() -> Node {
        serde_json::from_value(json!({
            "id": "node", "parentId": null, "slug": "start", "title": "Getting started",
            "ordering": 2, "body": "Open **the** app.",
            "demos": [{"id": "d", "ordering": 1, "caption": "A short demo",
                       "kind": "preset", "presetKey": "tour"}]
        }))
        .unwrap()
    }

    fn revision(version: Option<&str>, hash: Option<&str>) -> Revision {
        Revision {
            version: version.map(str::to_owned),
            hash: hash.map(str::to_owned),
        }
    }

    #[test]
    fn help_is_global_and_composed_like_the_deployed_projection() {
        let document = document(&node(), &revision(Some("3"), Some("abc")));
        assert_eq!(document.organization_id, GLOBAL_ORGANIZATION);
        assert_eq!(document.project_id, None);
        assert_eq!(document.id, "help_node");
        assert_eq!(
            document.text,
            "Getting started\n\nOpen **the** app.\n\nA short demo"
        );
        let expected = json!({
            "id": "node", "helpNodeId": "node", "type": "help", "contentType": "help",
            "sourceType": "HELP", "sourceId": "node", "title": "Getting started",
            "slug": "start", "scope": "global", "markdownBody": "Open **the** app.",
            "demoCaptions": ["A short demo"], "contentVersion": "3", "contentHash": "abc",
            "ordering": 2
        });
        assert_eq!(Value::Object(document.metadata), expected);
    }

    #[test]
    fn the_deployed_projection_of_a_captured_event_matches() {
        let raw: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/help/help.content_changed.json"
        ))
        .unwrap();
        let expected: Map<String, Value> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/help/help.content_changed.expected.json"
        ))
        .unwrap();
        let event: Event<Payload> = Event::parse(&raw["event"]).unwrap();
        let payload = &event.payload;
        let node = payload.help_node.as_ref().unwrap();
        node.validate().unwrap();

        let document = document(node, &payload.revision().unwrap());
        assert_eq!(document.text, expected["textFeatures"]);
        assert_eq!(
            store::units(&document)[0].id,
            expected["id"].as_str().unwrap()
        );
        for (key, value) in &expected {
            // The deployed store keeps absent values as "", this one omits them.
            if matches!(
                key.as_str(),
                "id" | "textFeatures" | "chunkIndex" | "totalChunks"
            ) || matches!(key.as_str(), "wordCount" | "path" | "parentHelpNodeId")
                || matches!(key.as_str(), "helpSection" | "helpRoot" | "contentVersion")
            {
                continue;
            }
            assert_eq!(document.metadata.get(key), Some(value), "{key}");
        }
        assert_eq!(document.metadata["id"], expected["helpNodeId"]);
    }

    #[test]
    fn a_node_must_be_complete() {
        assert!(node().validate().is_ok());
        for edit in [
            json!({"slug": " "}),
            json!({"parentId": ""}),
            json!({"demos": [{"id": "d", "ordering": 1, "caption": "c", "kind": "preset"}]}),
            json!({"demos": [{"id": "d", "ordering": 1, "caption": "c", "kind": "dsl"}]}),
            json!({"demos": [{"id": "d", "ordering": 1, "caption": " ", "kind": "dsl",
                              "definition": {}}]}),
        ] {
            let mut value = json!({"id": "node", "parentId": null, "slug": "s", "title": "t",
                "ordering": 0, "body": "", "demos": []});
            value
                .as_object_mut()
                .unwrap()
                .extend(edit.as_object().unwrap().clone());
            let node: Node = serde_json::from_value(value).unwrap();
            assert!(node.validate().is_err());
        }
    }

    #[test]
    fn an_event_states_its_version_or_hash() {
        let payload = |extra: Value| {
            let mut value = json!({"payloadType": HELP_CONTENT_CHANGED});
            value
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            serde_json::from_value::<Payload>(value).unwrap()
        };
        assert!(payload(json!({})).revision().is_err());
        assert!(payload(json!({"contentVersion": " "})).revision().is_err());
        assert_eq!(
            payload(json!({"contentVersion": 4}))
                .revision()
                .unwrap()
                .version,
            Some("4".into())
        );
        assert!(payload(json!({"contentHash": "h"})).revision().is_ok());
    }

    #[test]
    fn a_stored_later_version_wins_and_a_reused_version_must_match() {
        let stored = json!({"contentVersion": "5", "contentHash": "a"});
        let stored = stored.as_object().unwrap();
        assert_eq!(
            compare(stored, &revision(Some("4"), None)).unwrap(),
            Ordering::Stale
        );
        assert_eq!(
            compare(stored, &revision(Some("6"), None)).unwrap(),
            Ordering::Apply
        );
        assert_eq!(
            compare(stored, &revision(None, Some("b"))).unwrap(),
            Ordering::Apply
        );
        assert_eq!(
            compare(stored, &revision(Some("5"), Some("a"))).unwrap(),
            Ordering::Apply
        );
        assert!(compare(stored, &revision(Some("5"), Some("b"))).is_err());
    }
}
