use axum::{Router, routing::get};
use sqlx::PgPool;

use crate::{config::Config, graph, health, search};

pub fn router(config: &Config, pool: PgPool, auth: crate::auth::Authenticator) -> Router {
    // Graph's spec has an /api server prefix; embeddings paths are rooted at /.
    // /healthz is process readiness, not the embeddings spec's /health operation.
    let health = Router::new()
        .route("/healthz", get(health::ready))
        .with_state(pool);
    search::routes::router(config.search.enabled, auth.clone())
        .nest("/api", graph::routes::router(config.graph.enabled, auth))
        .merge(health)
}
