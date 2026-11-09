//! Search surface against a real database and the real encoder.
//! Run with `pnpm test:database` after `scripts/fetch-model.sh`.

mod common;
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
        ingest::{Ingest, error::IngestError},
        routes::SearchState,
    },
    server,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::{Value, json};
use tower::ServiceExt;

const ORG: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a01";
const PROJECT: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a02";
const OTHER_PROJECT: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a03";
const OTHER_ORG: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a04";
const OTHER_ORG_PROJECT: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a05";
const BULK_PROJECT: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a08";
const MARKER: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a06";
const OTHER_MARKER: &str = "5b0f4d5e-6c1a-4b7e-9a51-3f2b8f1d0a07";

struct App {
    router: axum::Router,
    ingest: Ingest,
}

impl App {
    async fn call(
        &self,
        method: &str,
        path: &str,
        token: &str,
        body: Value,
    ) -> (StatusCode, Value) {
        let request = Request::builder()
            .method(method)
            .uri(path)
            .header("Authorization", format!("Bearer {token}"))
            .header("Content-Type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap();
        let response = self.router.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, value)
    }

    /// Seeds a document the way production does: through its lifecycle event.
    async fn index(&self, id: &str, project: &str, metadata: Value, text: &str) {
        self.try_index(id, project, metadata, text).await.unwrap();
    }

    async fn try_index(
        &self,
        id: &str,
        project: &str,
        metadata: Value,
        text: &str,
    ) -> Result<(), IngestError> {
        let org = if project == OTHER_ORG_PROJECT {
            OTHER_ORG
        } else {
            ORG
        };
        let name = metadata["name"].as_str().unwrap();
        let (kind, mut payload) = if metadata["type"] == "design_doc" {
            (
                "design_doc.created",
                json!({"designDoc": {
                    "id": id, "organizationId": org, "name": name, "summary": text,
                    "description": text, "status": "READY", "sourceType": "USER",
                    "sections": [{"key": "details", "order": 0, "materializedMarkdown": text}],
                    "createdAt": "2026-11-01T09:00:00Z", "updatedAt": "2026-11-01T10:00:00Z"
                }}),
            )
        } else {
            (
                "task.created",
                json!({"task": {
                    "id": id, "name": name, "description": "", "type": metadata["taskType"],
                    "sections": [{"key": "details", "order": 0, "materializedMarkdown": text}],
                    "status": "ACTIVE", "priority": "HIGH", "organizationId": org,
                    "projectId": project,
                    "createdAt": "2026-11-01T09:00:00.000Z", "updatedAt": "2026-11-01T09:00:00.000Z"
                }}),
            )
        };
        payload["payloadType"] = json!(kind);
        payload["organizationId"] = json!(org);
        payload["projectId"] = json!(project);
        payload["timestamp"] = json!("2026-11-01T10:00:00.000Z");
        let envelope = json!({"event": {
            "id": format!("evt-{kind}-{id}"), "type": kind, "aggregateId": id, "payload": payload
        }});
        self.ingest.handle(&envelope).await
    }

    async fn search(&self, token: &str, request: Value) -> Vec<String> {
        let path = format!("/orgs/{ORG}/projects/{PROJECT}/embeddings/search");
        let (status, body) = self.call("POST", &path, token, request).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        ids(&body)
    }
}

fn ids(response: &Value) -> Vec<String> {
    response["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|hit| hit["metadata"]["id"].as_str().unwrap().to_owned())
        .collect()
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}

fn token(claims: Value) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key".into());
    let key = EncodingKey::from_rsa_pem(include_bytes!("fixtures/signing.pem")).unwrap();
    encode(&header, &claims, &key).unwrap()
}

fn user(org: &str) -> String {
    token(json!({
        "sub": "user", "currentOrgId": org,
        "orgMemberships": [{"orgId": org, "role": "OWNER"}], "exp": now() + 300
    }))
}

