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
        .route("/organizations/{organizationId}/projects/{projectId}/template-graph", get(template_snapshot), Policy::Template)
        .route("/organizations/{organizationId}/projects/{projectId}/template-graph", put(template_apply), Policy::Template)
        .route("/organizations/{organizationId}/projection-deletion", post(delete_projection), Policy::Deletion(Surface::Graph))
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
        .route("/organizations/{organizationId}/projects/{projectId}/work-item-project-readiness", post(work_item_readiness), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/design-doc-project-readiness", post(design_doc_readiness), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/traversal", post(traverse), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/search-exclusions", post(pending), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/incident-edges", post(incident), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/entity-neighborhood", post(neighborhood), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/topology", get(topology), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/entities/{entityId}/provenance", get(provenance), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges", post(super::agent_edges::create), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges", get(super::agent_edges::list), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/batch", post(super::agent_edges::batch), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/incident-query", post(super::agent_edges::incident), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/incident-delete", post(super::agent_edges::delete_incident), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}", get(super::agent_edges::get), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}", patch(super::agent_edges::update), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/agent-edges/{agentEdgeId}", delete(super::agent_edges::delete), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints", get(super::hints::list), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints", post(super::hints::create), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/connected-items-query", post(super::hints::query), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}", get(super::hints::get), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}", patch(super::hints::update), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}", delete(super::hints::retire), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}/connections", post(super::hints::add), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}/connections/{connectionId}", patch(super::hints::strength), Policy::User)
        .route("/organizations/{organizationId}/projects/{projectId}/hints/{hintId}/connections/{connectionId}", delete(super::hints::remove), Policy::User)
        .route("/admin/backup", post(pending), Policy::User)
        .finish()
}

async fn pending() -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

pub(super) struct Failure(pub(super) StatusCode, pub(super) String);
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
pub(super) fn invalid(message: impl Into<String>) -> Failure {
    Failure(StatusCode::BAD_REQUEST, message.into())
}
pub(super) fn scope(org: String, project: String) -> Result<Scope, Failure> {
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
async fn work_item_readiness(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: WorkItemProjectReadinessRequest =
        validation::decode("WorkItemProjectReadinessRequest", value).map_err(invalid)?;
    let verified =
        store::work_item_readiness(&pool, &scope(org, project)?, &request.work_items).await?;
    Ok(Json(json!({"verifiedCount":verified})))
}
async fn design_doc_readiness(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<Json<Value>, Failure> {
    let request: DesignDocProjectReadinessRequest =
        validation::decode("DesignDocProjectReadinessRequest", value).map_err(invalid)?;
    let verified =
        store::design_doc_readiness(&pool, &scope(org, project)?, &request.design_doc_ids).await?;
    Ok(Json(json!({"verifiedCount":verified})))
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

async fn delete_projection(
    Extension(pool): Extension<PgPool>,
    bytes: axum::body::Bytes,
) -> Response {
    use crate::search::wire::ProjectionDeletionCommand;
    let identity =
        match serde_json::from_slice::<ProjectionDeletionCommand>(&bytes)
            .map_err(|e| e.to_string())
            .and_then(|command| {
                command
                    .validate()
                    .map_err(|e| format!("{} {}", e.field, e.message))
            }) {
            Ok(identity) => identity,
            Err(message) => return (
                StatusCode::BAD_REQUEST,
                Json(
                    json!({"errorCode":"PROJECTION_DELETION_VALIDATION_FAILED","message":message}),
                ),
            )
                .into_response(),
        };
    match super::lifecycle::delete(&pool, &identity).await {
        Ok(super::lifecycle::Outcome::Deleted) => {
            let mut result = identity.to_json();
            result["tombstoneRecorded"] = json!(true);
            result["contentVerificationCompleted"] = json!(true);
            Json(result).into_response()
        }
        Ok(super::lifecycle::Outcome::Conflict(retained)) => (StatusCode::CONFLICT, Json(json!({"errorCode":"PROJECTION_DELETION_IDENTITY_CONFLICT","message":"A different deletion identity is already retained for this organization","retainedIdentity":retained}))).into_response(),
        Err(error) => {
            tracing::error!(error=%error,"Graph projection deletion failed");
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"errorCode":"PROJECTION_DELETION_RETRYABLE_FAILURE","message":"Projection deletion failed; retry the same command","retryable":true}))).into_response()
        }
    }
}

async fn template_snapshot(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
) -> Result<Json<TemplateGraphSnapshot>, Failure> {
    Ok(Json(
        super::template::snapshot(&pool, &scope(org, project)?).await?,
    ))
}
async fn template_apply(
    Extension(pool): Extension<PgPool>,
    Path((org, project)): Path<(String, String)>,
    Json(value): Json<Value>,
) -> Result<StatusCode, Failure> {
    let command = validation::decode("TemplateGraphCopyCommand", value).map_err(invalid)?;
    super::template::apply(&pool, &scope(org, project)?, command).await?;
    Ok(StatusCode::NO_CONTENT)
}
