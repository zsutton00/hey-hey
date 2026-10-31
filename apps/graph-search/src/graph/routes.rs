use crate::auth::{AuthenticatedRouter, Authenticator, Policy, Surface};
use axum::{
    Router,
    http::StatusCode,
    routing::{delete, get, patch, post, put},
};

pub fn router(enabled: bool, auth: Authenticator) -> Router {
    if !enabled {
        return Router::new();
    }
    AuthenticatedRouter::new(auth, Surface::Graph)
        .route("/organizations/{organizationId}/projects/{projectId}/template-graph", get(pending), Policy::Template)
        .route("/organizations/{organizationId}/projects/{projectId}/template-graph", put(pending), Policy::Template)
        .route("/organizations/{organizationId}/projection-deletion", post(pending), Policy::Deletion(Surface::Graph))
        .route("/nodes", post(pending), Policy::User)
        .route("/nodes", get(pending), Policy::User)
        .route("/nodes/{nodeId}", get(pending), Policy::User)
        .route("/nodes/{nodeId}", put(pending), Policy::User)
        .route("/nodes/{nodeId}", delete(pending), Policy::User)
        .route("/relationships", post(pending), Policy::User)
        .route("/relationships", get(pending), Policy::User)
        .route("/relationships/batch", post(pending), Policy::User)
        .route("/relationships/{relationshipId}", get(pending), Policy::User)
        .route("/relationships/{relationshipId}", delete(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/feature-project-connection", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/traversal", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/incident-edges", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/entity-neighborhood", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/topology", get(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/entities/{entityId}/provenance", get(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges", get(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/batch", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/incident-query", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/incident-delete", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}", get(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}", patch(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}", delete(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints", get(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/connected-items-query", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}", get(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}", patch(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}", delete(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}/connections", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}/connections/{connectionId}", patch(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}/connections/{connectionId}", delete(pending), Policy::User)
        .route("/admin/backup", post(pending), Policy::User)
        .finish()
}

async fn pending() -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}
