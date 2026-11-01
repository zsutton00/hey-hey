//! Artifact events. Like the deployed service, an artifact's own text is never
//! searchable: an artifact attaches a reference (`artifactId`, `artifactType`)
//! to the stored document it is about, and deleting the artifact removes it.
use serde::Deserialize;
use serde_json::Value;

use super::{Ingest, error::IngestError, event::Event};
use crate::search::store;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    organization_id: String,
    project_id: String,
    artifact: Option<Artifact>,
    update: Option<Value>,
    artifact_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Artifact {
    organization_id: String,
    project_id: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    source_type: String,
    source_id: String,
    generate_embedding: Option<bool>,
    data: Option<Value>,
}

/// `QAPairData` from the producer schema: every field the QA pair needs is
/// required, so a payload missing any of them is malformed rather than partial.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct QaPairData {
    #[serde(rename = "type")]
    kind: String,
    question: String,
    answer: String,
    user_message_id: String,
    system_message_id: String,
}

/// `InsightData` from the producer schema.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
struct InsightData {
    #[serde(rename = "type")]
    kind: String,
    confidence: f64,
    reasoning: String,
    content: String,
}

/// A stored document an artifact is attached to.
#[derive(Debug, PartialEq)]
struct Target {
    kind: &'static str,
    id: String,
}

/// Parses `data` as the shape its artifact type requires, at the ingestion
/// boundary, before anything is written.
fn typed_data<T: serde::de::DeserializeOwned>(
    artifact: &Artifact,
    id: &str,
    discriminator: impl Fn(&T) -> &str,
) -> Result<T, IngestError> {
    let kind = &artifact.kind;
    let data = artifact
        .data
        .clone()
        .ok_or_else(|| IngestError::rejected(format!("{kind} artifact {id} has no data")))?;
    let data: T = serde_json::from_value(data)
        .map_err(|error| IngestError::rejected(format!("{kind} artifact {id} data: {error}")))?;
    if discriminator(&data) != kind {
        return Err(IngestError::rejected(format!(
            "{kind} artifact {id} data type does not match the artifact type"
        )));
    }
    Ok(data)
}

fn required(value: &str, what: &str) -> Result<(), IngestError> {
    if value.trim().is_empty() {
        return Err(IngestError::rejected(format!("{what} must not be blank")));
    }
    Ok(())
}

/// The documents an artifact enriches. Types the deployed service does not
/// enrich are ignored, and the deprecated initiative targets never exist here.
fn targets(artifact: &Artifact, id: &str) -> Result<Vec<Target>, IngestError> {
    match artifact.kind.as_str() {
        "QA_PAIR" => {
            let data = typed_data::<QaPairData>(artifact, id, |data| &data.kind)?;
            let mut targets: Vec<Target> = Vec::new();
            for message_id in [&data.user_message_id, &data.system_message_id]
                .into_iter()
                .map(|message_id| message_id.trim())
                .filter(|message_id| !message_id.is_empty())
            {
                if targets.iter().all(|target| target.id != message_id) {
                    targets.push(Target {
                        kind: "message",
                        id: message_id.to_owned(),
                    });
                }
            }
            if targets.is_empty() {
                return Err(IngestError::rejected(format!(
                    "QA_PAIR artifact {id} names no message"
                )));
            }
            Ok(targets)
        }
        "INSIGHT" => {
            if artifact.data.is_some() {
                typed_data::<InsightData>(artifact, id, |data| &data.kind)?;
            }
            let source_id = artifact.source_id.trim();
            if source_id.is_empty() {
                return Err(IngestError::rejected(format!(
                    "INSIGHT artifact {id} has no sourceId"
                )));
            }
            let kind = match artifact.source_type.as_str() {
                "MESSAGE" => "message",
                "TASK" => "task",
                "INITIATIVE" => return Ok(Vec::new()),
                other => {
                    return Err(IngestError::rejected(format!(
                        "INSIGHT artifact {id} has unsupported sourceType {other}"
                    )));
                }
            };
            Ok(vec![Target {
                kind,
                id: source_id.to_owned(),
            }])
        }
        _ => Ok(Vec::new()),
    }
}