fn deletion(marker: &str) -> String {
    token(json!({
        "sub": "system:projection-deletion", "organizationId": ORG, "markerId": marker,
        "scopes": ["organization:projection:delete"], "aud": "embeddings-service", "exp": now() + 300
    }))
}

fn task(name: &str, task_type: &str) -> Value {
    json!({"type": "task", "taskType": task_type, "name": name, "status": "ACTIVE"})
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL 17 database and the downloaded model; see README"]
async fn search_finds_text_and_meaning_within_the_callers_tenant_and_deletion_removes_it()
-> anyhow::Result<()> {
    let url = std::env::var("GRAPH_SEARCH_TEST_DATABASE_URL")?;
    let config =
        Config::from_lookup(|key| Ok((key == "GRAPH_SEARCH_DATABASE_URL").then(|| url.clone())))?;
    let pool = connect_and_migrate(&config).await?;
    for org in [ORG, OTHER_ORG] {
        sqlx::query("DELETE FROM search.unit WHERE organization_id = $1")
            .bind(org)
            .execute(&pool)
            .await?;
        sqlx::query("DELETE FROM search.projection_deletion WHERE organization_id = $1")
            .bind(org)
            .execute(&pool)
            .await?;
    }
    let encoder = Encoder::load(&config.search.encoder)?;
    let state = SearchState {
        pool: pool.clone(),
        encoder: encoder.clone(),
        model: config.search.encoder.model.clone(),
    };
    let api = common::project_api(&[PROJECT, BULK_PROJECT]).await;
    let app = App {
        router: server::router(&config, pool.clone(), api.auth.clone()).layer(Extension(state)),
        ingest: Ingest::new(pool.clone(), encoder),
    };
    let alice = user(ORG);

    app.index(
        "billing",
        PROJECT,
        task("Monthly invoices", "STANDARD"),
        "Customers download their monthly invoices as PDF files from the billing page.",
    )
    .await;
    app.index(
        "password",
        PROJECT,
        task("Password reset", "STANDARD"),
        "Users who forget their password receive an email link to choose a new one.",
    )
    .await;
    app.index(
        "roadmap",
        PROJECT,
        task("Roadmap planning", "FEATURE"),
        "Teams arrange upcoming features into quarterly milestones.",
    )
    .await;
    app.index(
        "onboarding",
        PROJECT,
        json!({"type": "design_doc", "name": "Onboarding checklist"}),
        "New workspace owners follow a checklist to invite teammates and import data.",
    )
    .await;
    app.index(
        "other-project-invoices",
        OTHER_PROJECT,
        task("Invoice archive", "STANDARD"),
        "Monthly invoices are archived for seven years.",
    )
    .await;
    app.index(
        "other-org-invoices",
        OTHER_ORG_PROJECT,
        task("Invoice reminders", "STANDARD"),
        "Monthly invoices trigger reminder emails.",
    )
    .await;

    // Text that appears in a unit finds it, and only inside the caller's project.
    let hits = app
        .search(
            &alice,
            json!({"query": "monthly invoices", "similarity_threshold": 0}),
        )
        .await;
    assert_eq!(
        hits.first().map(String::as_str),
        Some("billing"),
        "{hits:?}"
    );
    assert!(!hits.iter().any(|id| id.starts_with("other-")), "{hits:?}");

    // Related wording finds a unit by meaning.
    let hits = app
        .search(
            &alice,
            json!({"query": "I lost my login credentials", "search_type": "semantic"}),
        )
        .await;
    assert_eq!(
        hits.first().map(String::as_str),
        Some("password"),
        "{hits:?}"
    );

    // Filters narrow the results.
    let hits = app
        .search(&alice, json!({"query": "workspace", "similarity_threshold": 0, "filters": {"type": "design_doc"}}))
        .await;
    assert_eq!(hits, ["onboarding"]);
    let hits = app
        .search(&alice, json!({"query": "features", "similarity_threshold": 0, "filters": {"taskTypes": ["FEATURE"]}}))
        .await;
    assert_eq!(hits, ["roadmap"]);
    let hits = app
        .search(&alice, json!({"query": "invoices password roadmap", "similarity_threshold": 0, "filters": {"excludeTaskTypes": ["STANDARD"]}}))
        .await;
    assert!(
        !hits.iter().any(|id| id == "billing" || id == "password"),
        "{hits:?}"
    );

    // Pagination pages through the same ordering.
    let all = app
        .search(
            &alice,
            json!({"query": "customers and teams", "similarity_threshold": 0, "max_results": 4}),
        )
        .await;
    let second = app
        .search(&alice, json!({"query": "customers and teams", "similarity_threshold": 0, "max_results": 1, "offset": 1}))
        .await;
    assert_eq!(second, all[1..2]);

    // GET search and structured search read the same store.
    let path = format!(
        "/orgs/{ORG}/projects/{PROJECT}/embeddings/search?q=invoices&threshold=0&entityType=task"
    );
    let (status, body) = app.call("GET", &path, &alice, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(ids(&body).first().map(String::as_str), Some("billing"));
    let path = format!("/orgs/{ORG}/projects/{PROJECT}/embeddings/search/structured");
    let (status, body) = app
        .call("POST", &path, &alice, json!({"must": ["invoices"], "emb_query": "billing documents", "similarity_threshold": 0}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(ids(&body), ["billing"]);

    // Structured searches without text for the requested signal use the other field's text.
    let (status, body) = app
        .call(
            "POST",
            &path,
            &alice,
            json!({"must": ["invoices"], "search_type": "semantic", "similarity_threshold": 0}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(ids(&body), ["billing"]);
    let (status, body) = app
        .call("POST", &path, &alice, json!({"emb_query": "password email link", "search_type": "keyword", "similarity_threshold": 0}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        ids(&body).first().map(String::as_str),
        Some("password"),
        "{body}"
    );

    // Pagination reaches matches beyond the first 200.
    sqlx::query(
        "INSERT INTO search.unit (organization_id, project_id, id, document_id, chunk_index,
                                  type, task_type, title, text, metadata, embedding)
         SELECT $1, $2, 'bulk-' || n, 'bulk-' || n, 0, 'task', 'STANDARD', 'Widget ' || n,
                'Widget number ' || n, jsonb_build_object('id', 'bulk-' || n),
                ('[' || array_to_string(array_fill(0.05::real, ARRAY[384]), ',') || ']')::halfvec
         FROM generate_series(1, 205) AS n",
    )
    .bind(ORG)
    .bind(BULK_PROJECT)
    .execute(&pool)
    .await?;
    let bulk = format!("/orgs/{ORG}/projects/{BULK_PROJECT}/embeddings/search");
    let mut seen = std::collections::HashSet::new();
    for offset in [0, 100, 200] {
        let (status, body) = app
            .call("POST", &bulk, &alice, json!({"query": "widget", "search_type": "keyword", "similarity_threshold": 0, "max_results": 100, "offset": offset}))
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        let page = ids(&body);
        assert_eq!(
            page.len(),
            if offset == 200 { 5 } else { 100 },
            "offset {offset}"
        );
        seen.extend(page);
    }
    assert_eq!(seen.len(), 205);

    // A batch answers each query in order and keeps its identifier.
    let path = format!("/orgs/{ORG}/projects/{PROJECT}/embeddings/search/batch");
    let (status, body) = app
        .call(
            "POST",
            &path,
            &alice,
            json!({"queries": [
                {"query_id": "a", "query": "invoices", "similarity_threshold": 0},
                {"query_id": "b", "query": "password email link", "similarity_threshold": 0}
            ]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["results"][0]["query_id"], "a");
    assert_eq!(body["results"][1]["data"][0]["metadata"]["id"], "password");

    // Filters cannot widen the request to another project or organization.
    let path = format!("/orgs/{ORG}/projects/{PROJECT}/embeddings/search");
    let (status, _) = app
        .call(
            "POST",
            &path,
            &alice,
            json!({"query": "invoices", "filters": {"projectId": OTHER_PROJECT}}),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = app
        .call(
            "POST",
            "/embeddings/search",
            &alice,
            json!({"query": "invoices", "filters": {"organizationId": OTHER_ORG}}),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // A member of the organization reads only the projects the API currently grants,
    // matching the deployed Embeddings service.
    let path = format!("/orgs/{ORG}/projects/{OTHER_PROJECT}/embeddings/search");
    let (status, _) = app
        .call("POST", &path, &alice, json!({"query": "invoices"}))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let unscoped = json!({"query": "monthly invoices", "similarity_threshold": 0,
                          "max_results": 50, "filters": {"organizationId": ORG}});
    let (status, body) = app
        .call("POST", "/embeddings/search", &alice, unscoped.clone())
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let hits = ids(&body);
    assert!(hits.iter().any(|id| id == "billing"), "{hits:?}");
    assert!(!hits.iter().any(|id| id.starts_with("other-")), "{hits:?}");

    // Removing membership takes effect for the same token on its next request.
    let granted = std::mem::take(&mut *api.projects.write().unwrap());
    let path = format!("/orgs/{ORG}/projects/{PROJECT}/embeddings/search");
    let (status, _) = app
        .call("POST", &path, &alice, json!({"query": "invoices"}))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = app
        .call("POST", "/embeddings/search", &alice, unscoped)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(ids(&body), Vec::<String>::new());
    *api.projects.write().unwrap() = granted;

    // Rewriting a document replaces its text; the old words no longer find it.
    app.index(
        "billing",
        PROJECT,
        task("Monthly invoices", "STANDARD"),
        "Statements are emailed to the account owner.",
    )
    .await;
    let hits = app
        .search(&alice, json!({"query": "PDF billing page", "search_type": "keyword", "similarity_threshold": 0}))
        .await;
    assert!(!hits.iter().any(|id| id == "billing"), "{hits:?}");

    // Projection deletion accepts only the search deletion credential.
    let command = json!({
        "organizationId": ORG, "markerId": MARKER,
        "irreversibleClosureAt": "2026-10-01T00:00:00Z", "deletionDeadline": "2026-11-01T00:00:00Z"
    });
    let path = format!("/orgs/{ORG}/projection-deletion");
    let (status, _) = app.call("POST", &path, &alice, command.clone()).await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    let (status, body) = app
        .call("POST", &path, &deletion(MARKER), command.clone())
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["tombstoneRecorded"], true);
    assert_eq!(body["contentVerificationCompleted"], true);
    let remaining: i64 =
        sqlx::query_scalar("SELECT count(*) FROM search.unit WHERE organization_id = $1")
            .bind(ORG)
            .fetch_one(&pool)
            .await?;
    assert_eq!(remaining, 0);
    let others: i64 =
        sqlx::query_scalar("SELECT count(*) FROM search.unit WHERE organization_id = $1")
            .bind(OTHER_ORG)
            .fetch_one(&pool)
            .await?;
    assert_eq!(others, 1);

    // An identical retry succeeds; a different identity cannot replace the tombstone.
    let (status, _) = app
        .call("POST", &path, &deletion(MARKER), command.clone())
        .await;
    assert_eq!(status, StatusCode::OK);
    let mut conflicting = command.clone();
    conflicting["markerId"] = json!(OTHER_MARKER);
    let (status, body) = app
        .call("POST", &path, &deletion(OTHER_MARKER), conflicting)
        .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(body["retainedIdentity"]["markerId"], MARKER);

    // A closed organization accepts no new content.
    assert!(
        app.try_index("late", PROJECT, task("Late", "STANDARD"), "late write")
            .await
            .is_err()
    );

    pool.close().await;
    Ok(())
}
