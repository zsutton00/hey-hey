mod common;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use hey_hey_graph_search::{
    auth::{Authenticator, TrustConfig},
    config::Config,
    server,
};
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::{Value, json};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

fn app() -> axum::Router {
    let config = Config::from_lookup(|key| {
        Ok((key == "GRAPH_SEARCH_DATABASE_URL")
            .then(|| "postgres://localhost/heyhey_graph_search".into()))
    })
    .unwrap();
    let pool = PgPoolOptions::new().connect_lazy_with(config.database.clone());
    server::router(&config, pool, common::auth())
}
/// Authentication and authorization passed; the operation itself answered.
fn authorized(status: StatusCode) -> bool {
    !matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN)
}
fn user() -> Value {
    json!({"sub":"user", "currentOrgId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30", "project_ids":["7693af38-9441-45c5-932e-c7dcbd509b82"], "orgMemberships":[{"orgId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30", "role":"OWNER"}], "exp":now()+300})
}
fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs()
}
fn token(claims: &Value) -> String {
    sign(
        claims,
        include_bytes!("fixtures/signing.pem"),
        Some("test-key"),
    )
}
fn sign(claims: &Value, pem: &[u8], kid: Option<&str>) -> String {
    let mut header = Header::new(Algorithm::RS256);
    header.kid = kid.map(str::to_owned);
    encode(&header, claims, &EncodingKey::from_rsa_pem(pem).unwrap()).unwrap()
}
async fn request(method: &str, path: &str, token: Option<&str>, body: Value) -> StatusCode {
    let mut request = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        request = request.header("Authorization", format!("Bearer {token}"));
    }
    app()
        .oneshot(
            request
                .body(if body.is_null() {
                    Body::empty()
                } else {
                    Body::from(body.to_string())
                })
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}
#[tokio::test]
async fn every_declared_operation_rejects_invalid_credentials() {
    let mut expired = user();
    expired["exp"] = json!(now() - 10);
    let mut missing_exp = user();
    missing_exp.as_object_mut().unwrap().remove("exp");
    let mut future = user();
    future["nbf"] = json!(now() + 300);
    let invalid = [
        None,
        Some(token(&missing_exp)),
        Some(token(&future)),
        Some(
            encode(
                &Header::new(Algorithm::HS256),
                &user(),
                &EncodingKey::from_secret(b"test-only-secret"),
            )
            .unwrap(),
        ),
        Some("malformed".into()),
        Some(token(&expired)),
        Some(sign(
            &user(),
            include_bytes!("fixtures/other.pem"),
            Some("test-key"),
        )),
        Some(sign(&user(), include_bytes!("fixtures/signing.pem"), None)),
        Some(sign(
            &user(),
            include_bytes!("fixtures/signing.pem"),
            Some("unknown"),
        )),
    ];
    for (prefix, spec) in [
        (
            "/api",
            include_str!("../../../openapi/specs/graphs/openapi.yaml"),
        ),
        (
            "",
            include_str!("../../../openapi/specs/embeddings/openapi.yaml"),
        ),
    ] {
        let mut path = String::new();
        for line in spec.lines() {
            if line.starts_with("  /") {
                path = format!("{prefix}{}", line.trim().trim_end_matches(':'))
                    .replace("{organizationId}", "28f52f56-080e-40b6-a81b-2d98bc6e5f30")
                    .replace("{projectId}", "7693af38-9441-45c5-932e-c7dcbd509b82");
                // Remaining path identities are opaque to authentication.
                while let Some(start) = path.find('{') {
                    let end = path[start..].find('}').unwrap() + start;
                    path.replace_range(start..=end, "item");
                }
            }
            if [
                "    get:",
                "    post:",
                "    put:",
                "    patch:",
                "    delete:",
            ]
            .contains(&line)
                && !path.is_empty()
            {
                for credential in &invalid {
                    assert_eq!(
                        request(
                            line.trim().trim_end_matches(':'),
                            &path,
                            credential.as_deref(),
                            Value::Null
                        )
                        .await,
                        StatusCode::UNAUTHORIZED,
                        "{line} {path}"
                    );
                }
            }
        }
    }
}
#[tokio::test]
async fn api_user_shape_is_accepted_without_issuer_or_audience_and_tenancy_is_enforced() {
    let token = token(&user());
    for path in [
        "/api/nodes",
        "/embeddings/search",
        "/api/organizations/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projects/7693af38-9441-45c5-932e-c7dcbd509b82/topology",
    ] {
        let status = request("GET", path, Some(&token), Value::Null).await;
        assert!(authorized(status), "{path}: {status}");
    }
    for path in [
        "/api/organizations/fc97bf36-99e8-427e-99ab-6d24ea2c2410/projects/7693af38-9441-45c5-932e-c7dcbd509b82/topology",
        "/api/organizations/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projects/fc97bf36-99e8-427e-99ab-6d24ea2c2410/topology",
        "/embeddings/search?organizationId=fc97bf36-99e8-427e-99ab-6d24ea2c2410",
        "/embeddings/search?projectId=fc97bf36-99e8-427e-99ab-6d24ea2c2410",
    ] {
        assert_eq!(
            request("GET", path, Some(&token), Value::Null).await,
            StatusCode::FORBIDDEN
        );
    }
    assert_eq!(
        request(
            "POST",
            "/embeddings/search",
            Some(&token),
            json!({"organizationId":"fc97bf36-99e8-427e-99ab-6d24ea2c2410"})
        )
        .await,
        StatusCode::FORBIDDEN
    );
}
#[tokio::test]
async fn debug_operations_accept_only_the_embeddings_debug_credential() {
    let debug = |scopes: Value, aud: Value| {
        let mut claims =
            json!({"sub":"system:embeddings-debug:admin", "scopes":scopes, "exp":now()+300});
        if !aud.is_null() {
            claims["aud"] = aud;
        }
        token(&claims)
    };
    let mut admin_user = user();
    admin_user["scopes"] = json!(["read", "write", "admin"]);
    admin_user["isDevAdmin"] = json!(true);
    let rejected = [
        None,
        Some(token(&user())),
        Some(token(&admin_user)),
        Some(debug(json!(["embeddings:debug:read"]), Value::Null)),
        Some(debug(
            json!(["embeddings:debug:read"]),
            json!("graph-service"),
        )),
        Some(debug(
            json!(["embeddings:debug:read", "read"]),
            json!("embeddings-service"),
        )),
        Some(debug(
            json!(["organization:projection:delete"]),
            json!("embeddings-service"),
        )),
    ];
    for path in ["/debug", "/debug/entity?type=task&id=t-1"] {
        for credential in &rejected {
            let status = request("GET", path, credential.as_deref(), Value::Null).await;
            let expected = if credential.is_none() {
                StatusCode::UNAUTHORIZED
            } else {
                StatusCode::FORBIDDEN
            };
            assert_eq!(status, expected, "{path}");
        }
        let accepted = debug(
            json!(["embeddings:debug:read"]),
            json!("embeddings-service"),
        );
        assert_eq!(
            request("GET", path, Some(&accepted), Value::Null).await,
            StatusCode::NOT_IMPLEMENTED,
            "{path}"
        );
        // The debug credential is not an ordinary read credential.
        assert_eq!(
            request("GET", "/embeddings/search", Some(&accepted), Value::Null).await,
            StatusCode::FORBIDDEN
        );
    }
}
#[tokio::test]
async fn deletion_credentials_are_bound_to_surface_scope_organization_marker_and_expiry() {
    for (path, audience, other) in [
        (
            "/api/organizations/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projection-deletion",
            "graph-service",
            "embeddings-service",
        ),
        (
            "/orgs/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projection-deletion",
            "embeddings-service",
            "graph-service",
        ),
    ] {
        let claims = json!({"sub":"system:projection-deletion", "organizationId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30", "currentOrgId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30", "markerId":"66064483-8ce7-4a7f-8d1c-7e9ccde8ec74", "scopes":["organization:projection:delete"], "aud":audience,"exp":now()+300});
        let body = json!({"organizationId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30","markerId":"66064483-8ce7-4a7f-8d1c-7e9ccde8ec74"});
        let status = request("POST", path, Some(&token(&claims)), body.clone()).await;
        assert!(authorized(status), "{path}: {status}");
        for (field, value) in [
            ("aud", json!(other)),
            ("aud", json!([audience, other])),
            ("scopes", json!(["organization:projection:delete", "write"])),
            ("scopes", json!(["write"])),
            (
                "organizationId",
                json!("fc97bf36-99e8-427e-99ab-6d24ea2c2410"),
            ),
            ("markerId", json!("fc97bf36-99e8-427e-99ab-6d24ea2c2410")),
        ] {
            let mut bad = claims.clone();
            bad[field] = value;
            assert_eq!(
                request("POST", path, Some(&token(&bad)), body.clone()).await,
                StatusCode::FORBIDDEN
            );
        }
        assert_eq!(
            request("POST", path, Some(&token(&user())), body.clone()).await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request("GET", "/api/nodes", Some(&token(&claims)), Value::Null).await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                "POST",
                path,
                Some(&token(&claims)),
                json!({"organizationId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30","markerId":"fc97bf36-99e8-427e-99ab-6d24ea2c2410"})
            )
            .await,
            StatusCode::FORBIDDEN
        );
    }
}
#[tokio::test]
async fn template_credentials_remain_separate_and_bound_to_target() {
    let claims = json!({"sub":"system:template-copy:28f52f56-080e-40b6-a81b-2d98bc6e5f30", "organizationId":"28f52f56-080e-40b6-a81b-2d98bc6e5f30", "projectId":"7693af38-9441-45c5-932e-c7dcbd509b82", "scopes":["project:template:copy"], "aud":"graph-service", "exp":now()+300});
    for method in ["GET", "PUT"] {
        let status = request(
            method,
            "/api/organizations/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projects/7693af38-9441-45c5-932e-c7dcbd509b82/template-graph",
            Some(&token(&claims)),
            Value::Null,
        ).await;
        // This fixture has no live database; assert the authentication boundary only.
        assert_ne!(status, StatusCode::UNAUTHORIZED);
        assert_ne!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            request(
                method,
                "/api/organizations/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projects/fc97bf36-99e8-427e-99ab-6d24ea2c2410/template-graph",
                Some(&token(&claims)),
                Value::Null
            )
            .await,
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            request(
                method,
                "/api/organizations/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projects/7693af38-9441-45c5-932e-c7dcbd509b82/template-graph",
                Some(&token(&user())),
                Value::Null
            )
            .await,
            StatusCode::FORBIDDEN
        );
    }
}
#[tokio::test]
async fn startup_rejects_missing_or_unavailable_signing_trust() {
    assert!(TrustConfig::from_lookup(|_| None).is_err());
    let config = TrustConfig::from_lookup(|key| {
        Some(
            match key {
                "GRAPH_SEARCH_JWKS_URL" => "http://127.0.0.1:1/jwks",
                "GRAPH_SEARCH_GRAPH_AUDIENCE" => "graph-service",
                _ => "embeddings-service",
            }
            .into(),
        )
    })
    .unwrap();
    assert!(Authenticator::load(config).await.is_err());
}

