use std::time::Duration;

use anyhow::{Context, Result, ensure};
use sqlx::{PgPool, postgres::PgPoolOptions};

use crate::config::{Config, DATABASE_NAME};

pub async fn connect_and_migrate(config: &Config) -> Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(config.max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(60))
        .connect_with(config.database.clone())
        .await
        .map_err(|_| anyhow::anyhow!("Cannot connect using GRAPH_SEARCH_DATABASE_URL; check the dedicated database, credentials and network"))?;

    // Inspect before SQLx creates its migration table or performs any schema writes.
    let identity = sqlx::query!(
        r#"SELECT current_database() AS "database!",
                  current_setting('server_version_num')::int AS "version!",
                  EXISTS (SELECT 1 FROM pg_catalog.pg_class
                          WHERE relname = 'flyway_schema_history') AS "flyway!""#
    )
    .fetch_one(&pool)
    .await
    .context("Cannot verify the dedicated database before migration")?;
    ensure!(
        identity.database == DATABASE_NAME,
        "Refusing to migrate a database other than heyhey_graph_search"
    );
    ensure!(
        (170000..180000).contains(&identity.version),
        "Use PostgreSQL 17 for GRAPH_SEARCH_DATABASE_URL"
    );
    ensure!(
        !identity.flyway,
        "Refusing to migrate a Flyway-managed database; provision a separate graph/search database"
    );

    sqlx::migrate!()
        .run(&pool)
        .await
        .context("Graph/search migration failed; use the documented pgvector PostgreSQL 17 image and a role allowed to install extensions")?;
    Ok(pool)
}
