use axum::{Router, http::StatusCode};

use super::config::SearchConfig;

pub fn router(config: SearchConfig) -> Router {
    Router::new().fallback(move || async move {
        if config.enabled {
            StatusCode::NOT_IMPLEMENTED
        } else {
            StatusCode::NOT_FOUND
        }
    })
}
