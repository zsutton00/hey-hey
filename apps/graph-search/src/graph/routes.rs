use axum::{Router, http::StatusCode};

use super::config::GraphConfig;

pub fn router(config: GraphConfig) -> Router {
    Router::new().fallback(move || async move {
        if config.enabled {
            StatusCode::NOT_IMPLEMENTED
        } else {
            StatusCode::NOT_FOUND
        }
    })
}
