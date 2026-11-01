//! Search events against a real database, the real encoder and Redis.
//! Run with `pnpm test:database` after `scripts/fetch-model.sh`; the Redis
//! test also needs `GRAPH_SEARCH_TEST_REDIS_URL`.

mod common;
use std::time::Duration;

use axum::{
    Extension,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use hey_hey_graph_search::{
    config::Config,
    database::connect_and_migrate,
    search::{
        encoder::Encoder,
        ingest::{Ingest, config::EventsConfig, consumer::Consumer, error::IngestError},
        routes::SearchState,
    },
    server,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use redis::AsyncCommands;
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

const ORG: &str = "6c1f4d5e-6c1a-4b7e-9a51-3f2b8f1d0b01";
const PROJECT: &str = "6c1f4d5e-6c1a-4b7e-9a51-3f2b8f1d0b02";
const MARKER: &str = "6c1f4d5e-6c1a-4b7e-9a51-3f2b8f1d0b03";
const TASK: &str = "6c1f4d5e-6c1a-4b7e-9a51-3f2b8f1d0c01";
const CHILD: &str = "6c1f4d5e-6c1a-4b7e-9a51-3f2b8f1d0c02";
const OTHER_TASK: &str = "6c1f4d5e-6c1a-4b7e-9a51-3f2b8f1d0c03";
/// A project-defined type key; it must reach search exactly as written.
const TYPE_KEY: &str = "ResearchFinding";

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn user_token() -> String {
    let claims = json!({
        "sub": "user", "currentOrgId": ORG,
        "orgMemberships": [{"orgId": ORG, "role": "OWNER"}], "exp": now() + 300
    });
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key".into());
    let key = EncodingKey::from_rsa_pem(include_bytes!("fixtures/signing.pem")).unwrap();
    encode(&header, &claims, &key).unwrap()
}

fn section(key: &str, order: i64, content: &str) -> Value {
    json!({"key": key, "order": order, "materializedMarkdown": content})
}

fn context(kind: &str) -> Value {
    json!({
        "payloadType": kind, "organizationId": ORG, "projectId": PROJECT,
        "timestamp": "2026-11-01T10:00:00.000Z"
    })
}

fn envelope(kind: &str, aggregate_id: &str, payload: Value) -> Value {
    json!({"event": {"id": format!("evt-{kind}-{aggregate_id}"), "type": kind,
                     "aggregateId": aggregate_id, "payload": payload}})
}

fn task_snapshot(id: &str, name: &str, task_type: &str, sections: Vec<Value>) -> Value {
    json!({
        "id": id, "name": name, "description": "", "type": task_type, "sections": sections,
        "status": "ACTIVE", "priority": "HIGH", "organizationId": ORG, "projectId": PROJECT,
        "createdAt": "2026-11-01T09:00:00.000Z", "updatedAt": "2026-11-01T09:00:00.000Z"
    })
}

fn created(id: &str, name: &str, task_type: &str, sections: Vec<Value>) -> Value {
    let mut payload = context("task.created");
    payload["task"] = task_snapshot(id, name, task_type, sections);
    envelope("task.created", id, payload)
}

fn content_changed(id: &str, task_type: &str, sections: Vec<Value>) -> Value {
    let mut payload = context("task.content_changed");
    payload["content"] = json!({"type": task_type, "description": "", "sections": sections});
    envelope("task.content_changed", id, payload)
}

struct Search {
    router: axum::Router,
    token: String,
}

impl Search {
    async fn hits(&self, request: Value) -> Vec<Value> {
        let path = format!("/orgs/{ORG}/projects/{PROJECT}/embeddings/search");
        let request = Request::builder()
            .method("POST")
            .uri(path)
            .header("Authorization", format!("Bearer {}", self.token))
            .header("Content-Type", "application/json")
            .body(Body::from(request.to_string()))
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        body["data"].as_array().unwrap().clone()
    }

    /// Ids of tasks whose searchable text contains the words.
    async fn find(&self, words: &str) -> Vec<String> {
        let request = json!({"query": words, "search_type": "keyword", "similarity_threshold": 0});
        self.hits(request)
            .await
            .iter()
            .map(|hit| hit["metadata"]["id"].as_str().unwrap().to_owned())
            .collect()
    }
}

async fn setup() -> anyhow::Result<(Ingest, Search, PgPool)> {
    let url = std::env::var("GRAPH_SEARCH_TEST_DATABASE_URL")?;
    let config =
        Config::from_lookup(|key| Ok((key == "GRAPH_SEARCH_DATABASE_URL").then(|| url.clone())))?;
    let pool = connect_and_migrate(&config).await?;
    sqlx::query("DELETE FROM search.unit WHERE organization_id = $1")
        .bind(ORG)
        .execute(&pool)
        .await?;
    sqlx::query("DELETE FROM search.projection_deletion WHERE organization_id = $1")
        .bind(ORG)
        .execute(&pool)
        .await?;

    let encoder = Encoder::load(&config.search.encoder)?;
    let state = SearchState {
        pool: pool.clone(),
        encoder: encoder.clone(),
        model: config.search.encoder.model.clone(),
    };
    let router = server::router(&config, pool.clone(), common::auth()).layer(Extension(state));
    let search = Search {
        router,
        token: user_token(),
    };
    Ok((Ingest::new(pool.clone(), encoder), search, pool))
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL 17 database and the downloaded model; see README"]
async fn work_item_events_keep_searchable_text_current() -> anyhow::Result<()> {
    let (ingest, search, pool) = setup().await?;

    // A created item is findable under its identity and exact type key, and
    // inert HTML contributes its text but not its styling.
    let mockup = json!({
        "html": "<main><h1>Checkout summary</h1><script>tracker()</script></main>",
        "css": ".summary { content: 'zebrastripes' }"
    });
    ingest
        .handle(&created(
            TASK,
            "Invoice export",
            TYPE_KEY,
            vec![
                section("description", 1, "Customers export **quarterly** ledgers."),
                section("preview", 2, &mockup.to_string()),
            ],
        ))
        .await?;
    assert_eq!(search.find("quarterly ledgers").await, [TASK]);
    assert_eq!(search.find("checkout summary").await, [TASK]);
    assert!(search.find("zebrastripes").await.is_empty());
    assert!(search.find("tracker").await.is_empty());
    let hits = search
        .hits(json!({"query": "ledgers", "search_type": "keyword", "similarity_threshold": 0}))
        .await;
    assert_eq!(hits[0]["metadata"]["taskType"], TYPE_KEY);

    // Repeating an event converges on the same single searchable unit.
    ingest
        .handle(&created(
            TASK,
            "Invoice export",
            TYPE_KEY,
            vec![
                section("description", 1, "Customers export **quarterly** ledgers."),
                section("preview", 2, &mockup.to_string()),
            ],
        ))
        .await?;
    let units: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM search.unit WHERE organization_id = $1 AND document_id = $2",
    )
    .bind(ORG)
    .bind(TASK)
    .fetch_one(&pool)
    .await?;
    assert_eq!(units, 1);

    // Changing a section replaces what was searchable.
    ingest
        .handle(&content_changed(
            TASK,
            TYPE_KEY,
            vec![section(
                "description",
                1,
                "Customers export yearly statements.",
            )],
        ))
        .await?;
    assert!(search.find("quarterly ledgers").await.is_empty());
    assert!(search.find("checkout summary").await.is_empty());
    assert_eq!(search.find("yearly statements").await, [TASK]);

    // A malformed section payload is rejected as a whole: the earlier
    // searchable text stays and none of the event's wording is indexed.
    let broken_html = r#"{"html": "<p>x</p>", "css": 4}"#;
    let truncated = r#"{"html": "<p>x</p>""#;
    let empty_size_key = r#"{"html": "<p>x</p>", "css": "", "sizeKey": ""}"#;
    let bad_annotation = r#"{"html": "<p>x</p>", "css": "", "annotations": [42]}"#;
    for content in [broken_html, truncated, empty_size_key, bad_annotation] {
        let rejected = ingest
            .handle(&content_changed(
                TASK,
                TYPE_KEY,
                vec![
                    section("description", 1, "Replacement wording."),
                    section("preview", 2, content),
                ],
            ))
            .await;
        assert!(
            matches!(rejected, Err(IngestError::Rejected(_))),
            "{content}"
        );
    }
    let mut not_text = content_changed(
        TASK,
        TYPE_KEY,
        vec![section("description", 1, "Replacement wording.")],
    );
    not_text["event"]["payload"]["content"]["sections"][0]["materializedMarkdown"] = json!(3);
    assert!(matches!(
        ingest.handle(&not_text).await,
        Err(IngestError::Rejected(_))
    ));
    assert_eq!(search.find("yearly statements").await, [TASK]);
    assert!(search.find("replacement wording").await.is_empty());

    // A cleared section leaves nothing derived from it; the name remains.
    ingest
        .handle(&content_changed(TASK, TYPE_KEY, vec![]))
        .await?;
    assert!(search.find("yearly statements").await.is_empty());
    assert_eq!(search.find("invoice export").await, [TASK]);

    // A malformed event is rejected and recorded without affecting other items.
    ingest
        .handle(&created(
            OTHER_TASK,
            "Kept item",
            "STANDARD",
            vec![section("description", 1, "Stays searchable.")],
        ))
        .await?;
    let mut malformed = created(CHILD, "Broken", "STANDARD", vec![]);
    malformed["event"]["payload"]["task"]["sections"] = json!("not a list");
    assert!(matches!(
        ingest.handle(&malformed).await,
        Err(IngestError::Rejected(_))
    ));
    let mut mismatched = created(CHILD, "Broken", "STANDARD", vec![]);
    mismatched["event"]["aggregateId"] = json!(OTHER_TASK);
    assert!(matches!(
        ingest.handle(&mismatched).await,
        Err(IngestError::Rejected(_))
    ));
    assert_eq!(search.find("stays searchable").await, [OTHER_TASK]);

    // Metadata changes reach filters without re-encoding the text.
    let mut status = context("task.status_changed");
    status["previousStatus"] = json!("ACTIVE");
    status["newStatus"] = json!("COMPLETED");
    ingest
        .handle(&envelope("task.status_changed", OTHER_TASK, status))
        .await?;
    let completed = search
        .hits(json!({"query": "stays searchable", "search_type": "keyword", "similarity_threshold": 0, "filters": {"status": "COMPLETED"}}))
        .await;
    assert_eq!(completed.len(), 1);

    // Archiving removes the item and the tasks nested under it.
    let mut child = created(
        CHILD,
        "Nested step",
        "STANDARD",
        vec![section("description", 1, "Nested wording.")],
    );
    child["event"]["payload"]["task"]["parentTaskId"] = json!(TASK);
    ingest.handle(&child).await?;
    assert_eq!(search.find("nested wording").await, [CHILD]);
    let mut archived = context("task.archived");
    archived["archivedAt"] = json!("2026-11-01T11:00:00.000Z");
    ingest
        .handle(&envelope("task.archived", TASK, archived))
        .await?;
    assert!(search.find("invoice export").await.is_empty());
    assert!(search.find("nested wording").await.is_empty());
    assert_eq!(search.find("stays searchable").await, [OTHER_TASK]);

    // A closed organization loses its content and accepts no more.
    let closed = envelope(
        "organization.closed",
        ORG,
        json!({
            "payloadType": "organization.closed", "organizationId": ORG, "markerId": MARKER,
            "irreversibleClosureAt": "2026-11-01T12:00:00.000Z",
            "deletionDeadline": "2026-12-01T12:00:00.000Z"
        }),
    );
    ingest.handle(&closed).await?;
    ingest.handle(&closed).await?;
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM search.unit WHERE organization_id = $1")
            .bind(ORG)
            .fetch_one(&pool)
            .await?;
    assert_eq!(remaining, 0);
    let late = created(
        TASK,
        "Late",
        "STANDARD",
        vec![section("description", 1, "Too late.")],
    );
    assert!(matches!(
        ingest.handle(&late).await,
        Err(IngestError::Rejected(_))
    ));
    Ok(())
}

#[tokio::test]
#[ignore = "requires PostgreSQL, the model and GRAPH_SEARCH_TEST_REDIS_URL; see README"]
async fn redis_events_become_searchable_in_order() -> anyhow::Result<()> {
    let (ingest, search, _) = setup().await?;
    let redis_url = std::env::var("GRAPH_SEARCH_TEST_REDIS_URL")?;
    // A private channel prefix keeps this test apart from any real API.
    let prefix = format!("test-{}:", uuid_like());
    let consumer = Consumer::start(
        EventsConfig {
            redis_url: redis_url.clone(),
            channel_prefix: prefix.clone(),
            lanes: 2,
            lane_capacity: 8,
        },
        ingest,
    );
    tokio::time::sleep(Duration::from_millis(500)).await;

    let connection = redis::Client::open(redis_url)?
        .get_multiplexed_async_connection()
        .await?;
    let publish = |kind: &'static str, envelope: Value| {
        let channel = format!("{prefix}{kind}");
        let mut connection = connection.clone();
        async move {
            connection
                .publish::<_, _, i64>(channel, envelope.to_string())
                .await
        }
    };

    // Two events for one item, published back to back, apply in that order.
    publish(
        "task.created",
        created(
            TASK,
            "Queued item",
            "STANDARD",
            vec![section("description", 1, "Initial draft paragraph.")],
        ),
    )
    .await?;
    publish(
        "task.content_changed",
        content_changed(
            TASK,
            "STANDARD",
            vec![section("description", 1, "Revised copy sentence.")],
        ),
    )
    .await?;
    // An unparsable event does not stop the lane.
    publish("task.created", json!({"event": {"type": "task.created"}})).await?;

    let mut found = false;
    for _ in 0..100 {
        if search.find("revised copy sentence").await == [TASK] {
            found = true;
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(found, "the latest content never became searchable");
    assert!(search.find("initial draft paragraph").await.is_empty());

    consumer.stop().await;
    Ok(())
}

fn uuid_like() -> String {
    format!(
        "{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    )
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL and downloaded model"]
async fn knowledge_lifecycles_replace_preserve_remove_and_restore() -> anyhow::Result<()> {
    let (ingest, search, _pool) = setup().await?;
    for (family, key, removal) in [
        ("design_doc", "designDoc", "archived"),
        ("service", "service", "archived"),
        ("implementation_hint", "implementationHint", "deleted"),
    ] {
        let mut snapshot = json!({"id": TASK, "organizationId": ORG,
            "name": "Quasar manual", "summary": "quasar", "description": "quasar",
            "status": "READY", "serviceId": CHILD, "featureName": "Quasar manual",
            "sourceType": "USER", "agentSessionId": OTHER_TASK,
            "createdAt": "2026-11-01T09:00:00Z", "updatedAt": "2026-11-01T10:00:00Z",
            "sections": [section("details", 0, "quasar sectiononlynebula") ]});
        let make = |action: &str, snapshot: Value| {
            let kind = format!("{family}.{action}");
            let mut payload = context(&kind);
            if action == "deleted" {
                payload["implementationHintId"] = json!(TASK);
            } else {
                payload[key] = snapshot;
            }
            envelope(&kind, TASK, payload)
        };
        ingest.handle(&make("created", snapshot.clone())).await?;
        ingest.handle(&make("created", snapshot.clone())).await?;
        assert_eq!(search.find("quasar").await, [TASK]);
        if family != "design_doc" {
            let hits = search
                .hits(
                    json!({"query": "quasar", "search_type": "keyword", "similarity_threshold": 0}),
                )
                .await;
            let metadata = hits[0]["metadata"].clone();
            for valid in [false, true] {
                let mut metadata = metadata.clone();
                if !valid {
                    metadata
                        .as_object_mut()
                        .unwrap()
                        .remove(if family == "service" {
                            "name"
                        } else {
                            "serviceId"
                        });
                }
                let request = Request::builder().method("POST").uri("/embeddings")
                    .header("Authorization", format!("Bearer {}", search.token))
                    .header("Content-Type", "application/json")
                    .body(Body::from(json!({"text": "quasar sectiononlynebula", "metadata": metadata, "level": "document"}).to_string()))?;
                let response = search.router.clone().oneshot(request).await?;
                assert_eq!(
                    response.status(),
                    if valid {
                        StatusCode::CREATED
                    } else {
                        StatusCode::BAD_REQUEST
                    }
                );
                assert_eq!(search.find("quasar").await, [TASK]);
            }
        }
        let mut invalid = snapshot.clone();
        invalid["id"] = json!(CHILD);
        assert!(ingest.handle(&make("updated", invalid)).await.is_err());
        assert_eq!(search.find("quasar").await, [TASK]);
        if family == "design_doc" {
            // A missing or null full snapshot must never replace indexed sections.
            for action in ["created", "content_changed", "restored"] {
                for sections in [None, Some(Value::Null)] {
                    let mut invalid = snapshot.clone();
                    invalid.as_object_mut().unwrap().remove("sections");
                    if let Some(sections) = sections {
                        invalid["sections"] = sections;
                    }
                    let result = ingest.handle(&make(action, invalid)).await;
                    assert!(matches!(result, Err(IngestError::Rejected(_))));
                    assert_eq!(search.find("quasar").await, [TASK]);
                    assert_eq!(search.find("sectiononlynebula").await, [TASK]);
                }
            }
            let mut metadata_only = snapshot.clone();
            metadata_only.as_object_mut().unwrap().remove("sections");
            ingest.handle(&make("updated", metadata_only)).await?;
            assert_eq!(search.find("sectiononlynebula").await, [TASK]);
        }
        snapshot["name"] = json!("Pulsar manual");
        snapshot["featureName"] = json!("Pulsar manual");
        snapshot["summary"] = json!("pulsar");
        snapshot["description"] = json!("pulsar");
        snapshot["sections"] = json!([section("details", 0, "pulsar")]);
        ingest.handle(&make("updated", snapshot.clone())).await?;
        if family == "design_doc" {
            assert_eq!(search.find("quasar").await, [TASK]);
            ingest
                .handle(&make("content_changed", snapshot.clone()))
                .await?;
        }
        assert!(search.find("quasar").await.is_empty());
        assert_eq!(search.find("pulsar").await, [TASK]);
        ingest.handle(&make(removal, snapshot.clone())).await?;
        ingest.handle(&make(removal, snapshot.clone())).await?;
        assert!(search.find("pulsar").await.is_empty());
        if family == "design_doc" {
            ingest.handle(&make("restored", snapshot.clone())).await?;
            assert_eq!(search.find("pulsar").await, [TASK]);
            let mut cleared = snapshot.clone();
            cleared["sections"] = json!([]);
            ingest.handle(&make("content_changed", cleared)).await?;
            assert!(search.find("details").await.is_empty());
            ingest.handle(&make(removal, snapshot)).await?;
        }
    }
    Ok(())
}
