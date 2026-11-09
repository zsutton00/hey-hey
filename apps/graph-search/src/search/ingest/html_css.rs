//! The canonical html/css section payload (`WorkItemHtmlCssSectionContent` in
//! `openapi/specs/schemas/work-item-type-definition.yaml`).
//!
//! Section content arrives from Redis, so it is parsed once, here, against the
//! complete schema. Anything that does not match — an unknown field, an empty
//! size key, an annotation of the wrong shape — is malformed and the event is
//! rejected before it can replace what was searchable. Only `html` has a text
//! projection; the rest is validated so a bad payload cannot slip through.

// Parsing validates the whole payload; the fields are checked, not read.
#![allow(dead_code)]

use std::sync::LazyLock;

use regex::Regex;
use serde::{Deserialize, Deserializer, de::Error};

/// The only fields an html/css payload may carry beside `html` and `css`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HtmlCss {
    pub html: String,
    css: String,
    #[serde(default, deserialize_with = "non_empty")]
    size_key: Option<String>,
    #[serde(default)]
    annotations: Option<Vec<Annotation>>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Annotation {
    #[serde(deserialize_with = "uuid_text")]
    id: String,
    #[serde(deserialize_with = "bounded_note")]
    note: String,
    author: Author,
    category: Category,
    lifecycle: Lifecycle,
    #[serde(deserialize_with = "uuid_text")]
    authored_proposal_id: String,
    #[serde(deserialize_with = "required_non_empty")]
    authored_size_key: String,
    target: Target,
}

/// Authors and targets are alternatives told apart by a literal `type`; each
/// alternative is a closed object, so an extra field makes it match neither.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Author {
    Human(HumanAuthor),
    Agent(AgentAuthor),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct HumanAuthor {
    #[serde(rename = "type")]
    kind: HumanTag,
    #[serde(deserialize_with = "branded_id")]
    user_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct AgentAuthor {
    #[serde(rename = "type")]
    kind: AgentTag,
    #[serde(deserialize_with = "branded_id")]
    agent_session_id: String,
}

#[derive(Debug, Deserialize)]
enum HumanTag {
    #[serde(rename = "human")]
    Human,
}

#[derive(Debug, Deserialize)]
enum AgentTag {
    #[serde(rename = "agent")]
    Agent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Category {
    Context,
    Suggestion,
    Question,
    Issue,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Lifecycle {
    Open,
    Resolved,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum Target {
    Element(ElementTarget),
    Position(PositionTarget),
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ElementTarget {
    #[serde(rename = "type")]
    kind: ElementTag,
    #[serde(deserialize_with = "required_non_empty")]
    node_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct PositionTarget {
    #[serde(rename = "type")]
    kind: PositionTag,
    #[serde(deserialize_with = "unit_interval")]
    x: f64,
    #[serde(deserialize_with = "unit_interval")]
    y: f64,
    #[serde(deserialize_with = "required_non_empty")]
    size_key: String,
}

#[derive(Debug, Deserialize)]
enum ElementTag {
    #[serde(rename = "element")]
    Element,
}

#[derive(Debug, Deserialize)]
enum PositionTag {
    #[serde(rename = "position")]
    Position,
}

const MAX_NOTE_CHARS: usize = 4000;

static UUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
        .expect("pattern is valid")
});

/// The branded user and agent-session ids of `common.yaml`.
static BRANDED_ID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        .expect("pattern is valid")
});

fn required_non_empty<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if value.is_empty() {
        return Err(D::Error::custom("must not be empty"));
    }
    Ok(value)
}

/// An optional field that is absent or a non-empty string; `null` is not valid.
fn non_empty<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    required_non_empty(deserializer).map(Some)
}

fn matching<'de, D: Deserializer<'de>>(
    deserializer: D,
    pattern: &Regex,
    what: &str,
) -> Result<String, D::Error> {
    let value = String::deserialize(deserializer)?;
    if !pattern.is_match(&value) {
        return Err(D::Error::custom(format!("must be a {what}")));
    }
    Ok(value)
}

