#![allow(dead_code)]
use axum::{Json, extract::Path, http::StatusCode, routing::get};
use hey_hey_graph_search::auth::{Authenticator, TrustConfig};
use serde_json::json;
use std::sync::{Arc, RwLock};

fn trust(jwks_url: String) -> TrustConfig {
    TrustConfig {
        jwks_url,
        issuer: None,
        user_audience: None,
        graph_audience: "graph-service".into(),
        search_audience: "embeddings-service".into(),
    }
}

fn keys() -> jsonwebtoken::jwk::JwkSet {
    serde_json::from_str(include_str!("../fixtures/jwks.json")).unwrap()
}

/// Trust with no reachable API: any project-access question is denied.
pub fn auth() -> Authenticator {
    Authenticator::from_jwks(trust("http://127.0.0.1:1/jwks".into()), keys()).unwrap()
}

/// Stand-in for the API's current project policy. Tests change `projects` to grant
/// or revoke access; the service must observe the change without a new token.
pub struct ProjectApi {
    pub auth: Authenticator,
    pub projects: Arc<RwLock<Vec<String>>>,
}

pub async fn project_api(projects: &[&str]) -> ProjectApi {
    let allowed = Arc::new(RwLock::new(
        projects.iter().map(|p| p.to_string()).collect::<Vec<_>>(),
    ));
    let list = allowed.clone();
    let one = allowed.clone();
    let api = axum::Router::new()
        .route(
            "/api/v1/organizations/{organizationId}/projects",
            get(move || {
                let data: Vec<_> = list
                    .read()
                    .unwrap()
                    .iter()
                    .map(|id| json!({ "id": id }))
                    .collect();
                async move { Json(json!({ "success": true, "data": data })) }
            }),
        )
        .route(
            "/api/v1/organizations/{organizationId}/projects/{projectId}",
            get(move |Path((_, project)): Path<(String, String)>| {
                let status = if one.read().unwrap().contains(&project) {
                    StatusCode::OK
                } else {
                    StatusCode::FORBIDDEN
                };
                async move { status }
            }),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, api).await.unwrap() });
    ProjectApi {
        auth: Authenticator::from_jwks(trust(format!("http://{address}/api/v1/auth/jwks")), keys())
            .unwrap(),
        projects: allowed,
    }
}
