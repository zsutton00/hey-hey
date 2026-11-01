use super::{
    batch,
    generated::*,
    queries,
    store::{self, Scope},
    validation,
};
use crate::auth::{AuthenticatedRouter, Authenticator, Policy, Principal, Surface};
use axum::{
    Extension, Json,
    extract::{Path, Query},
    response::{IntoResponse, Response},
};
use axum::{
    Router,
    http::StatusCode,
    routing::{delete, get, patch, post, put},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;

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
        .route("/relationships/batch", post(create_batch), Policy::User)
        .route("/relationships/{relationshipId}", get(pending), Policy::User)
        .route("/relationships/{relationshipId}", delete(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/feature-project-connection", post(connections), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/traversal", post(traverse), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/incident-edges", post(incident), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/entity-neighborhood", post(neighborhood), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/topology", get(topology), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/entities/{entityId}/provenance", get(provenance), Policy::User)
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

struct Failure(StatusCode, String);
impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<anyhow::Error> for Failure {
    fn from(error: anyhow::Error) -> Self {
        tracing::error!(error=%error,"Graph operation failed");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Graph operation failed".into(),
        )
    }
}
fn invalid(message: impl Into<String>) -> Failure {
    Failure(StatusCode::BAD_REQUEST, message.into())
}
fn scope(org: String, project: String) -> Result<Scope, Failure> {
    if !validation::uuid(&org) || !validation::uuid(&project) {
        return Err(invalid("Invalid organization or project identifier"));
    }
    Ok(Scope {
        organization: org,
        project,
    })
}
async fn traverse(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: SearchRequest = validation::decode("SearchRequest", value).map_err(invalid)?;
    queries::validate_search(&request).map_err(invalid)?;
    Ok(Json(
        queries::search(&pool, &scope(org, project)?, request).await?,
    ))
}
async fn incident(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request = validation::decode("IncidentEdgesRequest", value).map_err(invalid)?;
    Ok(Json(
        queries::incident(&pool, &scope(org, project)?, request).await?,
    ))
}
async fn neighborhood(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request = validation::decode("EntityNeighborhoodRequest", value).map_err(invalid)?;
    Ok(Json(
        queries::neighborhood(&pool, &scope(org, project)?, request).await?,
    ))
}
async fn connections(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: FeatureProjectConnectionRequest =
        validation::decode("FeatureProjectConnectionRequest", value).map_err(invalid)?;
    Ok(Json(
        json!({"connectedCount":store::feature_connections(&pool,&scope(org,project)?,&request.feature_ids).await?}),
    ))
}
async fn topology(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<Value>, Failure> {
    Ok(Json(store::topology(&pool, &scope(org, project)?).await?))
}
#[derive(Deserialize)]
struct Depth {
    depth: Option<i32>,
}
async fn provenance(
    Extension(pool): Extension<PgPool>,
    Path((org, project, id)): Path<(String, String, String)>,
    Query(query): Query<Depth>,
) -> Result<Json<Value>, Failure> {
    let depth = query.depth.unwrap_or(3);
    if !validation::uuid(&id) || !(1..=10).contains(&depth) {
        return Err(invalid("Invalid entity identifier or depth"));
    }
    Ok(Json(
        store::provenance(&pool, &scope(org, project)?, &id, depth).await?,
    ))
}
async fn create_batch(
    Extension(pool): Extension<PgPool>,
    Extension(principal): Extension<Principal>,
    Json(value): Json<Value>,
) -> Result<(StatusCode, Json<Value>), Failure> {
    let request: BatchRelationshipRequest =
        validation::decode("BatchRelationshipRequest", value).map_err(invalid)?;
    let organization = principal.current_org.as_deref().ok_or_else(|| {
        Failure(
            StatusCode::FORBIDDEN,
            "Current organization is required".into(),
        )
    })?;
    principal
        .authorize_tenant(organization, None)
        .map_err(|_| Failure(StatusCode::FORBIDDEN, "Forbidden".into()))?;
    let status = if request
        .relationships
        .iter()
        .any(|r| r.from_artifact_id == r.to_artifact_id)
    {
        StatusCode::BAD_REQUEST
    } else {
        StatusCode::CREATED
    };
    Ok((
        status,
        Json(batch::create(&pool, &principal, request).await?),
    ))
}
