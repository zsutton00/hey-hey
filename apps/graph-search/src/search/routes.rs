use axum::{
    Extension, Json, Router,
    extract::{Path, RawQuery},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use super::{
    encoder::Encoder,
    literal::literal_evidence,
    ranking::rank,
    store::{self, DeletionOutcome, Retrieval},
    wire::{
        BatchSearchRequest, BatchSearchResponse, BatchSearchResult, Invalid, MAX_BATCH_QUERIES,
        ProjectionDeletionCommand, Search, SearchFilters, SearchRequest, SearchResponse,
        SearchResult, StructuredSearchRequest, invalid, parse_get_search,
    },
};
use crate::auth::{AuthenticatedRouter, Authenticator, Policy, Principal, Surface};

/// Arctic Embed retrieves best when queries, but not documents, carry this prefix.
const QUERY_PREFIX: &str = "Represent this sentence for searching relevant passages: ";

/// What search handlers share. The encoder is attached by the process that
/// loaded the model; see `main.rs`.
#[derive(Clone)]
pub struct SearchState {
    pub pool: PgPool,
    pub encoder: Encoder,
    /// Name of the model the stored vectors were encoded with.
    pub model: String,
}

pub fn router(enabled: bool, auth: Authenticator) -> Router {
    if !enabled {
        return Router::new();
    }
    AuthenticatedRouter::new(auth, Surface::Search)
        .route(
            "/orgs/{organizationId}/projection-deletion",
            post(delete_projection),
            Policy::Deletion(Surface::Search),
        )
        .route("/embeddings/search", get(search_get), Policy::Read)
        .route("/embeddings/search", post(search_post), Policy::Read)
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search/structured",
            post(structured_search),
            Policy::Read,
        )
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search",
            get(project_search_get),
            Policy::Read,
        )
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search",
            post(project_search_post),
            Policy::Read,
        )
        .route(
            "/orgs/{organizationId}/projects/{projectId}/embeddings/search/batch",
            post(batch_search),
            Policy::Read,
        )
        .route("/stats", get(stats), Policy::Read)
        .route("/health", get(health), Policy::Read)
        // Debug operations are outside the PostgreSQL search surface.
        .route("/debug", get(not_implemented), Policy::Debug)
        .route("/debug/entity", get(not_implemented), Policy::Debug)
        .finish()
}

async fn not_implemented() -> StatusCode {
    StatusCode::NOT_IMPLEMENTED
}

/// Failures answered with the spec's `ErrorResponse`.
enum Failure {
    Invalid(Invalid),
    Forbidden,
    Internal(anyhow::Error),
}

impl From<Invalid> for Failure {
    fn from(value: Invalid) -> Self {
        Self::Invalid(value)
    }
}

impl From<anyhow::Error> for Failure {
    fn from(value: anyhow::Error) -> Self {
        Self::Internal(value)
    }
}

impl IntoResponse for Failure {
    fn into_response(self) -> Response {
        let (status, error, message, field) = match self {
            Self::Invalid(Invalid {
                field,
                message,
                code,
            }) => (
                StatusCode::BAD_REQUEST,
                code,
                format!("{field} {message}"),
                Some(field),
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden",
                "The requested organization or project is not accessible".into(),
                None,
            ),
            Self::Internal(error) => {
                tracing::error!(error = format!("{error:#}"), "search request failed");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error",
                    "The search request failed".into(),
                    None,
                )
            }
        };
        let mut body = json!({"error": error, "message": message});
        if let Some(field) = field {
            body["details"] = json!({"field": field});
        }
        (status, Json(body)).into_response()
    }
}

/// Parses a JSON body; malformed bodies are validation errors, not 422s.
fn body<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, Failure> {
    serde_json::from_slice(bytes).map_err(|error| invalid("body", error.to_string()).into())
}

#[derive(Deserialize)]
struct ProjectPath {
    #[serde(rename = "organizationId")]
    organization_id: String,
    #[serde(rename = "projectId")]
    project_id: String,
}

/// Filters may restate the path's tenant but never name another one.
fn require_path_tenant(path: &ProjectPath, filters: &SearchFilters) -> Result<(), Failure> {
    let other_org = filters
        .organization_id
        .as_ref()
        .is_some_and(|org| *org != path.organization_id);
    let other_project = filters
        .project_id
        .as_ref()
        .is_some_and(|project| *project != path.project_id);
    if other_org || other_project {
        return Err(Failure::Forbidden);
    }
    Ok(())
}