fn uuid_text<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    matching(deserializer, &UUID, "uuid")
}

fn branded_id<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    matching(deserializer, &BRANDED_ID, "branded id")
}

fn bounded_note<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let note = required_non_empty(deserializer)?;
    if note.chars().count() > MAX_NOTE_CHARS {
        return Err(D::Error::custom("must be at most 4000 characters"));
    }
    Ok(note)
}

fn unit_interval<'de, D: Deserializer<'de>>(deserializer: D) -> Result<f64, D::Error> {
    let value = f64::deserialize(deserializer)?;
    if !(0.0..=1.0).contains(&value) {
        return Err(D::Error::custom("must be between 0 and 1"));
    }
    Ok(value)
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn annotation() -> Value {
        json!({
            "id": "6f5b8c1e-2d40-4c0a-9a7e-0f4e8f2c7a11",
            "note": "Tighten the spacing",
            "author": {"type": "human", "userId": "550e8400-e29b-41d4-a716-446655440001"},
            "category": "suggestion",
            "lifecycle": "open",
            "authoredProposalId": "6f5b8c1e-2d40-4c0a-9a7e-0f4e8f2c7a12",
            "authoredSizeKey": "desktop",
            "target": {"type": "position", "x": 0.25, "y": 1, "sizeKey": "desktop"},
        })
    }

    fn payload(extra: Value) -> Value {
        let mut payload = json!({"html": "<p>x</p>", "css": ""});
        payload
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        payload
    }

    fn parses(value: Value) -> bool {
        serde_json::from_value::<HtmlCss>(value).is_ok()
    }

    #[test]
    fn a_complete_payload_with_annotations_is_valid() {
        assert!(parses(json!({"html": "", "css": ""})));
        assert!(parses(payload(
            json!({"sizeKey": "mobile", "annotations": []})
        )));
        assert!(parses(payload(json!({"annotations": [annotation()]}))));

        let mut element = annotation();
        element["target"] = json!({"type": "element", "nodeId": "hero"});
        element["author"] = json!({
            "type": "agent", "agentSessionId": "550e8400-e29b-41d4-a716-446655440021"
        });
        assert!(parses(payload(json!({"annotations": [element]}))));
    }

    #[test]
    fn every_departure_from_the_canonical_payload_is_malformed() {
        let mutate = |change: &dyn Fn(&mut Value)| {
            let mut entry = annotation();
            change(&mut entry);
            payload(json!({"annotations": [entry]}))
        };
        let malformed = [
            payload(json!({"sizeKey": ""})),
            payload(json!({"sizeKey": null})),
            payload(json!({"annotations": [42]})),
            payload(json!({"annotations": [{}]})),
            payload(json!({"extra": 1})),
            json!({"html": "<p>x</p>"}),
            json!({"css": ""}),
            mutate(&|entry| entry["note"] = json!("")),
            mutate(&|entry| entry["note"] = json!("x".repeat(4001))),
            mutate(&|entry| entry["id"] = json!("not-a-uuid")),
            mutate(&|entry| entry["category"] = json!("praise")),
            mutate(&|entry| entry["lifecycle"] = json!("closed")),
            mutate(&|entry| entry["authoredSizeKey"] = json!("")),
            mutate(&|entry| entry["author"] = json!({"type": "robot"})),
            mutate(&|entry| entry["author"]["userId"] = json!("nope")),
            mutate(&|entry| entry["target"]["x"] = json!(1.5)),
            mutate(&|entry| entry["target"]["sizeKey"] = json!("")),
            mutate(&|entry| entry["target"]["extra"] = json!(true)),
            mutate(&|entry| entry["target"] = json!({"type": "element", "nodeId": ""})),
            mutate(&|entry| {
                entry.as_object_mut().unwrap().remove("lifecycle");
            }),
        ];
        for value in malformed {
            assert!(!parses(value.clone()), "{value}");
        }
    }
}
