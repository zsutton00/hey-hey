mod common;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use hey_hey_graph_search::{config::Config, database::connect_and_migrate, search, server};
use tower::ServiceExt;

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL 17 database; see README"]
async fn startup_migrates_restarts_and_refuses_flyway() -> anyhow::Result<()> {
    let url = std::env::var("GRAPH_SEARCH_TEST_DATABASE_URL")?;
    let config =
        Config::from_lookup(|key| Ok((key == "GRAPH_SEARCH_DATABASE_URL").then(|| url.clone())))?;
    let pool = connect_and_migrate(&config).await?;
    let versions: Vec<String> = sqlx::query_scalar("SELECT extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm') ORDER BY extname").fetch_all(&pool).await?;
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[1], "0.8.7");
    let primitives: bool = sqlx::query_scalar("SELECT '[1,2,3]'::vector <-> '[1,2,3]'::vector = 0 AND similarity('graph', 'graph') = 1 AND to_tsvector('english', 'search foundation') @@ plainto_tsquery('english', 'search')").fetch_one(&pool).await?;
    assert!(primitives);
    let schemas: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM pg_namespace WHERE nspname IN ('graph', 'search')",
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(schemas, 2);
    let migrations: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE success")
        .fetch_one(&pool)
        .await?;
    assert_eq!(migrations, 2);
    let response = server::router(&config, pool.clone(), common::auth())
        .oneshot(Request::builder().uri("/healthz").body(Body::empty())?)
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    pool.close().await;

    let restarted = connect_and_migrate(&config).await?;
    let repeated: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations WHERE success")
        .fetch_one(&restarted)
        .await?;
    assert_eq!(migrations, repeated);

    // This database is disposable and dedicated to this test, never the API's.
    sqlx::query("CREATE TABLE public.flyway_schema_history (version text)")
        .execute(&restarted)
        .await?;
    let rejected = connect_and_migrate(&config).await;
    sqlx::query("DROP TABLE public.flyway_schema_history")
        .execute(&restarted)
        .await?;
    assert!(
        rejected
            .expect_err("Flyway database must be rejected")
            .to_string()
            .contains("Flyway")
    );
    restarted.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires a disposable PostgreSQL 17 database; see README"]
async fn startup_refuses_a_database_encoded_with_a_different_model() -> anyhow::Result<()> {
    let url = std::env::var("GRAPH_SEARCH_TEST_DATABASE_URL")?;
    let config_with = |dimension: &'static str| {
        let url = url.clone();
        Config::from_lookup(move |key| {
            Ok(match key {
                "GRAPH_SEARCH_DATABASE_URL" => Some(url.clone()),
                "SEARCH_EMBEDDING_DIMENSION" => Some(dimension.to_owned()),
                _ => None,
            })
        })
    };
    let recorded = config_with("384")?;
    let pool = connect_and_migrate(&recorded).await?;
    sqlx::query("DELETE FROM search.embedding_model")
        .execute(&pool)
        .await?;

    search::model_record::verify(&pool, &recorded.search.encoder).await?;
    search::model_record::verify(&pool, &recorded.search.encoder).await?;
    let changed = config_with("768")?;
    let rejected = search::model_record::verify(&pool, &changed.search.encoder).await;

    sqlx::query("DELETE FROM search.embedding_model")
        .execute(&pool)
        .await?;
    pool.close().await;
    let message = rejected
        .expect_err("a different dimension must be refused")
        .to_string();
    assert!(message.contains("re-encoded"), "{message}");
    assert!(
        message.contains("384") && message.contains("768"),
        "{message}"
    );
    Ok(())
}