pub async fn handle(ingest: &Ingest, kind: &str, raw: &Value) -> Result<(), IngestError> {
    let event: Event<Payload> = Event::parse(raw)?;
    let payload = &event.payload;
    required(&payload.organization_id, "organizationId")?;
    required(&payload.project_id, "projectId")?;

    match kind {
        "artifact.created" => {
            let artifact = payload
                .artifact
                .as_ref()
                .ok_or_else(|| IngestError::rejected("artifact is required"))?;
            if artifact.organization_id != payload.organization_id
                || artifact
                    .project_id
                    .as_ref()
                    .is_some_and(|project| *project != payload.project_id)
            {
                return Err(IngestError::rejected(
                    "artifact tenant does not match payload",
                ));
            }
            required(&event.aggregate_id, "aggregateId")?;
            if !matches!(artifact.kind.as_str(), "QA_PAIR" | "INSIGHT")
                || artifact.generate_embedding == Some(false)
            {
                return Ok(());
            }
            for target in targets(artifact, &event.aggregate_id)? {
                store::append_enrichment(
                    &ingest.pool,
                    &payload.organization_id,
                    &payload.project_id,
                    &target.id,
                    target.kind,
                    (&event.aggregate_id, &artifact.kind),
                )
                .await?;
            }
            Ok(())
        }
        // A partial update names no target and changes no reference.
        "artifact.updated" => match payload.update {
            Some(Value::Object(_)) => Ok(()),
            _ => Err(IngestError::rejected("update must be an object")),
        },
        _ => {
            if payload.artifact_id.as_deref() != Some(event.aggregate_id.as_str()) {
                return Err(IngestError::rejected(
                    "artifactId must match the aggregate id",
                ));
            }
            required(&event.aggregate_id, "aggregateId")?;
            store::remove_enrichment(
                &ingest.pool,
                &payload.organization_id,
                &payload.project_id,
                &event.aggregate_id,
            )
            .await?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn artifact(value: Value) -> Artifact {
        let mut base = json!({"organizationId": "org", "type": "QA_PAIR",
            "sourceType": "CONVERSATION", "sourceId": "source"});
        base.as_object_mut()
            .unwrap()
            .extend(value.as_object().unwrap().clone());
        serde_json::from_value(base).unwrap()
    }

    fn qa_data(user: &str, system: &str) -> Value {
        json!({"type": "QA_PAIR", "question": "q", "answer": "a",
               "userMessageId": user, "systemMessageId": system})
    }

    #[test]
    fn a_qa_pair_enriches_both_messages_once() {
        let pair = artifact(json!({"data": qa_data(" u ", "u")}));
        assert_eq!(
            targets(&pair, "a").unwrap(),
            [Target {
                kind: "message",
                id: "u".into()
            }]
        );
        let pair = artifact(json!({"data": qa_data("u", "s")}));
        assert_eq!(targets(&pair, "a").unwrap().len(), 2);
    }

    #[test]
    fn a_qa_pair_without_a_message_is_rejected() {
        let blank = qa_data(" ", "");
        assert!(targets(&artifact(json!({"data": blank})), "a").is_err());
        assert!(targets(&artifact(json!({})), "a").is_err());
    }

    #[test]
    fn a_malformed_qa_pair_is_rejected() {
        let without = |field: &str| {
            let mut data = qa_data("u", "s");
            data.as_object_mut().unwrap().remove(field);
            data
        };
        let mut wrong_type = qa_data("u", "s");
        wrong_type["type"] = json!("INSIGHT");
        let mut numeric_message = qa_data("u", "s");
        numeric_message["userMessageId"] = json!(7);

        let malformed = [
            without("type"),
            without("question"),
            without("answer"),
            without("userMessageId"),
            without("systemMessageId"),
            wrong_type,
            numeric_message,
            json!("not an object"),
        ];
        for data in malformed {
            assert!(
                targets(&artifact(json!({"data": data})), "a").is_err(),
                "accepted {data}"
            );
        }
    }

    #[test]
    fn an_insight_enriches_its_source() {
        let insight = |source_type: &str, source_id: &str| {
            artifact(json!({"type": "INSIGHT", "sourceType": source_type, "sourceId": source_id}))
        };
        assert_eq!(
            targets(&insight("TASK", "t"), "a").unwrap(),
            [Target {
                kind: "task",
                id: "t".into()
            }]
        );
        assert!(
            targets(&insight("INITIATIVE", "i"), "a")
                .unwrap()
                .is_empty()
        );
        assert!(targets(&insight("SYSTEM", "s"), "a").is_err());
        assert!(targets(&insight("TASK", " "), "a").is_err());
    }

    #[test]
    fn insight_data_must_match_its_schema_when_present() {
        let insight = |data: Value| {
            artifact(
                json!({"type": "INSIGHT", "sourceType": "TASK", "sourceId": "t",
                            "data": data}),
            )
        };
        let valid = json!({"type": "INSIGHT", "confidence": 0.5, "reasoning": "r", "content": "c"});
        assert_eq!(targets(&insight(valid.clone()), "a").unwrap().len(), 1);

        for field in ["type", "confidence", "reasoning", "content"] {
            let mut data = valid.clone();
            data.as_object_mut().unwrap().remove(field);
            assert!(targets(&insight(data), "a").is_err(), "missing {field}");
        }
    }

    #[test]
    fn other_artifact_types_enrich_nothing() {
        assert!(
            targets(&artifact(json!({"type": "DOCUMENT"})), "a")
                .unwrap()
                .is_empty()
        );
    }
}
