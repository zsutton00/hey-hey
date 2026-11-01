use anyhow::{Context, Result};
use axum::Extension;
use hey_hey_graph_search::{
    config::Config,
    database,
    search::{self, ingest},
    server,
};
use tracing_subscriber::EnvFilter;

#[tokio::main(worker_threads = 2)]
async fn main() -> Result<()> {
    let filter = match std::env::var("RUST_LOG") {
        Ok(value) => {
            EnvFilter::try_new(value).context("RUST_LOG must be a valid tracing filter")?
        }
        Err(std::env::VarError::NotPresent) => EnvFilter::new("info"),
        Err(_) => anyhow::bail!("RUST_LOG must contain valid Unicode"),
    };
    tracing_subscriber::fmt()
        .with_env_filter(filter)
        .json()
        .init();

    let config = Config::from_env()?;
    let auth = hey_hey_graph_search::auth::Authenticator::from_env().await?;
    // Load the model before touching the database so a missing file fails fast.
    let encoder = config
        .search
        .enabled
        .then(|| search::encoder::Encoder::load(&config.search.encoder))
        .transpose()?;
    let pool = database::connect_and_migrate(&config).await?;
    let mut app = server::router(&config, pool.clone(), auth);
    let graph_events = if config.graph.enabled {
        let settings = ingest::config::EventsConfig::from_lookup(&|key| {
            if key == "SEARCH_EVENTS_ENABLED" {
                return Ok(Some("true".into()));
            }
            let key = key.replace("SEARCH_EVENT_", "GRAPH_EVENT_");
            Ok(std::env::var(key).ok())
        })?
        .expect("graph event ingestion is always enabled with graph");
        Some(ingest::consumer::Consumer::start_graph(
            settings,
            hey_hey_graph_search::graph::ingest::Ingest::new(pool.clone()),
        ))
    } else {
        None
    };
    let mut events = None;
    if let Some(encoder) = encoder {
        search::model_record::verify(&pool, &config.search.encoder).await?;
        // The consumer is isolated from the HTTP server: it shares only the
        // pool and the bounded encoder, and its failures never reach a request.
        if let Some(settings) = events_config()? {
            events = Some(ingest::consumer::Consumer::start(
                settings,
                ingest::Ingest::new(pool.clone(), encoder.clone()),
            ));
        }
        app = app.layer(Extension(search::routes::SearchState {
            pool: pool.clone(),
            encoder,
            model: config.search.encoder.model.clone(),
        }));
    }
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .context("Cannot bind GRAPH_SEARCH_BIND; choose an available address and port")?;
    tracing::info!(address = %listener.local_addr()?, "graph/search ready");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown())
        .await?;
    if let Some(events) = events {
        events.stop().await;
    }
    if let Some(events) = graph_events {
        events.stop().await;
    }
    pool.close().await;
    Ok(())
}

fn events_config() -> Result<Option<ingest::config::EventsConfig>> {
    ingest::config::EventsConfig::from_lookup(&|key| match std::env::var(key) {
        Ok(value) => Ok(Some(value)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        Err(_) => anyhow::bail!("{key} must contain valid Unicode"),
    })
}

async fn shutdown() {
    let interrupt = async {
        tokio::signal::ctrl_c()
            .await
            .expect("install Ctrl-C handler")
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! {
        _ = interrupt => {},
        _ = terminate => {},
    }
    tracing::info!("shutting down");
}
