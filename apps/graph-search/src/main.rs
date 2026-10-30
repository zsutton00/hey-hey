use anyhow::{Context, Result};
use hey_hey_graph_search::{config::Config, database, server};
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
    let pool = database::connect_and_migrate(&config).await?;
    let listener = tokio::net::TcpListener::bind(config.bind)
        .await
        .context("Cannot bind GRAPH_SEARCH_BIND; choose an available address and port")?;
    tracing::info!(address = %listener.local_addr()?, "graph/search foundation ready");
    axum::serve(listener, server::router(&config, pool.clone()))
        .with_graceful_shutdown(shutdown())
        .await?;
    pool.close().await;
    Ok(())
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
