use crate::auth::{AuthenticatedRouter, Authenticator, Policy, Surface};
use axum::{
    Router,
    http::StatusCode,
    routing::{get, post},
};

pub fn router(enabled: bool, auth: Authenticator) -> Router {
    if !enabled {
        return Router::new();
    }
    AuthenticatedRouter::new(auth, Surface::Search)
        .route(
            "/orgs/{organizationId}/projection-deletion",
            post(pending),
            Policy::Deletion(Surface::Search),
        )
        .route("/embeddings", post(pending), Policy::EmbeddingWrite)
        .route("/embeddings/search", get(pending), Policy::Read)
        .route("/embeddings/search", post(pending), Policy::Read)
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search/structured",
            post(pending),
            Policy::Read,
        )
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search",
            get(pending),
            Policy::Read,
        )
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search",
            post(pending),
            Policy::Read,
        )
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search/batch",
            post(pending),
            Policy::Read,
        )
        .route("/stats", get(pending), Policy::Read)
        .route("/health", get(pending), Policy::Read)
        .route("/debug", get(pending), Policy::Read)
        .route("/debug/entity", get(pending), Policy::Read)
        .finish()
}

async fn pending() -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}
