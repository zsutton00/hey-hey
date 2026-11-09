use axum::{extract::State, http::StatusCode};
use sqlx::PgPool;

pub async fn ready(State(pool): State<PgPool>) -> StatusCode {
    match sqlx::query!(r#"SELECT 1 AS "ready!""#)
        .fetch_one(&pool)
        .await
    {
        Ok(_) => StatusCode::OK,
        Err(_) => StatusCode::SERVICE_UNAVAILABLE,
    }
}
