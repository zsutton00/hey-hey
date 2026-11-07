//! Core Graph guarantees at the authenticated HTTP boundary, using a disposable PostgreSQL database.
mod common;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use hey_hey_graph_search::{
    config::Config,
    database,
    graph::store::{self, Node, Scope},
    server,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::{Value, json};
use sqlx::PgPool;
use tower::ServiceExt;

fn id(number: u64) -> String {
    format!("40000000-0000-4000-8000-{number:012x}")
}
struct Fixture {
    pool: PgPool,
    app: axum::Router,
    scope: Scope,
}
impl Fixture {
    async fn new(project: u64) -> anyhow::Result<Self> {
        let url = std::env::var("GRAPH_SEARCH_TEST_DATABASE_URL")?;
        let config = Config::from_lookup(|key| {
            Ok((key == "GRAPH_SEARCH_DATABASE_URL").then(|| url.clone()))
        })?;
        let pool = database::connect_and_migrate(&config).await?;
        let scope = Scope {
            organization: id(1),
            project: id(project),
        };
        sqlx::query("DELETE FROM graph.node WHERE organization_id=$1 AND project_id=$2")
            .bind(&scope.organization)
            .bind(&scope.project)
            .execute(&pool)
            .await?;
        sqlx::query("DELETE FROM graph.event_receipt WHERE organization_id=$1 AND project_id=$2")
            .bind(&scope.organization)
            .bind(&scope.project)
            .execute(&pool)
            .await?;
        let app = server::router(&config, pool.clone(), common::auth());
        Ok(Self { pool, app, scope })
    }
    fn token(&self, org: &str, projects: Vec<String>) -> String {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("test-key".into());
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        encode(
            &header,
            &json!({"sub":"fixture","currentOrgId":org,"project_ids":projects,"exp":now+300}),
            &EncodingKey::from_rsa_pem(include_bytes!("fixtures/signing.pem")).unwrap(),
        )
        .unwrap()
    }
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
            .header("authorization", format!("Bearer {token}"))
            .header("content-type", "application/json")
            .body(if body.is_null() {
                Body::empty()
            } else {
                Body::from(body.to_string())
            })
            .unwrap();
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        (
            status,
            serde_json::from_slice(&bytes).unwrap_or(Value::Null),
        )
    }
    async fn query(&self, route: &str, body: Value) -> Value {
        let path = format!(
            "/api/organizations/{}/projects/{}/{route}",
            self.scope.organization, self.scope.project
        );
        let method = if route == "topology" || route.contains("/provenance") {
            "GET"
        } else {
            "POST"
        };
        let (status, response) = self
            .call(
                method,
                &path,
                &self.token(&self.scope.organization, vec![]),
                body,
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{response}");
        response
    }
    async fn node(&self, n: u64, kind: &str, properties: Value) -> Node {
        let label = kind
            .to_lowercase()
            .split('_')
            .map(|s| format!("{}{}", s[..1].to_uppercase(), &s[1..]))
            .collect::<String>();
        let node = Node {
            id: id(n),
            entity_type: kind.into(),
            project_scoped: true,
            labels: vec![label],
            properties,
            stub: false,
            deleted: false,
            created_at: Some("2026-10-01T00:00:00Z".into()),
            updated_at: Some("2026-10-02T00:00:00Z".into()),
        };
        store::upsert_node(&self.pool, &self.scope, &node)
            .await
            .unwrap();
        node
    }
    async fn edge(&self, a: u64, b: u64, kind: &str, properties: Value) -> String {
        sqlx::query_scalar("INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type,properties,deduplication_key) VALUES ($1,$2,$3,$4,$5,$6,$3||':'||$4||':'||$5) ON CONFLICT (organization_id,project_id,deduplication_key) DO UPDATE SET properties=EXCLUDED.properties RETURNING id")
            .bind(&self.scope.organization).bind(&self.scope.project).bind(id(a)).bind(id(b)).bind(kind).bind(properties)
            .fetch_one(&self.pool).await.unwrap()
    }
}
fn targets(value: &Value) -> Vec<String> {
    value["results"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["entityId"].as_str().unwrap().into())
        .collect()
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL 17; GRAPH_SEARCH_TEST_DATABASE_URL"]
async fn traversal_preserves_identity_groups_policies_ranking_and_scope() -> anyhow::Result<()> {
    let f = Fixture::new(100).await?;
    for n in [10, 11, 12, 13, 14, 15] {
        f.node(
            n,
            "TASK",
            json!({"name":format!("Task {n}"),"type":"STANDARD","status":"ACTIVE"}),
        )
        .await;
    }
    f.node(20, "USER", json!({"name":"User"})).await;
    let mut stub = f.node(30, "TASK", json!({"type":"STANDARD"})).await;
    stub.stub = true;
    stub.labels.push("Stub".into());
    store::upsert_node(&f.pool, &f.scope, &stub).await?;
    f.node(40, "PROJECT", json!({"name":"Project"})).await;
    for (a, b, t) in [
        (10, 11, "RELATED_TO"),
        (11, 12, "RELATED_TO"),
        (10, 20, "RELATED_TO"),
        (20, 13, "RELATED_TO"),
        (10, 30, "RELATED_TO"),
        (30, 14, "RELATED_TO"),
        (10, 40, "RELATED_TO"),
        (40, 15, "RELATED_TO"),
    ] {
        f.edge(a, b, t, json!({"source":"system"})).await;
    }
    let result=f.query("traversal",json!({"seedEntityIds":[id(10)],"traversal":{"depth":2,"direction":"OUTGOING"},"includeRelationships":true,"trackPathCount":true})).await;
    let found = targets(&result);
    assert!(found.contains(&id(12)));
    assert!(found.contains(&id(20)));
    for n in [13, 14, 15, 30] {
        assert!(!found.contains(&id(n)), "forbidden bridge/endpoint {n}");
    }
    // Organization-wide records are stored with partition ownership but are not scoped endpoints or seeds.
    let mut global = f
        .node(21, "USER", json!({"name":"Organization user"}))
        .await;
    global.project_scoped = false;
    store::upsert_node(&f.pool, &f.scope, &global).await?;
    f.edge(10, 21, "INFLUENCES", json!({"source":"system"}))
        .await;
    let global_result = f
        .query(
            "traversal",
            json!({"seedEntityIds":[id(21)],"includeSeedEntities":true}),
        )
        .await;
    assert_eq!(global_result["totalElements"], 0);
    let global_target = f
        .query(
            "traversal",
            json!({"seedEntityIds":[id(10)],"traversal":{"relationshipTypes":["INFLUENCES"]}}),
        )
        .await;
    assert_eq!(global_target["totalElements"], 0);
    let direct = f
        .query(
            "traversal",
            json!({"seedEntityIds":[id(10)],"traversal":{"depth":1},"size":1,"page":1}),
        )
        .await;
    assert_eq!(direct["results"].as_array().unwrap().len(), 1);
    assert_eq!(direct["totalElements"], 3);
    let groups=f.query("traversal",json!({"projection":"IDENTITIES_BY_SEED","seedEntityIds":[id(10),id(20),id(99),id(10)],"traversal":{"direction":"OUTGOING","depth":2}})).await;
    assert_eq!(groups.as_object().unwrap().len(), 1);
    let groups = groups["identitiesBySeed"].as_array().unwrap();
    assert_eq!(groups.len(), 4);
    assert_eq!(groups[0], groups[3]);
    assert_eq!(groups[2]["targets"], json!([]));
    assert!(
        !groups[0]["targets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["entityId"] == id(13))
    );
    assert!(
        groups[1]["targets"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["entityId"] == id(13))
    );
    assert!(
        groups[0]["targets"]
            .as_array()
            .unwrap()
            .iter()
            .all(|n| n.as_object().unwrap().len() == 2)
    );
    let expanded=f.query("traversal",json!({"projection":"IDENTITIES_BY_SEED","seedEntityIds":[id(10)],"traversal":{"depth":1,"relationshipTypes":["TRACKS"],"pathExpansions":[{"relationshipChain":[{"type":"RELATED_TO","direction":"OUTGOING"},{"type":"RELATED_TO","direction":"OUTGOING"}]}]}})).await;
    assert_eq!(
        expanded["identitiesBySeed"][0]["targets"],
        json!([{"entityId":id(12),"entityType":"TASK"}])
    );
    let compact=f.query("traversal",json!({"projection":"COMPACT_RANKED","seedEntityIds":[id(10)],"includeRelationships":true,"trackPathCount":true})).await;
    assert!(compact.get("relationships").is_none());
    assert!(
        compact["results"]
            .as_array()
            .unwrap()
            .iter()
            .all(|r| r.get("path").is_none() && r.get("pathCount").is_none())
    );
    // Parallel persisted edges are distinct paths; consensus affects ranking before paging.
    sqlx::query("INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type) VALUES ($1,$2,$3,$4,'RELATED_TO')")
        .bind(&f.scope.organization).bind(&f.scope.project).bind(id(10)).bind(id(11)).execute(&f.pool).await?;
    let ranked=f.query("traversal",json!({"seedEntityIds":[id(10)],"traversal":{"depth":1,"direction":"OUTGOING"},"trackPathCount":true,"size":1})).await;
    assert_eq!(ranked["results"][0]["entityId"], id(11));
    assert_eq!(ranked["results"][0]["pathCount"], 2);
    let expected = 0.6 - 0.15 + 0.1_f64 * 2.0_f64.ln();
    assert!((ranked["results"][0]["score"].as_f64().unwrap() - expected).abs() < 0.000001);
    let filtered=f.query("traversal",json!({"projection":"IDENTITIES_BY_SEED","seedEntityIds":[id(10)],"filters":{"entityTypes":["TASK"],"labels":["Task"],"statuses":["ACTIVE"],"updatedAtRange":{"from":"2026-10-03T00:00:00Z"}}})).await;
    assert_eq!(filtered["identitiesBySeed"][0]["targets"], json!([]));
    let forbidden = f
        .call(
            "POST",
            &format!(
                "/api/organizations/{}/projects/{}/traversal",
                f.scope.organization, f.scope.project
            ),
            &f.token(&id(2), vec![]),
            json!({"seedEntityIds":[id(10)]}),
        )
        .await;
    assert_eq!(forbidden.0, StatusCode::FORBIDDEN);
    let other = Fixture::new(101).await?;
    other
        .node(10, "TASK", json!({"name":"Other project"}))
        .await;
    other.node(99, "TASK", json!({})).await;
    other.edge(10, 99, "RELATED_TO", json!({})).await;
    let result = f
        .query("traversal", json!({"seedEntityIds":[id(10)]}))
        .await;
    assert!(!targets(&result).contains(&id(99)));
    let constrained = f
        .query(
            "traversal",
            json!({"seedEntityIds":[id(10)],"filters":{"excludeTaskTypes":["STANDARD"]}}),
        )
        .await;
    assert_eq!(constrained["totalElements"], 0);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL 17; GRAPH_SEARCH_TEST_DATABASE_URL"]
async fn batch_incident_and_deletion_preserve_metadata_and_converge() -> anyhow::Result<()> {
    let f = Fixture::new(200).await?;
    for n in [10, 11, 12] {
        f.node(
            n,
            "TASK",
            json!({"type":"STANDARD","name":format!("Node {n}")}),
        )
        .await;
    }
    let request = json!({"relationships":[{"fromArtifactId":id(10),"toArtifactId":id(11),"type":"INFLUENCES","metadata":{"reasoning":"A declared influence","confidence":0.8,"inferredBy":"llm","createdAt":"2026-10-01T00:00:00Z"}}]});
    let token = f.token(&f.scope.organization, vec![f.scope.project.clone()]);
    let first = f
        .call("POST", "/api/relationships/batch", &token, request.clone())
        .await;
    assert_eq!(first.0, StatusCode::CREATED);
    assert_eq!(first.1["summary"]["successful"], 1);
    let second = f
        .call("POST", "/api/relationships/batch", &token, request.clone())
        .await;
    assert_eq!(second.1["summary"]["failed"], 1);
    let incident=f.query("incident-edges",json!({"seedEntityIds":[id(10),id(11),id(12),id(10)],"relationshipTypes":["INFLUENCES"]})).await;
    let groups = incident["groups"].as_array().unwrap();
    assert_eq!(groups.len(), 3);
    assert_eq!(groups[0]["relationships"], groups[1]["relationships"]);
    assert_eq!(groups[2]["relationships"], json!([]));
    assert_eq!(
        groups[0]["relationships"][0]["properties"]["reasoning"],
        "A declared influence"
    );
    assert_eq!(groups[0]["relationships"][0]["id"], first.1["created"][0]);
    let relationship = &groups[0]["relationships"][0];
    let text = |value: &Value| value.as_str().unwrap().to_string();
    let endpoint_ids: std::collections::BTreeSet<String> = groups[0]["endpoints"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| text(&e["entityId"]))
        .collect();
    let relationship_ends: std::collections::BTreeSet<String> = [
        text(&relationship["sourceNodeId"]),
        text(&relationship["targetNodeId"]),
    ]
    .into_iter()
    .collect();
    assert_eq!(
        endpoint_ids, relationship_ends,
        "a group describes both ends of its relationships, including the seed"
    );
    let foreign = f
        .call(
            "POST",
            "/api/relationships/batch",
            &f.token(&id(2), vec![]),
            request,
        )
        .await;
    assert_eq!(foreign.1["summary"]["successful"], 0);
    let concurrent = json!({"relationships":[{"fromArtifactId":id(10),"toArtifactId":id(12),"type":"MENTIONS"}]});
    let (left, right) = tokio::join!(
        f.call(
            "POST",
            "/api/relationships/batch",
            &token,
            concurrent.clone()
        ),
        f.call("POST", "/api/relationships/batch", &token, concurrent)
    );
    assert_eq!(
        left.1["summary"]["successful"].as_u64().unwrap()
            + right.1["summary"]["successful"].as_u64().unwrap(),
        1
    );
    // Canonical node replacement and repeated deletion do not create orphan relationships.
    f.node(10, "TASK", json!({"type":"STANDARD","name":"Updated"}))
        .await;
    assert_eq!(store::nodes(&f.pool, &f.scope, &[id(10)]).await?.len(), 1);
    store::delete_node(&f.pool, &f.scope, &id(11)).await?;
    store::delete_node(&f.pool, &f.scope, &id(11)).await?;
    let after = f
        .query(
            "incident-edges",
            json!({"seedEntityIds":[id(10)],"relationshipTypes":["INFLUENCES"]}),
        )
        .await;
    assert_eq!(after["groups"][0]["relationships"], json!([]));
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL 17; GRAPH_SEARCH_TEST_DATABASE_URL"]
async fn neighborhood_structured_topology_and_provenance_keep_their_distinct_semantics()
-> anyhow::Result<()> {
    let f = Fixture::new(300).await?;
    f.node(10, "TASK", json!({"type":"FEATURE","name":"Parent"}))
        .await;
    for n in [11, 12, 13] {
        f.node(
            n,
            "TASK",
            json!({"type":"STANDARD","name":format!("Child {n}")}),
        )
        .await;
    }
    f.node(
        20,
        "AGENT_SESSION",
        json!({"name":"Attached session","status":"COMPLETED"}),
    )
    .await;
    for (a, b, t) in [
        (10, 11, "HAS_TASK"),
        (10, 12, "HAS_TASK"),
        (11, 13, "MENTIONS"),
        (11, 20, "HAS_AGENT_SESSION"),
    ] {
        f.edge(a, b, t, json!({"source":"system"})).await;
    }
    let one = f
        .query(
            "entity-neighborhood",
            json!({"seedEntityId":id(11),"seedEntityType":"TASK","featureIds":[id(10)],"depth":1}),
        )
        .await;
    let two = f
        .query(
            "entity-neighborhood",
            json!({"seedEntityId":id(11),"seedEntityType":"TASK","featureIds":[id(10)],"depth":2}),
        )
        .await;
    assert_eq!(one["agentSessions"].as_array().unwrap().len(), 1);
    assert!(
        !one["relatedEntities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["entityId"] == id(12))
    );
    assert!(
        two["relatedEntities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["entityId"] == id(12) && e["relationship"] == "sibling-via-parent")
    );
    assert!(
        !two["relatedEntities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["entityId"] == id(10))
    );
    let structured=f.query("traversal",json!({"projection":"STRUCTURED_READ","structuredRead":{"root":{"entityId":id(11),"entityType":"TASK"},"seeds":[],"directEdgeTypes":[],"expansions":[{"key":"siblings","seeds":[{"entityId":id(11),"entityType":"TASK"}],"path":[{"relationshipType":"HAS_TASK","direction":"INCOMING","entityTypes":["TASK"]},{"relationshipType":"HAS_TASK","direction":"OUTGOING","entityTypes":["TASK"],"workItemTypeKeys":["STANDARD"]}],"excludeRoot":true,"limit":20}]}})).await;
    let expansion = &structured["structuredRead"]["expansions"][0];
    assert_eq!(expansion["targets"].as_array().unwrap().len(), 1);
    assert_eq!(expansion["targets"][0]["identity"]["entityId"], id(12));
    assert_eq!(
        expansion["targets"][0]["paths"][0]["identities"]
            .as_array()
            .unwrap()
            .len(),
        3
    );
    f.node(300, "PROJECT", json!({"name":"Project"})).await;
    f.edge(10, 300, "SCOPED_TO_PROJECT", json!({})).await;
    let connected = f
        .query(
            "feature-project-connection",
            json!({"featureIds":[id(10),id(10),id(11)]}),
        )
        .await;
    assert_eq!(connected["connectedCount"], 1);
    f.edge(
        11,
        12,
        "DERIVES_FROM",
        json!({"source":"agent","reasoning":"Origin"}),
    )
    .await;
    f.edge(12, 13, "CREATED_VIA", json!({"source":"system"}))
        .await;
    let lineage = f
        .query(
            &format!("entities/{}/provenance?depth=2", id(11)),
            Value::Null,
        )
        .await;
    assert_eq!(lineage["depth"], 2);
    assert_eq!(lineage["edges"].as_array().unwrap().len(), 2);
    f.node(50, "CATEGORY", json!({"name":"Knowledge"})).await;
    f.node(51, "FACET", json!({"name":"Design"})).await;
    f.edge(50, 51, "HAS_FACET", json!({})).await;
    f.edge(51, 10, "HAS_KB_ENTRY", json!({})).await;
    let topology = f.query("topology", Value::Null).await;
    assert_eq!(
        topology["categories"][0]["subfacets"][0]["entities"][0]["id"],
        id(10)
    );
    assert_eq!(topology["agentEdges"].as_array().unwrap().len(), 1);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL 17; GRAPH_SEARCH_TEST_DATABASE_URL"]
async fn large_project_reads_use_adjacency_and_keep_complete_identity_groups() -> anyhow::Result<()>
{
    let f = Fixture::new(400).await?;
    f.node(10, "TASK", json!({"name":"Seed","type":"STANDARD"}))
        .await;
    sqlx::query("INSERT INTO graph.node (organization_id,project_id,id,entity_type,labels,properties,created_at,updated_at) SELECT $1,$2,'40000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'),'TASK',ARRAY['Task'],jsonb_build_object('type','STANDARD','name','Neighbor '||n),now(),now() FROM generate_series(1000,1319) n")
        .bind(&f.scope.organization).bind(&f.scope.project).execute(&f.pool).await?;
    sqlx::query("INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type) SELECT $1,$2,$3,id,'TRACKS' FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id<>$3")
        .bind(&f.scope.organization).bind(&f.scope.project).bind(id(10)).execute(&f.pool).await?;
    // Other-tenant volume must not become traversal work, even with identical IDs.
    sqlx::query("DELETE FROM graph.node WHERE organization_id=$1")
        .bind(id(500))
        .execute(&f.pool)
        .await?;
    sqlx::query("INSERT INTO graph.node (organization_id,project_id,id,entity_type,labels) SELECT $1,$2,'40000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'),'TASK',ARRAY['Task'] FROM generate_series(1,12000) n")
        .bind(id(500)).bind(id(501)).execute(&f.pool).await?;
    sqlx::query("INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type) SELECT $1,$2,id,id,'TRACKS' FROM graph.node WHERE organization_id=$1 AND project_id=$2")
        .bind(id(500)).bind(id(501)).execute(&f.pool).await?;
    sqlx::query("ANALYZE graph.node").execute(&f.pool).await?;
    sqlx::query("ANALYZE graph.edge").execute(&f.pool).await?;
    let request = json!({"projection":"IDENTITIES_BY_SEED","seedEntityIds":[id(10)],"size":1,"traversal":{"direction":"OUTGOING","depth":1,"relationshipTypes":["TRACKS"]}});
    let identities = f.query("traversal", request.clone()).await;
    assert_eq!(
        identities["identitiesBySeed"][0]["targets"]
            .as_array()
            .unwrap()
            .len(),
        320
    );
    let incident = f
        .query(
            "incident-edges",
            json!({"seedEntityIds":[id(10)],"relationshipTypes":["TRACKS"]}),
        )
        .await;
    assert_eq!(incident["groups"][0]["neighborTotal"], 320);
    // The 100 retained neighbors plus the seed, which every returned relationship also touches.
    assert_eq!(
        incident["groups"][0]["endpoints"].as_array().unwrap().len(),
        101
    );
    let sql = format!(
        "EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) {}",
        include_str!("../src/graph/sql/walk.sql")
    );
    let plan: Value = sqlx::query_scalar(&sql)
        .bind(&f.scope.organization)
        .bind(&f.scope.project)
        .bind(vec![id(10)])
        .bind(&request)
        .fetch_one(&f.pool)
        .await?;
    let plan_text = plan.to_string();
    assert!(
        plan_text.contains("edge_outgoing")
            || plan_text
                .contains("edge_organization_id_project_id_source_id_target_id_relation_key"),
        "Adjacency must use scoped endpoint index: {plan_text}"
    );
    assert!(!plan_text.contains(
        "\"Node Type\":\"Seq Scan\",\"Parallel Aware\":false,\"Relation Name\":\"edge\""
    ));
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL 17; GRAPH_SEARCH_TEST_DATABASE_URL"]
async fn branching_traversal_keeps_large_payloads_out_of_recursive_rows() -> anyhow::Result<()> {
    let f = Fixture::new(600).await?;
    f.node(10, "TASK", json!({"type":"STANDARD"})).await;
    // Three layers of twelve nodes, fully connected between adjacent layers:
    // 1,885 path rows over 37 nodes; each non-seed has a 32 KiB property.
    sqlx::query("INSERT INTO graph.node (organization_id,project_id,id,entity_type,labels,properties,created_at,updated_at) SELECT $1,$2,'40000000-0000-4000-8000-'||lpad(to_hex(n),12,'0'),'TASK',ARRAY['Task'],jsonb_build_object('type','STANDARD','status',CASE WHEN n>=1024 THEN 'ACTIVE' ELSE 'BACKLOG' END,'body',(SELECT string_agg(md5(i::text),'') FROM generate_series(1,1024) i)),now(),now() FROM generate_series(1000,1035) n")
        .bind(&f.scope.organization).bind(&f.scope.project).execute(&f.pool).await?;
    for layer in 0..3 {
        let sources = if layer == 0 {
            vec![id(10)]
        } else {
            (1000 + (layer - 1) * 12..1000 + layer * 12)
                .map(id)
                .collect()
        };
        let targets: Vec<_> = (1000 + layer * 12..1012 + layer * 12).map(id).collect();
        sqlx::query("INSERT INTO graph.edge (organization_id,project_id,source_id,target_id,relationship_type) SELECT $1,$2,source,target,'TRACKS' FROM unnest($3::text[]) source CROSS JOIN unnest($4::text[]) target")
            .bind(&f.scope.organization).bind(&f.scope.project).bind(sources).bind(targets).execute(&f.pool).await?;
    }
    sqlx::query("ANALYZE graph.node").execute(&f.pool).await?;
    sqlx::query("ANALYZE graph.edge").execute(&f.pool).await?;
    let mut tx = f.pool.begin().await?;
    sqlx::query("SET LOCAL work_mem='64kB'")
        .execute(&mut *tx)
        .await?;
    let mut payload_free = true;
    for projection in ["IDENTITIES_BY_SEED", "COMPACT_RANKED"] {
        let request = json!({"projection":projection,"seedEntityIds":[id(10)],"size":20,"traversal":{"direction":"OUTGOING","depth":3,"relationshipTypes":["TRACKS"]},"filters":{"labels":["Task"],"statuses":["ACTIVE"],"taskTypes":["STANDARD"]}});
        // Endpoint-only filters must not prune the BACKLOG intermediate nodes.
        let response = f.query("traversal", request.clone()).await;
        let targets = if projection == "IDENTITIES_BY_SEED" {
            &response["identitiesBySeed"][0]["targets"]
        } else {
            &response["results"]
        };
        assert_eq!(targets.as_array().unwrap().len(), 12, "{response}");
        let actual: std::collections::BTreeSet<_> = targets
            .as_array()
            .unwrap()
            .iter()
            .map(|target| target["entityId"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(actual, (1024..1036).map(id).collect());
        if projection == "COMPACT_RANKED" {
            for target in targets.as_array().unwrap() {
                assert_eq!(
                    target["node"]["properties"]["body"].as_str().unwrap().len(),
                    32768
                );
            }
        }
        let sql = format!(
            "EXPLAIN (ANALYZE,BUFFERS,VERBOSE,FORMAT JSON) {}",
            include_str!("../src/graph/sql/walk.sql")
        );
        let plan: Value = sqlx::query_scalar(&sql)
            .bind(&f.scope.organization)
            .bind(&f.scope.project)
            .bind(vec![id(10)])
            .bind(&request)
            .fetch_one(&mut *tx)
            .await?;
        let recursive = find_plan_node(&plan[0]["Plan"], "Recursive Union").unwrap();
        assert_eq!(recursive["Actual Rows"], 1885);
        let work_table = find_plan_node(recursive, "WorkTable Scan").unwrap();
        let output = work_table["Output"].as_array().unwrap();
        payload_free &= !["properties", "labels", "created_at", "updated_at"]
            .iter()
            .any(|column| {
                output
                    .iter()
                    .any(|field| field.as_str().unwrap().ends_with(column))
            });
        eprintln!(
            "{projection}: recursive rows={}, width={}, temp written blocks={}, total temp written blocks={}, execution ms={}",
            recursive["Actual Rows"],
            recursive["Plan Width"],
            recursive["Temp Written Blocks"],
            plan[0]["Plan"]["Temp Written Blocks"],
            plan[0]["Execution Time"]
        );
    }
    assert!(
        payload_free,
        "Recursive work tables must not carry node payloads, labels or timestamps"
    );
    Ok(())
}

fn find_plan_node<'a>(plan: &'a Value, node_type: &str) -> Option<&'a Value> {
    if plan["Node Type"] == node_type {
        return Some(plan);
    }
    plan["Plans"]
        .as_array()?
        .iter()
        .find_map(|child| find_plan_node(child, node_type))
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn projection_deletion_is_durable_scoped_and_fences_writes() -> anyhow::Result<()> {
    let f = Fixture::new(9100).await?;
    let scope = Scope {
        organization: id(9100),
        project: id(9101),
    };
    let foreign = Scope {
        organization: id(9102),
        project: id(9101),
    };
    sqlx::query("DELETE FROM graph.projection_deletion WHERE organization_id=$1")
        .bind(&scope.organization)
        .execute(&f.pool)
        .await?;
    let node = Node {
        id: id(9103),
        entity_type: "TASK".into(),
        project_scoped: true,
        labels: vec!["Task".into()],
        properties: json!({"name":"fixture"}),
        stub: false,
        deleted: false,
        created_at: None,
        updated_at: None,
    };
    store::upsert_node(&f.pool, &scope, &node).await?;
    store::upsert_node(&f.pool, &foreign, &node).await?;
    sqlx::query("INSERT INTO graph.agent_edge_deletion (organization_id,project_id,id,deleted_basis) VALUES ($1,$2,$3,now()) ON CONFLICT DO NOTHING")
        .bind(&scope.organization).bind(&scope.project).bind(&node.id).execute(&f.pool).await?;
    let command = json!({"organizationId":scope.organization,"markerId":id(9104),
        "irreversibleClosureAt":"2026-10-31T00:00:00Z","deletionDeadline":"2026-11-30T00:00:00Z"});
    let path = format!(
        "/api/organizations/{}/projection-deletion",
        scope.organization
    );
    let token = |audience: &str| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some("test-key".into());
        encode(
            &header,
            &json!({"sub":"system","aud":audience,"scopes":["organization:projection:delete"],
            "organizationId":scope.organization,"markerId":id(9104),"exp":now+300}),
            &EncodingKey::from_rsa_pem(include_bytes!("fixtures/signing.pem")).unwrap(),
        )
        .unwrap()
    };
    let graph_token = token("graph-service");
    let search_token = token("embeddings-service");
    assert_eq!(
        f.call("POST", &path, &search_token, command.clone())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        store::nodes(&f.pool, &scope, std::slice::from_ref(&node.id))
            .await?
            .len(),
        1
    );
    let (status, result) = f.call("POST", &path, &graph_token, command.clone()).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["tombstoneRecorded"], true);
    assert_eq!(result["contentVerificationCompleted"], true);
    let receipts: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.agent_edge_deletion WHERE organization_id=$1",
    )
    .bind(&scope.organization)
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(receipts, 0);

    assert!(
        store::nodes(&f.pool, &scope, std::slice::from_ref(&node.id))
            .await?
            .is_empty()
    );
    assert_eq!(
        store::nodes(&f.pool, &foreign, std::slice::from_ref(&node.id))
            .await?
            .len(),
        1
    );
    assert!(store::upsert_node(&f.pool, &scope, &node).await.is_err());
    assert_eq!(
        f.call("POST", &path, &graph_token, command.clone()).await.0,
        StatusCode::OK
    );
    let mut equivalent = command.clone();
    equivalent["irreversibleClosureAt"] = json!("2026-10-30T17:00:00-07:00");
    assert_eq!(
        f.call("POST", &path, &graph_token, equivalent).await.0,
        StatusCode::OK
    );
    let mut conflict = command;
    conflict["deletionDeadline"] = json!("2026-12-01T00:00:00Z");
    assert_eq!(
        f.call("POST", &path, &graph_token, conflict).await.0,
        StatusCode::CONFLICT
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires PostgreSQL"]
async fn template_copy_receipt_preserves_later_edits() -> anyhow::Result<()> {
    let f = Fixture::new(9200).await?;
    sqlx::query(
        "DELETE FROM graph.template_copy_receipt WHERE organization_id=$1 AND project_id=$2",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .execute(&f.pool)
    .await?;
    let mut header = Header::new(Algorithm::RS256);
    header.kid = Some("test-key".into());
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)?
        .as_secs();
    let token = encode(
        &header,
        &json!({"sub":format!("system:template-copy:{}",f.scope.organization),"aud":"graph-service",
        "scopes":["project:template:copy"],"organizationId":f.scope.organization,"projectId":f.scope.project,"exp":now+300}),
        &EncodingKey::from_rsa_pem(include_bytes!("fixtures/signing.pem"))?,
    )?;
    let path = format!(
        "/api/organizations/{}/projects/{}/template-graph",
        f.scope.organization, f.scope.project
    );
    let mut command = json!({"id":id(9201),"snapshot":{"nodes":[{"id":id(9202),"label":"Task"},{"id":id(9203),"label":"Task"}],"edges":[{
        "id":id(9204),"type":"RELATED_TO","sourceNodeId":id(9202),"targetNodeId":id(9203),"properties":{"source":"agent","reasoning":"original"},
        "createdAt":"2026-10-31T00:00:00Z","updatedAt":"2026-10-31T00:00:00Z"}]}});
    let mut legacy = command["snapshot"]["edges"][0].clone();
    legacy["id"] = json!(id(9205));
    legacy["type"] = json!("AGENT_LINKED");
    legacy["properties"] = json!({"reasoning":"legacy relationship"});
    command["snapshot"]["edges"]
        .as_array_mut()
        .unwrap()
        .push(legacy);
    let (status, body) = f.call("PUT", &path, &token, command.clone()).await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
    let (status, snapshot) = f.call("GET", &path, &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(snapshot["nodes"].as_array().unwrap().len(), 2);
    assert!(
        snapshot["edges"]
            .as_array()
            .unwrap()
            .iter()
            .any(|e| e["type"] == "AGENT_LINKED")
    );
    assert_eq!(snapshot["edges"][0]["properties"]["reasoning"], "original");
    sqlx::query("UPDATE graph.edge SET properties=properties || '{\"reasoning\":\"later edit\"}'::jsonb WHERE organization_id=$1 AND project_id=$2")
        .bind(&f.scope.organization).bind(&f.scope.project).execute(&f.pool).await?;
    assert_eq!(
        f.call("PUT", &path, &token, command.clone()).await.0,
        StatusCode::NO_CONTENT
    );
    let (_, snapshot) = f.call("GET", &path, &token, Value::Null).await;
    assert_eq!(
        snapshot["edges"][0]["properties"]["reasoning"],
        "later edit"
    );
    let mut conflict = command;
    conflict["snapshot"]["edges"][0]["properties"]["reasoning"] = json!("conflicting copy");
    assert_eq!(
        f.call("PUT", &path, &token, conflict).await.0,
        StatusCode::CONFLICT
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn authored_edges_preserve_identity_incidence_and_tenant_boundaries() -> anyhow::Result<()> {
    let f = Fixture::new(9100).await?;
    let token = f.token(&f.scope.organization, vec![]);
    let base = format!(
        "/api/organizations/{}/projects/{}/agent-edges",
        f.scope.organization, f.scope.project
    );
    let edge = json!({"id":id(9101),"sourceNodeId":id(9102),"sourceEntityType":"TASK","targetNodeId":id(9103),"targetEntityType":"DESIGN_DOC","type":"DEPENDS_ON","reasoning":"Required design","createdBySessionId":id(9104),"metadata":{"reviewed":true}});
    let mut invalid = edge.clone();
    invalid.as_object_mut().unwrap().remove("sourceEntityType");
    assert_eq!(
        f.call("POST", &base, &token, invalid).await.0,
        StatusCode::BAD_REQUEST
    );
    invalid = edge.clone();
    invalid["sourceEntityType"] = json!("USER");
    assert_eq!(
        f.call("POST", &base, &token, invalid).await.0,
        StatusCode::BAD_REQUEST
    );
    let (status, first) = f.call("POST", &base, &token, edge.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{first}");
    assert_eq!(first["metadata"], edge["metadata"]);
    let (status, retry) = f.call("POST", &base, &token, edge.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{retry}");
    assert_eq!(first, retry);
    let mut conflict = edge.clone();
    conflict["reasoning"] = json!("Different promise");
    assert_eq!(
        f.call("POST", &base, &token, conflict).await.0,
        StatusCode::CONFLICT
    );
    let mut reverse = edge.clone();
    reverse["id"] = json!(id(9105));
    reverse["sourceNodeId"] = json!(id(9103));
    reverse["sourceEntityType"] = json!("DESIGN_DOC");
    reverse["targetNodeId"] = json!(id(9102));
    reverse["targetEntityType"] = json!("TASK");
    let batch = json!({"edges":[edge,reverse]});
    for _ in 0..2 {
        let (status, result) = f
            .call("POST", &format!("{base}/batch"), &token, batch.clone())
            .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert!(
            result["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|r| r["success"] == true),
            "{result}"
        );
    }
    let (status, list) = f
        .call("GET", &format!("{base}?size=1&page=1"), &token, Value::Null)
        .await;
    assert_eq!(status, StatusCode::OK, "{list}");
    assert_eq!(list["content"].as_array().unwrap().len(), 1);
    assert_eq!(list["page"]["totalElements"], 2);
    let query = json!({"nodeIds":[id(9102)],"types":["DEPENDS_ON"]});
    let (status, incident) = f
        .call("POST", &format!("{base}/incident-query"), &token, query)
        .await;
    assert_eq!(status, StatusCode::OK, "{incident}");
    assert_eq!(incident.as_array().unwrap().len(), 2);
    // Same edge identities in a different project cannot leak or be deleted.
    let other = Fixture::new(9150).await?;
    let other_base = format!(
        "/api/organizations/{}/projects/{}/agent-edges",
        other.scope.organization, other.scope.project
    );
    assert_eq!(
        other
            .call("POST", &other_base, &token, batch["edges"][0].clone())
            .await
            .0,
        StatusCode::CREATED
    );
    let denied = f.token(&id(9999), vec![]);
    assert_eq!(
        f.call("GET", &format!("{base}/{}", id(9101)), &denied, Value::Null)
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let patch = json!({"lastModifiedBySessionId":id(9104),"targetNodeId":id(9106),"targetEntityType":"SERVICE","metadata":null});
    let path = format!("{base}/{}", id(9101));
    let (status, updated) = f.call("PATCH", &path, &token, patch.clone()).await;
    assert_eq!(status, StatusCode::OK, "{updated}");
    assert_eq!(updated["targetEntityType"], "SERVICE");
    assert!(updated["metadata"].is_null());
    assert_eq!(
        f.call(
            "PATCH",
            &format!("{path}?expectedUpdatedAt=2000-01-01T00:00:00Z"),
            &token,
            patch
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let (status, result) = f
        .call(
            "POST",
            &format!("{base}/incident-delete"),
            &token,
            json!({"nodeIds":[id(9102)]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["deletedEdgeCount"], 2);
    assert_eq!(
        f.call("GET", &path, &token, Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        other
            .call(
                "GET",
                &format!("{other_base}/{}", id(9101)),
                &token,
                Value::Null
            )
            .await
            .0,
        StatusCode::OK
    );
    assert_eq!(
        f.call("DELETE", &path, &token, Value::Null).await.0,
        StatusCode::NO_CONTENT
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn hints_keep_weighted_connections_separate_from_origin_and_retire() -> anyhow::Result<()> {
    let f = Fixture::new(9300).await?;
    let token = f.token(&f.scope.organization, vec![]);
    let base = format!(
        "/api/organizations/{}/projects/{}/hints",
        f.scope.organization, f.scope.project
    );
    let request = json!({"text":"Read the governing design","origin":{"entityType":"MESSAGE","entityId":id(9301)},"connections":[{"targetNodeId":id(9302),"targetEntityType":"TASK","strength":2.5}]});
    let mut invalid = request.clone();
    invalid["connections"] = json!([]);
    assert_eq!(
        f.call("POST", &base, &token, invalid).await.0,
        StatusCode::BAD_REQUEST
    );
    invalid = request.clone();
    invalid["connections"][0]["strength"] = json!(-1);
    assert_eq!(
        f.call("POST", &base, &token, invalid).await.0,
        StatusCode::BAD_REQUEST
    );
    invalid = request.clone();
    invalid["text"] = json!("   ");
    assert_eq!(
        f.call("POST", &base, &token, invalid).await.0,
        StatusCode::BAD_REQUEST
    );
    let (status, hint) = f.call("POST", &base, &token, request.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{hint}");
    let path = format!("{base}/{}", hint["id"].as_str().unwrap());
    let connection = format!(
        "{path}/connections/{}",
        hint["connections"][0]["id"].as_str().unwrap()
    );
    assert_eq!(hint["connections"][0]["strength"], 2.5);
    for (target, count) in [(9301, 0), (9302, 1)] {
        let (status, result) = f
            .call(
                "POST",
                &format!("{base}/connected-items-query"),
                &token,
                json!({"nodeIds":[id(target)]}),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "{result}");
        assert_eq!(result["hints"].as_array().unwrap().len(), count);
    }
    let (_, result) = f.call("GET", &base, &token, Value::Null).await;
    assert_eq!(result["hints"].as_array().unwrap().len(), 1);
    let (status, result) = f
        .call("PATCH", &path, &token, json!({"text":"Updated guidance"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["text"], "Updated guidance");
    let (status, result) = f
        .call("PATCH", &connection, &token, json!({"strength":0}))
        .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["connections"][0]["strength"], 0.0);
    assert_eq!(
        f.call(
            "POST",
            &format!("{path}/connections"),
            &token,
            request["connections"][0].clone()
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    // A HINT target must already be live in this exact project.
    assert_eq!(
        f.call(
            "POST",
            &format!("{path}/connections"),
            &token,
            json!({"targetNodeId":id(9399),"targetEntityType":"HINT","strength":1})
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let add = json!({"targetNodeId":id(9303),"targetEntityType":"SERVICE","strength":100});
    let (status, result) = f
        .call("POST", &format!("{path}/connections"), &token, add)
        .await;
    assert_eq!(status, StatusCode::CREATED, "{result}");
    assert_eq!(result["connections"].as_array().unwrap().len(), 2);
    let added = result["connections"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["targetNodeId"] == id(9303))
        .unwrap();
    let (_, result) = f
        .call(
            "DELETE",
            &format!("{path}/connections/{}", added["id"].as_str().unwrap()),
            &token,
            Value::Null,
        )
        .await;
    assert_eq!(result["hintRetired"], false);
    let other = Fixture::new(9400).await?;
    let other_path = path.replace(&f.scope.project, &other.scope.project);
    assert_eq!(
        other.call("GET", &other_path, &token, Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    let (status, result) = f.call("DELETE", &connection, &token, Value::Null).await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["hintRetired"], true);
    assert!(!result["hint"]["retiredAt"].is_null());
    let (_, result) = f.call("GET", &base, &token, Value::Null).await;
    assert_eq!(result["hints"], json!([]));
    assert_eq!(
        f.call("PATCH", &path, &token, json!({"text":"Cannot revive"}))
            .await
            .0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.call("DELETE", &path, &token, Value::Null).await.0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        f.call("GET", &path, &token, Value::Null).await.0,
        StatusCode::OK
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn incident_cleanup_preserves_system_provenance_in_both_directions() -> anyhow::Result<()> {
    let f = Fixture::new(9500).await?;
    let token = f.token(&f.scope.organization, vec![]);
    let base = format!(
        "/api/organizations/{}/projects/{}/agent-edges",
        f.scope.organization, f.scope.project
    );
    for node in 9501..=9505 {
        f.node(node, "TASK", json!({})).await;
    }
    let mut protected = Vec::new();
    for (source, target, system) in [
        (9501, 9502, false),
        (9503, 9501, false),
        (9501, 9504, true),
        (9505, 9501, true),
    ] {
        if system {
            let (status,result)=f.call("POST","/api/relationships/batch",&token,json!({"relationships":[{"fromArtifactId":id(source),"toArtifactId":id(target),"type":"DERIVES_FROM"}]})).await;
            assert_eq!(status, StatusCode::CREATED, "{result}");
            protected.push(result["created"][0].as_str().unwrap().to_owned());
        } else {
            f.edge(
                source,
                target,
                "DERIVES_FROM",
                json!({"source":"agent","reasoning":"authored"}),
            )
            .await;
        }
    }
    let (status, result) = f
        .call(
            "POST",
            &format!("{base}/incident-delete"),
            &token,
            json!({"nodeIds":[id(9501)]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{result}");
    assert_eq!(result["deletedEdgeCount"], 2);
    let (_, remaining) = f
        .call(
            "POST",
            &format!("{base}/incident-query"),
            &token,
            json!({"nodeIds":[id(9501)],"types":["DERIVES_FROM"]}),
        )
        .await;
    let remaining = remaining.as_array().unwrap();
    assert_eq!(remaining.len(), 2);
    assert!(
        protected
            .iter()
            .all(|id| remaining.iter().any(|edge| edge["id"] == *id))
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn reviewed_edge_deletion_retains_its_basis_for_retries() -> anyhow::Result<()> {
    let f = Fixture::new(9600).await?;
    let token = f.token(&f.scope.organization, vec![]);
    let base = format!(
        "/api/organizations/{}/projects/{}/agent-edges",
        f.scope.organization, f.scope.project
    );
    let request = json!({"id":id(9601),"sourceNodeId":id(9602),"sourceEntityType":"TASK","targetNodeId":id(9603),"targetEntityType":"TASK","type":"RELATED_TO","reasoning":"reviewed"});
    let (status, edge) = f.call("POST", &base, &token, request.clone()).await;
    assert_eq!(status, StatusCode::CREATED, "{edge}");
    let path = format!("{base}/{}", id(9601));
    let old = format!("{path}?expectedUpdatedAt=2000-01-01T00:00:00Z");
    assert_eq!(
        f.call("DELETE", &old, &token, Value::Null).await.0,
        StatusCode::CONFLICT
    );
    let query =
        serde_urlencoded::to_string([("expectedUpdatedAt", edge["updatedAt"].as_str().unwrap())])?;
    let checked = format!("{path}?{query}");
    for _ in 0..2 {
        let (status, result) = f.call("DELETE", &checked, &token, Value::Null).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{result}");
    }
    assert_eq!(
        f.call("GET", &path, &token, Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        f.call("DELETE", &old, &token, Value::Null).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.call(
            "DELETE",
            &format!("{base}/{}?{query}", id(9699)),
            &token,
            Value::Null
        )
        .await
        .0,
        StatusCode::CONFLICT
    );
    let other = Fixture::new(9650).await?;
    let other_path = checked.replace(&f.scope.project, &other.scope.project);
    assert_eq!(
        other
            .call("DELETE", &other_path, &token, Value::Null)
            .await
            .0,
        StatusCode::CONFLICT
    );
    // Recreating the identity invalidates the old receipt, including after incident cleanup.
    assert_eq!(
        f.call("POST", &base, &token, request).await.0,
        StatusCode::CREATED
    );
    assert_eq!(
        f.call("DELETE", &checked, &token, Value::Null).await.0,
        StatusCode::CONFLICT
    );
    assert_eq!(
        f.call(
            "POST",
            &format!("{base}/incident-delete"),
            &token,
            json!({"nodeIds":[id(9602)]})
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        f.call("DELETE", &checked, &token, Value::Null).await.0,
        StatusCode::CONFLICT
    );
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn caller_delete_rejects_and_keeps_platform_owned_edges() -> anyhow::Result<()> {
    let f = Fixture::new(9700).await?;
    let token = f.token(&f.scope.organization, vec![]);
    let edge_id = f.edge(9701, 9702, "HAS_TASK", json!({})).await;
    let path = format!(
        "/api/organizations/{}/projects/{}/agent-edges/{edge_id}",
        f.scope.organization, f.scope.project
    );
    assert_eq!(
        f.call("DELETE", &path, &token, Value::Null).await.0,
        StatusCode::NOT_FOUND
    );
    assert!(f.has_edge(9701, 9702, "HAS_TASK").await);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn approvals_preserve_create_and_edit_influences_without_duplicates() -> anyhow::Result<()> {
    use hey_hey_graph_search::graph::ingest::Ingest;
    let f = Fixture::new(990).await?;
    let ingest = Ingest::new(f.pool.clone());
    for (n, action) in [(991, "CREATE"), (992, "UPDATE")] {
        let mut event = json!({"event":{"id":id(n+10),"type":"proposal.approved","aggregateId":id(n),"payload":{
            "proposalId":id(n),"organizationId":f.scope.organization,"projectId":f.scope.project,
            "targetEntityId":id(1021),"targetEntityType":"TASK","action":action,"requestorId":id(2),
            "createdAt":"2026-11-01T00:00:00Z","shouldProcess":true,
            "influences":[{"entityId":id(3),"entityType":"TASK","reasonType":"derived","reasoning":"Reviewed requirement"}]
        }}});
        let target = id(1021);
        let reason = if action == "CREATE" {
            "Initial requirement"
        } else {
            "Revised requirement"
        };
        event["event"]["payload"]["influences"][0]["reasoning"] = json!(reason);
        let reason_type = if action == "CREATE" {
            "derived"
        } else {
            "explicit_mention"
        };
        event["event"]["payload"]["influences"][0]["reasonType"] = json!(reason_type);
        if action == "CREATE" {
            event["event"]["payload"]["resultingEntityId"] = json!(target);
        }
        ingest.handle(&event).await?;
        ingest.handle(&event).await?;
        let result = f
            .query(&format!("entities/{}/provenance", id(3)), json!({}))
            .await;
        let edges = result["edges"].as_array().unwrap();
        let matching: Vec<_> = edges
            .iter()
            .filter(|edge| edge["targetNodeId"] == target && edge["type"] == "INFLUENCES")
            .collect();
        assert_eq!(matching.len(), 1, "{result}");
        assert_eq!(matching[0]["reasonType"], reason_type);
        assert_eq!(matching[0]["reasoning"], reason);
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn approved_create_pairs_survive_stub_hydration_and_event_replay() -> anyhow::Result<()> {
    use hey_hey_graph_search::graph::ingest::Ingest;
    let f = Fixture::new(1190).await?;
    let ingest = Ingest::new(f.pool.clone());
    let mut stub = f.node(1191, "TASK", json!({"type":"STANDARD"})).await;
    stub.stub = true;
    stub.created_at = None;
    stub.updated_at = None;
    store::upsert_node(&f.pool, &f.scope, &stub).await?;
    f.node(
        1192,
        "TASK",
        json!({"name":"Hydrated partner","type":"STANDARD","status":"ACTIVE"}),
    )
    .await;

    let partner_approval = f.event(
        1193,
        "proposal.approved",
        1194,
        json!({
            "proposalId":id(1194),"targetEntityId":id(1192),"targetEntityType":"TASK",
            "resultingEntityId":id(1192),"action":"CREATE","requestorId":id(2),
            "createdAt":"2026-11-01T00:00:00Z","conversationId":id(1195),
            "messageId":id(1196),"shouldProcess":true,"influences":[]
        }),
    );
    let stub_approval = f.event(
        1197,
        "proposal.approved",
        1198,
        json!({
            "proposalId":id(1198),"targetEntityId":id(1191),"targetEntityType":"TASK",
            "resultingEntityId":id(1191),"action":"CREATE","requestorId":id(2),
            "createdAt":"2026-11-01T00:00:00Z","conversationId":id(1195),
            "messageId":id(1199),"shouldProcess":true,"influences":[]
        }),
    );
    ingest.handle(&partner_approval).await?;
    ingest.handle(&stub_approval).await?;

    let stored_pairs: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND source_id=$3 AND target_id=$4",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1191))
    .bind(id(1192))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(stored_pairs, 1);

    let hidden_until_hydrated = f
        .query(
            "incident-edges",
            json!({"seedEntityIds":[id(1192)],"relationshipTypes":["PROPOSED_TOGETHER"]}),
        )
        .await;
    assert!(
        hidden_until_hydrated["groups"][0]["relationships"]
            .as_array()
            .unwrap()
            .is_empty()
    );

    let hydration = f.event(
        1200,
        "task.created",
        1191,
        json!({"task":{"name":"Hydrated target","type":"STANDARD","status":"ACTIVE"}}),
    );
    ingest.handle(&hydration).await?;
    let is_hydrated: bool = sqlx::query_scalar(
        "SELECT NOT stub AND created_at IS NOT NULL AND updated_at IS NOT NULL FROM graph.node WHERE organization_id=$1 AND project_id=$2 AND id=$3",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1191))
    .fetch_one(&f.pool)
    .await?;
    assert!(is_hydrated);

    let visible_after_hydration = f
        .query(
            "incident-edges",
            json!({"seedEntityIds":[id(1192)],"relationshipTypes":["PROPOSED_TOGETHER"]}),
        )
        .await;
    assert_eq!(
        visible_after_hydration["groups"][0]["relationships"]
            .as_array()
            .unwrap()
            .len(),
        1
    );

    ingest.handle(&stub_approval).await?;
    let replayed_pair_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND source_id=$3 AND target_id=$4",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1191))
    .bind(id(1192))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(replayed_pair_count, 1);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn approved_create_proposals_store_symmetric_conversation_pairs() -> anyhow::Result<()> {
    use hey_hey_graph_search::graph::ingest::Ingest;
    let f = Fixture::new(1200).await?;
    let ingest = Ingest::new(f.pool.clone());
    let conversation = 1250;
    let make_approval = |sequence, proposal, target, action, conversation, message| {
        let payload = json!({
            "proposalId":id(proposal),
            "targetEntityId":id(target),
            "targetEntityType":"TASK",
            "resultingEntityId":id(target),
            "action":action,
            "requestorId":id(2),
            "createdAt":"2026-11-01T00:00:00Z",
            "conversationId":id(conversation),
            "messageId":id(message),
            "shouldProcess":true,
            "influences":[]
        });
        f.event(sequence, "proposal.approved", proposal, payload)
    };

    let first = make_approval(1260, 1261, 1271, "CREATE", conversation, 1281);
    let second = make_approval(1262, 1263, 1272, "CREATE", conversation, 1282);
    ingest.handle(&second).await?;
    ingest.handle(&first).await?;
    ingest.handle(&first).await?;

    let edit = make_approval(1264, 1265, 1273, "UPDATE", conversation, 1283);
    ingest.handle(&edit).await?;
    let other_conversation = make_approval(1266, 1267, 1274, "CREATE", 1251, 1284);
    ingest.handle(&other_conversation).await?;
    let other_conversation_target = make_approval(1267, 1276, 1275, "CREATE", 1251, 1286);
    ingest.handle(&other_conversation_target).await?;
    let repeated_target = make_approval(1268, 1269, 1271, "CREATE", conversation, 1285);

    let (pair_id, pair_properties): (String, Value) = sqlx::query_as(
        "SELECT id,properties FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND source_id=$3 AND target_id=$4",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1271))
    .bind(id(1272))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(pair_properties["source"], "system");
    assert_eq!(pair_properties["inferredBy"], "system");
    assert_eq!(pair_properties["conversationId"], id(conversation));
    ingest.handle(&repeated_target).await?;
    let persisted_pair_id: String = sqlx::query_scalar(
        "SELECT id FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND source_id=$3 AND target_id=$4",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1271))
    .bind(id(1272))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(persisted_pair_id, pair_id);
    let pair_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND source_id=$3 AND target_id=$4",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1271))
    .bind(id(1272))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(pair_count, 1);
    assert!(!f.has_edge(1271, 1273, "PROPOSED_TOGETHER").await);
    assert!(!f.has_edge(1271, 1274, "PROPOSED_TOGETHER").await);
    assert!(f.has_edge(1274, 1275, "PROPOSED_TOGETHER").await);

    for seed in [1271, 1272] {
        let result = f
            .query(
                "incident-edges",
                json!({"seedEntityIds":[id(seed)],"relationshipTypes":["PROPOSED_TOGETHER"]}),
            )
            .await;
        assert_eq!(
            result["groups"][0]["relationships"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
    for seed in [1271, 1272] {
        let result = f
            .query(
                "traversal",
                json!({"seedEntityIds":[id(seed)],"includeSeedEntities":true,"traversal":{"depth":1,"relationshipTypes":["PROPOSED_TOGETHER"]}}),
            )
            .await;
        assert!(targets(&result).contains(&id(if seed == 1271 { 1272 } else { 1271 })));
    }
    let neighborhood = f
        .query(
            "entity-neighborhood",
            json!({"seedEntityType":"TASK","seedEntityId":id(1272),"depth":1,"relationshipTypes":["PROPOSED_TOGETHER"]}),
        )
        .await;
    assert!(
        neighborhood["relatedEntities"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entity| entity["entityId"] == id(1271))
    );

    sqlx::query(
        "UPDATE graph.node SET deleted=true WHERE organization_id=$1 AND project_id=$2 AND id=$3",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1272))
    .execute(&f.pool)
    .await?;
    let hidden = f
        .query(
            "incident-edges",
            json!({"seedEntityIds":[id(1271)],"relationshipTypes":["PROPOSED_TOGETHER"]}),
        )
        .await;
    assert!(
        hidden["groups"][0]["relationships"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(f.has_edge(1274, 1275, "PROPOSED_TOGETHER").await);
    store::delete_node(&f.pool, &f.scope, &id(1272)).await?;
    let deleted_pair_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND source_id=$3 AND target_id=$4",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1271))
    .bind(id(1272))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(deleted_pair_count, 0);
    assert!(f.has_edge(1274, 1275, "PROPOSED_TOGETHER").await);

    let other = Fixture::new(1201).await?;
    let other_ingest = Ingest::new(other.pool.clone());
    let foreign = {
        let mut payload = json!({
            "proposalId":id(1291),"targetEntityId":id(1292),"targetEntityType":"TASK",
            "resultingEntityId":id(1292),"action":"CREATE","requestorId":id(2),
            "createdAt":"2026-11-01T00:00:00Z","conversationId":id(conversation),
            "messageId":id(1293),"shouldProcess":true,"influences":[]
        });
        payload["organizationId"] = json!(other.scope.organization);
        payload["projectId"] = json!(other.scope.project);
        json!({"event":{"id":id(1294),"type":"proposal.approved","aggregateId":id(1291),"payload":payload}})
    };
    other_ingest.handle(&foreign).await?;
    let scoped_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER'",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(scoped_count, 1);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn proposed_together_backfill_is_resumable_and_converges_with_approval() -> anyhow::Result<()>
{
    use hey_hey_graph_search::graph::{ingest::Ingest, proposed_together};
    let f = Fixture::new(1300).await?;
    for target in [1310, 1311, 1312] {
        f.node(
            target,
            "TASK",
            json!({"name":format!("Target {target}"),"type":"STANDARD"}),
        )
        .await;
    }
    for (proposal, target, conversation) in
        [(1320, 1310, 1330), (1321, 1311, 1330), (1322, 1312, 1331)]
    {
        let resulting_entity = if proposal == 1320 {
            Value::Null
        } else {
            json!(id(target))
        };
        f.node(
            proposal,
            "PROPOSAL",
            json!({
                "status":"APPROVED","action":"CREATE","conversationId":id(conversation),
                "targetEntityId":id(target),"targetEntityType":"TASK","resultingEntityId":resulting_entity
            }),
        )
        .await;
    }
    f.node(
        1323,
        "PROPOSAL",
        json!({"status":"APPROVED","action":"CREATE","targetEntityId":"","resultingEntityId":""}),
    )
    .await;
    f.node(
        1324,
        "PROPOSAL",
        json!({"status":"APPROVED","action":"CREATE","conversationId":id(1330),"targetEntityId":"","resultingEntityId":""}),
    )
    .await;
    f.node(
        1325,
        "PROPOSAL",
        json!({"status":"APPROVED","action":"CREATE","conversationId":id(1330),"targetEntityId":id(1399),"targetEntityType":"TASK","resultingEntityId":id(1399)}),
    )
    .await;

    let first = proposed_together::run_batch(&f.pool, &f.scope, None, 1).await?;
    assert_eq!(first.cohorts, 1);
    assert_eq!(first.examined_subjects, 2);
    assert_eq!(first.ensured_pairs, 1);
    assert_eq!(first.inserted_pairs, 1);
    assert_eq!(first.invalid_records, 2);
    assert!(
        first
            .diagnostics
            .iter()
            .any(|value| value.contains("no resultingEntityId"))
    );
    assert!(
        first
            .diagnostics
            .iter()
            .any(|value| value.contains("no live canonical endpoint"))
    );
    assert_eq!(first.missing_conversations.as_ref().unwrap().count, 1);
    let cursor = first.after_conversation_id.clone().unwrap();
    let second = proposed_together::run_batch(&f.pool, &f.scope, Some(&cursor), 1).await?;
    assert_eq!(second.cohorts, 1);
    assert_eq!(second.examined_subjects, 1);
    assert_eq!(second.ensured_pairs, 0);

    let ingest = Ingest::new(f.pool.clone());
    let make_event = |event_id, proposal_id, target_id, message_id| {
        f.event(
            event_id,
            "proposal.approved",
            proposal_id,
            json!({
                "proposalId":id(proposal_id),"targetEntityId":id(target_id),"targetEntityType":"TASK",
                "resultingEntityId":id(target_id),"action":"CREATE","requestorId":id(2),
                "createdAt":"2026-11-01T00:00:00Z","conversationId":id(1330),
                "messageId":id(message_id),"shouldProcess":true,"influences":[]
            }),
        )
    };
    let third = make_event(1342, 1340, 1312, 1341);
    let backfill = proposed_together::run_batch(&f.pool, &f.scope, None, 100);
    let (backfilled, third_result) = tokio::join!(backfill, ingest.handle(&third));
    assert_eq!(backfilled?.cohorts, 2);
    third_result?;

    let fourth = make_event(1345, 1343, 1313, 1344);
    let fifth = make_event(1348, 1346, 1314, 1347);
    let (fourth_result, fifth_result) = tokio::join!(ingest.handle(&fourth), ingest.handle(&fifth));
    fourth_result?;
    fifth_result?;

    let again = proposed_together::run_batch(&f.pool, &f.scope, None, 100).await?;
    assert_eq!(again.ensured_pairs, 10);
    assert_eq!(again.inserted_pairs, 0);
    let pair_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM graph.edge WHERE organization_id=$1 AND project_id=$2 AND relationship_type='PROPOSED_TOGETHER' AND properties->>'conversationId'=$3",
    )
    .bind(&f.scope.organization)
    .bind(&f.scope.project)
    .bind(id(1330))
    .fetch_one(&f.pool)
    .await?;
    assert_eq!(pair_count, 10);
    Ok(())
}

impl Fixture {
    fn event(&self, sequence: u64, kind: &str, aggregate: u64, mut payload: Value) -> Value {
        payload["organizationId"] = json!(self.scope.organization);
        payload["projectId"] = json!(self.scope.project);
        payload["payloadType"] = json!(kind);
        payload["timestamp"] = json!("2026-11-01T00:00:00Z");
        json!({"event":{"id":id(sequence),"aggregateId":id(aggregate),"type":kind,"payload":payload}})
    }
    async fn projected(&self, entity: u64) -> Value {
        self.query("traversal",json!({"seedEntityIds":[id(entity)],"includeSeedEntities":true,"traversal":{"depth":1}})).await
    }
    async fn has_edge(&self, source: u64, target: u64, kind: &str) -> bool {
        let response = self
            .query(
                "incident-edges",
                json!({"seedEntityIds":[id(source)],"relationshipTypes":[kind]}),
            )
            .await;
        response["groups"]
            .as_array()
            .unwrap()
            .iter()
            .flat_map(|g| g["relationships"].as_array().unwrap())
            .any(|r| {
                r["sourceNodeId"] == id(source)
                    && r["targetNodeId"] == id(target)
                    && r["type"] == kind
            })
    }
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn lifecycle_sequences_project_nodes_relationships_replacements_and_cascades()
-> anyhow::Result<()> {
    use hey_hey_graph_search::graph::ingest::Ingest;
    let f = Fixture::new(1100).await?;
    let ingest = Ingest::new(f.pool.clone());
    let events = [
        (
            "initiative.created",
            1101,
            json!({"initiative":{"name":"Release","status":"ACTIVE"}}),
        ),
        (
            "task.created",
            1102,
            json!({"initiativeId":id(1101),"task":{"name":"Parent","type":"FEATURE","status":"BACKLOG"}}),
        ),
        (
            "task.created",
            1103,
            json!({"task":{"name":"Child","type":"STANDARD","parentTaskId":id(1102)}}),
        ),
        ("task.updated", 1103, json!({"update":{"name":"Renamed"}})),
        ("task.assigned", 1103, json!({"assigneeId":id(1)})),
        ("task.unassigned", 1103, json!({})),
        (
            "task.status_changed",
            1103,
            json!({"newStatus":"ACTIVE","previousStatus":"BACKLOG"}),
        ),
        (
            "service.created",
            1104,
            json!({"service":{"name":"API","language":"Rust"}}),
        ),
        ("service.updated", 1104, json!({"service":{"name":"Graph"}})),
        (
            "design_doc.created",
            1105,
            json!({"designDoc":{"name":"Design","status":"READY"}}),
        ),
        (
            "design_doc.updated",
            1105,
            json!({"designDoc":{"name":"Reviewed design"}}),
        ),
        (
            "conversation.created",
            1106,
            json!({"conversationTitle":"Thread","status":"ACTIVE","workflowAboutId":id(1102),"workflowAboutType":"task"}),
        ),
        (
            "conversation.updated",
            1106,
            json!({"update":{"title":"Discussion"}}),
        ),
        (
            "message.created",
            1107,
            json!({"conversationId":id(1106),"message":{"type":"USER","shouldProcess":true,"userMessage":"First","userId":id(1)}}),
        ),
        (
            "message.created",
            1108,
            json!({"conversationId":id(1106),"message":{"type":"USER","shouldProcess":true,"userMessage":"Next","parentMessageId":id(1107)}}),
        ),
        (
            "message.updated",
            1108,
            json!({"conversationId":id(1106),"update":{"shouldProcess":true,"systemMessage":"Updated","parentMessageId":id(1109)}}),
        ),
        (
            "artifact.created",
            1110,
            json!({"artifact":{"title":"Document","type":"TEXT","sourceId":id(1107),"sourceType":"MESSAGE"}}),
        ),
        ("artifact.updated", 1110, json!({})),
        (
            "agent_session.created",
            1111,
            json!({"taskId":id(1103),"serviceId":id(1104),"conversationId":id(1106),"agentSession":{"id":id(1111),"title":"Implement","status":"IN_PROGRESS"}}),
        ),
        (
            "agent_session.status_changed",
            1111,
            json!({"newStatus":"COMPLETED"}),
        ),
        (
            "implementation_hint.created",
            1112,
            json!({"implementationHint":{"id":id(1112),"serviceId":id(1104),"agentSessionId":id(1111),"hint":"Use shared store"}}),
        ),
        (
            "implementation_hint.updated",
            1112,
            json!({"implementationHint":{"id":id(1112),"serviceId":id(1113),"hint":"Updated guidance"}}),
        ),
        (
            "report.created",
            1114,
            json!({"shouldProcess":true,"report":{"id":id(1114),"reportType":"IMPLEMENT","title":"Evidence","ragEnabled":true,"entities":[{"entityId":id(1103),"entityType":"TASK","relation":"PRIMARY"}]}}),
        ),
        (
            "mention.created",
            1115,
            json!({"sourceEntityId":id(1107),"sourceEntityType":"MESSAGE","entityId":id(1103),"entityType":"TASK","workflowAboutId":id(1102),"workflowAboutType":"TASK"}),
        ),
        (
            "summary.created",
            1116,
            json!({"entityId":id(1103),"entityType":"task","category":"product","subfacets":["Delivery"]}),
        ),
    ];
    for (sequence, (kind, aggregate, payload)) in events.into_iter().enumerate() {
        let e = f.event(1200 + sequence as u64, kind, aggregate, payload);
        ingest.handle(&e).await?;
        ingest.handle(&e).await?;
    }
    for (source, target, kind) in [
        (1101, 1102, "HAS_TASK"),
        (1102, 1103, "HAS_TASK"),
        (1106, 1102, "ABOUT"),
        (1106, 1107, "HAS_MESSAGE"),
        (1109, 1108, "MESSAGE_FOLLOWS"),
        (1110, 1107, "DERIVES_FROM"),
        (1103, 1111, "HAS_AGENT_SESSION"),
        (1113, 1112, "HAS_IMPLEMENTATION_HINT"),
        (1114, 1103, "REPORTS_ON"),
        (1102, 1103, "MENTIONS"),
    ] {
        assert!(f.has_edge(source, target, kind).await, "missing {kind}");
    }
    assert!(!f.has_edge(1107, 1108, "MESSAGE_FOLLOWS").await);
    assert!(!f.has_edge(1104, 1112, "HAS_IMPLEMENTATION_HINT").await);
    assert!(!f.has_edge(1112, 1111, "DERIVES_FROM").await);
    for (entity, key, expected) in [
        (1103, "name", "Renamed"),
        (1103, "status", "ACTIVE"),
        (1104, "name", "Graph"),
        (1105, "title", "Reviewed design"),
        (1108, "content", "Updated"),
        (1111, "status", "COMPLETED"),
        (1112, "hint", "Updated guidance"),
    ] {
        let result = f.projected(entity).await;
        let node = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["entityId"] == id(entity))
            .unwrap();
        assert_eq!(node["node"]["properties"][key], expected);
    }
    for (entity, field) in [(1103, "assigneeId"), (1112, "agentSessionId")] {
        let result = f.projected(entity).await;
        let node = result["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["entityId"] == id(entity))
            .unwrap();
        assert!(node["node"]["properties"].get(field).is_none());
    }
    let topology = f.query("topology", json!({})).await;
    assert_eq!(
        topology["categories"][0]["subfacets"][0]["name"],
        "Delivery"
    );
    ingest.handle(&f.event(1300,"summary.updated",1116,json!({"entityId":id(1103),"entityType":"task","category":"product","subfacets":["Released"]}))).await?;
    let topology = f.query("topology", json!({})).await;
    let facets = topology["categories"][0]["subfacets"].as_array().unwrap();
    assert!(
        facets.iter().find(|f| f["name"] == "Delivery").unwrap()["entities"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        facets.iter().find(|f| f["name"] == "Released").unwrap()["entities"][0]["id"],
        id(1103)
    );
    for (sequence, kind, aggregate, payload) in [
        (1301, "mention.removed", 1115, json!({})),
        (
            1302,
            "summary.deleted",
            1116,
            json!({"entityId":id(1103),"category":"product"}),
        ),
        (1303, "artifact.deleted", 1110, json!({})),
        (1304, "message.deleted", 1108, json!({})),
        (1305, "implementation_hint.deleted", 1112, json!({})),
        (1306, "agent_session.deleted", 1111, json!({})),
        (1307, "design_doc.archived", 1105, json!({})),
        (1308, "service.archived", 1104, json!({})),
        (1309, "task.archived", 1102, json!({})),
        (
            1310,
            "initiative.updated",
            1101,
            json!({"update":{"name":"Finished"}}),
        ),
        (
            1311,
            "initiative.status_changed",
            1101,
            json!({"previousStatus":"ACTIVE","newStatus":"COMPLETED"}),
        ),
        (1312, "initiative.archived", 1101, json!({})),
        (
            1313,
            "conversation.deleted",
            1106,
            json!({"hardDelete":true}),
        ),
    ] {
        ingest
            .handle(&f.event(sequence, kind, aggregate, payload))
            .await?;
    }
    assert!(!f.has_edge(1102, 1103, "MENTIONS").await);
    for entity in [
        1101, 1102, 1103, 1104, 1105, 1106, 1107, 1108, 1110, 1111, 1112,
    ] {
        assert_eq!(f.projected(entity).await["totalElements"], 0);
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL and GRAPH_SEARCH_TEST_REDIS_URL"]
async fn redis_graph_events_preserve_order_isolate_failures_and_fence_closed_organizations()
-> anyhow::Result<()> {
    use hey_hey_graph_search::{
        graph::ingest::{Ingest, SUBSCRIBED},
        search::ingest::{config::EventsConfig, consumer::Consumer},
    };
    use redis::AsyncCommands;
    use std::time::{Duration, Instant};
    let f = Fixture::new(1400).await?;
    // Closure affects an entire organization; use an organization private to this fixture.
    let f = Fixture {
        scope: Scope {
            organization: id(1400),
            project: f.scope.project.clone(),
        },
        ..f
    };
    sqlx::query("DELETE FROM graph.projection_deletion WHERE organization_id=$1")
        .bind(&f.scope.organization)
        .execute(&f.pool)
        .await?;
    sqlx::query("DELETE FROM graph.event_receipt WHERE organization_id=$1")
        .bind(&f.scope.organization)
        .execute(&f.pool)
        .await?;
    let redis_url = std::env::var("GRAPH_SEARCH_TEST_REDIS_URL")?;
    let prefix = format!("graph-test-{}:", std::process::id());
    let consumer = Consumer::start_graph(
        EventsConfig {
            redis_url: redis_url.clone(),
            channel_prefix: prefix.clone(),
            lanes: 2,
            lane_capacity: 4,
        },
        Ingest::new(f.pool.clone()),
    );
    let mut connection = redis::Client::open(redis_url)?
        .get_multiplexed_async_connection()
        .await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let channels: Vec<String> = SUBSCRIBED
            .iter()
            .map(|kind| format!("{prefix}{kind}"))
            .collect();
        let counts: Vec<(String, i64)> = redis::cmd("PUBSUB")
            .arg("NUMSUB")
            .arg(channels)
            .query_async(&mut connection)
            .await?;
        if counts.iter().all(|(_, n)| *n == 1) {
            break;
        }
        anyhow::ensure!(Instant::now() < deadline, "consumer did not subscribe");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let created = f.event(
        1401,
        "task.created",
        1410,
        json!({"task":{"name":"Initial","type":"FEATURE"}}),
    );
    let events = [
        created.clone(),
        f.event(
            1402,
            "task.updated",
            1410,
            json!({"update":{"name":"Later"}}),
        ),
        f.event(1403, "task.updated", 1410, json!({"update":5})),
        f.event(
            1404,
            "task.updated",
            1410,
            json!({"update":{"name":"Final"}}),
        ),
        created,
    ];
    for e in events {
        let channel = format!("{prefix}{}", e["event"]["type"].as_str().unwrap());
        connection
            .publish::<_, _, i64>(channel, e.to_string())
            .await?;
    }
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let response = f.projected(1410).await;
        if response["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|n| n["node"]["properties"]["name"] == "Final")
        {
            break;
        }
        anyhow::ensure!(
            Instant::now() < deadline,
            "ordered healthy event was not visible: {response}"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let closure = json!({"event":{"id":id(1450),"type":"organization.closed","aggregateId":f.scope.organization,"payload":{"payloadType":"organization.closed","organizationId":f.scope.organization,"markerId":id(1451),"irreversibleClosureAt":"2026-11-01T00:00:00Z","deletionDeadline":"2026-11-02T00:00:00Z"}}});
    connection
        .publish::<_, _, i64>(format!("{prefix}organization.closed"), closure.to_string())
        .await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while f.projected(1410).await["totalElements"] != 0 {
        anyhow::ensure!(
            Instant::now() < deadline,
            "closure did not delete projection"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        Ingest::new(f.pool.clone())
            .handle(&f.event(
                1452,
                "task.created",
                1410,
                json!({"task":{"name":"Cannot return","type":"FEATURE"}})
            ))
            .await
            .is_err()
    );
    consumer.stop().await;
    assert_eq!(f.projected(1410).await["totalElements"], 0);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn deleted_artifacts_disappear_from_authenticated_graph_reads_on_duplicate_delivery()
-> anyhow::Result<()> {
    use hey_hey_graph_search::graph::ingest::Ingest;
    let f = Fixture::new(1500).await?;
    let ingest = Ingest::new(f.pool.clone());
    ingest
        .handle(&f.event(
            1501,
            "task.created",
            1502,
            json!({"task":{"name":"Source","type":"STANDARD"}}),
        ))
        .await?;
    ingest.handle(&f.event(1503, "artifact.created", 1504, json!({"artifact":{"title":"Evidence","type":"DOCUMENT","sourceId":id(1502),"sourceType":"TASK"}}))).await?;
    assert!(
        f.projected(1504).await["results"]
            .as_array()
            .unwrap()
            .iter()
            .any(|node| node["entityId"] == id(1504))
    );
    assert!(f.has_edge(1504, 1502, "DERIVES_FROM").await);
    let deleted = f.event(1505, "artifact.deleted", 1504, json!({}));
    for _ in 0..2 {
        ingest.handle(&deleted).await?;
        assert_eq!(f.projected(1504).await["totalElements"], 0);
        assert!(!f.has_edge(1504, 1502, "DERIVES_FROM").await);
        let from_source = f.projected(1502).await;
        assert!(
            from_source["results"]
                .as_array()
                .unwrap()
                .iter()
                .all(|node| node["entityId"] != id(1504))
        );
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn clone_readiness_counts_only_live_items_in_their_expected_place() -> anyhow::Result<()> {
    let f = Fixture::new(301).await?;
    f.node(300 + 1, "PROJECT", json!({"name":"Project"})).await;
    f.node(10, "TASK", json!({"type":"FEATURE"})).await;
    f.node(11, "TASK", json!({"type":"STANDARD"})).await;
    f.node(12, "TASK", json!({"type":"STANDARD"})).await;
    f.edge(10, 11, "HAS_TASK", json!({})).await;
    let item = |n: u64, kind: &str, parent: String| json!({"id":id(n),"typeKey":kind,"parentTaskId":parent});

    let ready = f
        .query(
            "work-item-project-readiness",
            json!({"workItems":[
                item(10, "FEATURE", String::new()),
                item(11, "STANDARD", id(10)),
                item(12, "STANDARD", String::new()),
            ]}),
        )
        .await;
    assert_eq!(ready["verifiedCount"], 3);

    let mismatched = f
        .query(
            "work-item-project-readiness",
            json!({"workItems":[
                item(11, "STANDARD", String::new()),
                item(12, "STANDARD", id(10)),
                item(10, "BUG", String::new()),
                item(99, "STANDARD", String::new()),
            ]}),
        )
        .await;
    assert_eq!(mismatched["verifiedCount"], 0);

    f.node(13, "DESIGN_DOC", json!({"name":"Doc"})).await;
    f.node(14, "DESIGN_DOC", json!({"name":"Unscoped"})).await;
    f.edge(13, 301, "SCOPED_TO_PROJECT", json!({})).await;
    let docs = f
        .query(
            "design-doc-project-readiness",
            json!({"designDocIds":[id(13),id(13),id(14)]}),
        )
        .await;
    assert_eq!(docs["verifiedCount"], 1);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn reparenting_a_task_withdraws_the_previous_parents_edge() -> anyhow::Result<()> {
    use hey_hey_graph_search::graph::ingest::Ingest;
    let f = Fixture::new(1200).await?;
    let ingest = Ingest::new(f.pool.clone());
    for (sequence, kind, aggregate, payload) in [
        (
            1201,
            "task.created",
            1210,
            json!({"task":{"name":"First parent","type":"FEATURE"}}),
        ),
        (
            1202,
            "task.created",
            1211,
            json!({"task":{"name":"Second parent","type":"FEATURE"}}),
        ),
        (
            1203,
            "task.created",
            1212,
            json!({"task":{"name":"Child","type":"STANDARD","parentTaskId":id(1210)}}),
        ),
        (
            1204,
            "task.updated",
            1212,
            json!({"update":{"parentTaskId":id(1211)}}),
        ),
    ] {
        ingest
            .handle(&f.event(sequence, kind, aggregate, payload))
            .await?;
    }

    assert!(f.has_edge(1211, 1212, "HAS_TASK").await);
    assert!(!f.has_edge(1210, 1212, "HAS_TASK").await);
    Ok(())
}

#[tokio::test]
#[ignore = "requires disposable PostgreSQL"]
async fn transition_role_persists_changes_clears_and_stays_on_flow_edges() -> anyhow::Result<()> {
    let f = Fixture::new(9700).await?;
    let token = f.token(&f.scope.organization, vec![]);
    let base = format!(
        "/api/organizations/{}/projects/{}/agent-edges",
        f.scope.organization, f.scope.project
    );
    for node in 9701..=9703 {
        f.node(node, "TASK", json!({"type":"STANDARD"})).await;
    }
    let flow = |edge: u64, target: u64, extra: Value| {
        let mut request = json!({"id":id(edge),"sourceNodeId":id(9701),"sourceEntityType":"TASK","targetNodeId":id(target),"targetEntityType":"TASK","type":"STANDARD","category":"flow","direction":"forward","actionLabel":"tap Continue","reasoning":"journey"});
        request
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        request
    };

    // Unclassified stays unclassified; a classified transition round-trips.
    let (status, plain) = f
        .call("POST", &base, &token, flow(9710, 9702, json!({})))
        .await;
    assert_eq!(status, StatusCode::CREATED, "{plain}");
    assert!(plain.get("transitionRole").is_none());
    let (status, classified) = f
        .call(
            "POST",
            &base,
            &token,
            flow(9711, 9703, json!({"transitionRole":"ERROR_PATH"})),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "{classified}");
    assert_eq!(classified["transitionRole"], "ERROR_PATH");

    // Change, preserve across an unrelated edit, then clear with explicit null.
    let path = format!("{base}/{}", id(9711));
    let (status, changed) = f
        .call(
            "PATCH",
            &path,
            &token,
            json!({"lastModifiedBySessionId":id(1),"transitionRole":"RECOVERY"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{changed}");
    assert_eq!(changed["transitionRole"], "RECOVERY");
    let (status, returned) = f
        .call(
            "PATCH",
            &path,
            &token,
            json!({"lastModifiedBySessionId":id(1),"transitionRole":"RETURN"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{returned}");
    assert_eq!(returned["transitionRole"], "RETURN");
    let (_, kept) = f
        .call(
            "PATCH",
            &path,
            &token,
            json!({"lastModifiedBySessionId":id(1),"reasoning":"renamed"}),
        )
        .await;
    assert_eq!(kept["transitionRole"], "RETURN");
    assert_eq!(kept["actionLabel"], "tap Continue");
    let (status, cleared) = f
        .call(
            "PATCH",
            &path,
            &token,
            json!({"lastModifiedBySessionId":id(1),"transitionRole":null}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{cleared}");
    assert!(cleared.get("transitionRole").is_none());
    assert_eq!(cleared["direction"], "forward");

    // Invalid value and non-flow use are rejected.
    let (status, _) = f
        .call(
            "POST",
            &base,
            &token,
            flow(9712, 9703, json!({"transitionRole":"HAPPY_PATH"})),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let meta = json!({"id":id(9713),"sourceNodeId":id(9701),"sourceEntityType":"TASK","targetNodeId":id(9703),"targetEntityType":"TASK","type":"RELATED_TO","reasoning":"meta","transitionRole":"RECOVERY"});
    let (status, _) = f.call("POST", &base, &token, meta).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    Ok(())
}