#[tokio::test]
async fn jwks_fetch_rotation_overlap_and_configured_issuer_are_enforced() {
    use std::sync::{Arc, RwLock};
    let keys: Value = serde_json::from_str(include_str!("fixtures/jwks.json")).unwrap();
    let shared = Arc::new(RwLock::new(keys));
    let server_keys = shared.clone();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let jwks = axum::Router::new().route(
        "/jwks",
        axum::routing::get(move || {
            let keys = server_keys.read().unwrap().clone();
            async { axum::Json(keys) }
        }),
    );
    let server = tokio::spawn(async move {
        axum::serve(listener, jwks).await.unwrap();
    });
    let config = TrustConfig {
        jwks_url: format!("http://{address}/jwks"),
        issuer: Some("api-issuer".into()),
        user_audience: Some("user-audience".into()),
        graph_audience: "graph-service".into(),
        search_audience: "embeddings-service".into(),
    };
    let auth = Authenticator::load(config).await.unwrap();
    let app = hey_hey_graph_search::graph::routes::router(true, auth);
    let call = |token: String| {
        let app = app.clone();
        async move {
            app.oneshot(
                Request::builder()
                    .uri("/nodes")
                    .header("Authorization", format!("Bearer {token}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
            .status()
        }
    };
    let mut claims = user();
    assert_eq!(call(token(&claims)).await, StatusCode::UNAUTHORIZED);
    claims["iss"] = json!("api-issuer");
    assert_eq!(call(token(&claims)).await, StatusCode::FORBIDDEN);
    claims["aud"] = json!("user-audience");
    assert_eq!(call(token(&claims)).await, StatusCode::NOT_IMPLEMENTED);
    let next_key: Value = serde_json::from_str(include_str!("fixtures/other-jwk.json")).unwrap();
    shared.write().unwrap()["keys"]
        .as_array_mut()
        .unwrap()
        .push(next_key);
    tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    let next_token = sign(
        &claims,
        include_bytes!("fixtures/other.pem"),
        Some("next-key"),
    );
    assert_eq!(call(next_token).await, StatusCode::NOT_IMPLEMENTED);
    assert_eq!(call(token(&claims)).await, StatusCode::NOT_IMPLEMENTED);
    shared.write().unwrap()["keys"][0]["n"] = json!("broken");
    let config = TrustConfig {
        jwks_url: format!("http://{address}/jwks"),
        issuer: None,
        user_audience: None,
        graph_audience: "graph-service".into(),
        search_audience: "embeddings-service".into(),
    };
    assert!(Authenticator::load(config).await.is_err());
    server.abort();
}

#[tokio::test]
async fn cross_org_roles_do_not_grant_access_to_another_organizations_search() {
    let mut claims = user();
    claims["orgMemberships"][0]["role"] = json!("VIEWER");
    claims["orgMemberships"]
        .as_array_mut()
        .unwrap()
        .push(json!({"orgId":"fc97bf36-99e8-427e-99ab-6d24ea2c2410","role":"OWNER"}));
    let token = token(&claims);
    assert!(authorized(
        request("GET", "/embeddings/search", Some(&token), Value::Null).await
    ));
    assert_eq!(
        request(
            "POST",
            "/orgs/28f52f56-080e-40b6-a81b-2d98bc6e5f30/projects/7693af38-9441-45c5-932e-c7dcbd509b82/embeddings/search",
            Some(&token),
            json!({"organizationId":"fc97bf36-99e8-427e-99ab-6d24ea2c2410"})
        )
        .await,
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn review_graph_rejections_preserve_the_provider_error_shapes() {
    use axum::body::to_bytes;
    let user_token = token(&user());
    let org = "28f52f56-080e-40b6-a81b-2d98bc6e5f30";
    let deletion = format!("/api/organizations/{org}/projection-deletion");
    for (method, path, credential, expected_status, deletion_error) in [
        (
            "GET",
            "/api/nodes?limit=1",
            None,
            StatusCode::UNAUTHORIZED,
            false,
        ),
        (
            "GET",
            "/api/nodes?organizationId=fc97bf36-99e8-427e-99ab-6d24ea2c2410",
            Some(user_token.as_str()),
            StatusCode::FORBIDDEN,
            false,
        ),
        (
            "POST",
            deletion.as_str(),
            None,
            StatusCode::UNAUTHORIZED,
            true,
        ),
        (
            "POST",
            deletion.as_str(),
            Some(user_token.as_str()),
            StatusCode::FORBIDDEN,
            true,
        ),
    ] {
        let mut builder = Request::builder().method(method).uri(path);
        if let Some(credential) = credential {
            builder = builder.header("Authorization", format!("Bearer {credential}"));
        }
        let response = app()
            .oneshot(builder.body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), expected_status);
        if deletion_error && expected_status == StatusCode::UNAUTHORIZED {
            assert_eq!(response.headers()["www-authenticate"], "Bearer");
        }
        let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(body["status"], expected_status.as_u16());
        assert_eq!(body["error"], expected_status.canonical_reason().unwrap());
        assert_eq!(body["path"], path.split('?').next().unwrap());
        assert!(body["timestamp"].as_str().is_some_and(|s| !s.is_empty()));
        if deletion_error {
            let expected = if expected_status == StatusCode::UNAUTHORIZED {
                "Authentication is required"
            } else {
                "The credential is not authorized for this operation"
            };
            assert_eq!(body["message"], expected);
        }
        assert!(body.get("detail").is_none());
    }
    let response = app()
        .oneshot(
            Request::builder()
                .uri("/embeddings/search")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let bytes = to_bytes(response.into_body(), 4096).await.unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    assert!(body["detail"].is_string());
    assert!(body.get("timestamp").is_none());
}
