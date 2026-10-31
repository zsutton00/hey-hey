mod common;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use hey_hey_graph_search::{config::Config, server};
use sqlx::postgres::PgPoolOptions;
use tower::ServiceExt;

const URL: &str = "postgres://graph_search:secret@localhost/heyhey_graph_search";

fn config(overrides: &[(&str, &str)]) -> anyhow::Result<Config> {
    Config::from_lookup(|key| {
        Ok(overrides
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.to_string()))
    })
}

#[test]
fn configuration_requires_an_explicit_dedicated_database_and_redacts_secrets() {
    assert!(
        config(&[])
            .err()
            .unwrap()
            .to_string()
            .contains("GRAPH_SEARCH_DATABASE_URL")
    );
    for url in [
        "postgres://api:secret@localhost/project",
        "postgres://api:secret@localhost",
        "not a url secret",
    ] {
        let error = config(&[("GRAPH_SEARCH_DATABASE_URL", url)])
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains("GRAPH_SEARCH_DATABASE_URL"));
        assert!(!error.contains("secret"));
    }
    let valid = config(&[("GRAPH_SEARCH_DATABASE_URL", URL)]).unwrap();
    assert_eq!(valid.max_connections, 5);
    assert!(valid.bind.ip().is_loopback());
}

#[test]
fn invalid_environment_settings_fail_with_the_setting_name() {
    for (key, value) in [
        ("GRAPH_SEARCH_BIND", "not-an-address"),
        ("GRAPH_SEARCH_MAX_CONNECTIONS", "0"),
        ("GRAPH_SEARCH_MAX_CONNECTIONS", "101"),
        ("GRAPH_ENABLED", "yes"),
        ("SEARCH_ENABLED", ""),
        ("SEARCH_EMBEDDING_DIMENSION", "0"),
        ("SEARCH_EMBEDDING_MAX_BATCH", "0"),
        ("SEARCH_EMBEDDING_MAX_BATCH", "9"),
    ] {
        let error = config(&[("GRAPH_SEARCH_DATABASE_URL", URL), (key, value)])
            .err()
            .unwrap()
            .to_string();
        assert!(error.contains(key));
    }
}

#[tokio::test]
async fn surfaces_are_independent_and_readiness_detects_an_unavailable_database() {
    for (graph, search) in [(true, false), (false, true), (true, true)] {
        let config = config(&[
            ("GRAPH_SEARCH_DATABASE_URL", URL),
            ("GRAPH_ENABLED", if graph { "true" } else { "false" }),
            ("SEARCH_ENABLED", if search { "true" } else { "false" }),
        ])
        .unwrap();
        let pool = PgPoolOptions::new().connect_lazy_with(config.database.clone());
        pool.close().await;
        let app = server::router(&config, pool, common::auth());
        for (path, expected) in [
            (
                "/api/nodes",
                if graph {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::NOT_FOUND
                },
            ),
            (
                "/embeddings/search",
                if search {
                    StatusCode::UNAUTHORIZED
                } else {
                    StatusCode::NOT_FOUND
                },
            ),
            ("/healthz", StatusCode::SERVICE_UNAVAILABLE),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), expected, "{path}");
        }
    }
}