async fn run_search(
    state: &SearchState,
    organization_id: &str,
    project_id: Option<&str>,
    search: &Search,
) -> Result<SearchResponse, Failure> {
    let vector = match &search.semantic_text {
        Some(text) => Some(
            state
                .encoder
                .encode(&format!("{QUERY_PREFIX}{text}"))
                .await?,
        ),
        None => None,
    };

    let candidates = store::retrieve(
        &state.pool,
        Retrieval {
            organization_id,
            project_id,
            filter: &search.filter,
            keyword_text: search.keyword_text.as_deref(),
            title_only: search.title_only,
            exact: search.exact,
            vector: vector.as_deref(),
        },
    )
    .await?;

    let now = OffsetDateTime::now_utc().unix_timestamp() as f64;
    let page = rank(candidates, search, now);

    let ids: Vec<String> = page.iter().map(|ranked| ranked.id.clone()).collect();
    let mut content = store::load_content(&state.pool, organization_id, &ids).await?;
    // A unit replaced or deleted between the two reads is left out.
    let data: Vec<SearchResult> = page
        .into_iter()
        .filter_map(|ranked| {
            let unit = content.remove(&ranked.id)?;
            let (text, match_spans) = if search.exact {
                let (text, spans) = literal_evidence(unit.text, &unit.metadata, &search.query);
                (text, Some(spans).filter(|spans| !spans.is_empty()))
            } else {
                (unit.text, None)
            };
            Some(SearchResult {
                id: ranked.id,
                text,
                similarity: ranked.similarity,
                metadata: unit.metadata,
                chunk_index: ranked.chunk_index,
                match_type: ranked.match_type,
                match_spans,
            })
        })
        .collect();
    Ok(SearchResponse {
        success: true,
        query: search.query.clone(),
        results: data.len(),
        data,
    })
}

async fn search_get(
    Extension(state): Extension<SearchState>,
    RawQuery(query): RawQuery,
) -> Result<Json<SearchResponse>, Failure> {
    let request = parse_get_search(query.as_deref())?;
    // Authentication already checked these against the caller.
    let organization_id = request
        .organization_id
        .ok_or_else(|| invalid("organizationId", "is required"))?;
    let response = run_search(
        &state,
        &organization_id,
        request.project_id.as_deref(),
        &request.search,
    )
    .await?;
    Ok(Json(response))
}

async fn search_post(
    Extension(state): Extension<SearchState>,
    Extension(principal): Extension<Principal>,
    bytes: axum::body::Bytes,
) -> Result<Json<SearchResponse>, Failure> {
    let request: SearchRequest = body(&bytes)?;
    let (search, filters) = request.validate()?;

    // This operation names its tenant inside filters, which authentication
    // does not read, so it is authorized here.
    let organization_id = filters
        .organization_id
        .clone()
        .or_else(|| principal.current_org.clone())
        .ok_or_else(|| invalid("filters.organizationId", "is required"))?;
    principal
        .authorize_tenant(&organization_id, filters.project_id.as_deref())
        .map_err(|_| Failure::Forbidden)?;

    let response = run_search(
        &state,
        &organization_id,
        filters.project_id.as_deref(),
        &search,
    )
    .await?;
    Ok(Json(response))
}

async fn project_search_get(
    Extension(state): Extension<SearchState>,
    Path(path): Path<ProjectPath>,
    RawQuery(query): RawQuery,
) -> Result<Json<SearchResponse>, Failure> {
    let request = parse_get_search(query.as_deref())?;
    let response = run_search(
        &state,
        &path.organization_id,
        Some(&path.project_id),
        &request.search,
    )
    .await?;
    Ok(Json(response))
}

async fn project_search_post(
    Extension(state): Extension<SearchState>,
    Path(path): Path<ProjectPath>,
    bytes: axum::body::Bytes,
) -> Result<Json<SearchResponse>, Failure> {
    let request: SearchRequest = body(&bytes)?;
    let (search, filters) = request.validate()?;
    require_path_tenant(&path, &filters)?;
    let response = run_search(
        &state,
        &path.organization_id,
        Some(&path.project_id),
        &search,
    )
    .await?;
    Ok(Json(response))
}

async fn structured_search(
    Extension(state): Extension<SearchState>,
    Path(path): Path<ProjectPath>,
    bytes: axum::body::Bytes,
) -> Result<Json<SearchResponse>, Failure> {
    let request: StructuredSearchRequest = body(&bytes)?;
    let (search, filters) = request.validate()?;
    require_path_tenant(&path, &filters)?;
    let response = run_search(
        &state,
        &path.organization_id,
        Some(&path.project_id),
        &search,
    )
    .await?;
    Ok(Json(response))
}

