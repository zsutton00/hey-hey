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
    assert_eq!(
        incident["groups"][0]["endpoints"].as_array().unwrap().len(),
        100
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