async fn batch_search(
    Extension(state): Extension<SearchState>,
    Path(path): Path<ProjectPath>,
    bytes: axum::body::Bytes,
) -> Result<Json<BatchSearchResponse>, Failure> {
    let request: BatchSearchRequest = body(&bytes)?;
    if request.queries.is_empty() || request.queries.len() > MAX_BATCH_QUERIES {
        return Err(invalid("queries", "must contain 1 to 25 queries").into());
    }

    // Validate every query before running any, so a bad query fails the batch cleanly.
    let mut searches = Vec::with_capacity(request.queries.len());
    for query in request.queries {
        let (search, filters) = query.search.validate()?;
        require_path_tenant(&path, &filters)?;
        searches.push((search, query.query_id));
    }

    let mut results = Vec::with_capacity(searches.len());
    for (search, query_id) in searches {
        let response = run_search(
            &state,
            &path.organization_id,
            Some(&path.project_id),
            &search,
        )
        .await?;
        results.push(BatchSearchResult {
            query: response.query,
            query_id,
            results: response.results,
            data: response.data,
        });
    }
    Ok(Json(BatchSearchResponse {
        success: true,
        results,
    }))
}

async fn stats(
    Extension(state): Extension<SearchState>,
    Extension(principal): Extension<Principal>,
) -> Result<Json<Value>, Failure> {
    let totals = store::totals(&state.pool, principal.current_org.as_deref()).await?;
    Ok(Json(json!({
        "success": true,
        "data": {
            "total_embeddings": totals.units,
            "avg_document_length": totals.average_length,
            "embedding_method": state.model,
        }
    })))
}

async fn health(
    Extension(state): Extension<SearchState>,
    Extension(principal): Extension<Principal>,
) -> Response {
    let timestamp = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("UTC timestamp formats as RFC 3339");
    match store::totals(&state.pool, principal.current_org.as_deref()).await {
        Ok(totals) => Json(json!({
            "status": "healthy",
            "service": "graph-search",
            "timestamp": timestamp,
            "total_embeddings": totals.units,
        }))
        .into_response(),
        Err(error) => {
            tracing::warn!(error = format!("{error:#}"), "search health check failed");
            let body =
                json!({"status": "unhealthy", "service": "graph-search", "timestamp": timestamp});
            (StatusCode::SERVICE_UNAVAILABLE, Json(body)).into_response()
        }
    }
}

fn deletion_error(status: StatusCode, body: Value) -> Response {
    (status, Json(body)).into_response()
}

async fn delete_projection(
    Extension(state): Extension<SearchState>,
    bytes: axum::body::Bytes,
) -> Response {
    // Authentication already bound the credential to the path organization and marker.
    let identity = match serde_json::from_slice::<ProjectionDeletionCommand>(&bytes)
        .map_err(|error| error.to_string())
        .and_then(|command| {
            command
                .validate()
                .map_err(|Invalid { field, message, .. }| format!("{field} {message}"))
        }) {
        Ok(identity) => identity,
        Err(message) => {
            return deletion_error(
                StatusCode::BAD_REQUEST,
                json!({"errorCode": "PROJECTION_DELETION_VALIDATION_FAILED", "message": message}),
            );
        }
    };

    match store::delete_organization(&state.pool, &identity).await {
        Ok(DeletionOutcome::Deleted) => {
            let mut result = identity.to_json();
            result["tombstoneRecorded"] = json!(true);
            result["contentVerificationCompleted"] = json!(true);
            Json(result).into_response()
        }
        Ok(DeletionOutcome::Conflict(retained)) => deletion_error(
            StatusCode::CONFLICT,
            json!({
                "errorCode": "PROJECTION_DELETION_IDENTITY_CONFLICT",
                "message": "A different deletion identity is already retained for this organization",
                "retainedIdentity": retained.to_json(),
            }),
        ),
        Err(error) => {
            tracing::error!(
                error = format!("{error:#}"),
                "search projection deletion failed"
            );
            deletion_error(
                StatusCode::SERVICE_UNAVAILABLE,
                json!({
                    "errorCode": "PROJECTION_DELETION_RETRYABLE_FAILURE",
                    "message": "Projection deletion failed; retry the same command",
                    "retryable": true,
                }),
            )
        }
    }
}
