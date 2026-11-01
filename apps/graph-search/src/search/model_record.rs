use anyhow::{Context, Result, bail};
use sqlx::PgPool;

use super::config::EncoderConfig;

/// Records the configured model on first start, then refuses to run against
/// vectors encoded with a different model or dimension.
pub async fn verify(pool: &PgPool, config: &EncoderConfig) -> Result<()> {
    let dimension = i32::try_from(config.dimension)?;
    sqlx::query(
        "INSERT INTO search.embedding_model (model, dimension) VALUES ($1, $2)
         ON CONFLICT (singleton) DO NOTHING",
    )
    .bind(&config.model)
    .bind(dimension)
    .execute(pool)
    .await
    .context("Cannot record the search embedding model")?;

    let (recorded_model, recorded_dimension): (String, i32) =
        sqlx::query_as("SELECT model, dimension FROM search.embedding_model")
            .fetch_one(pool)
            .await
            .context("Cannot read the recorded search embedding model")?;

    if recorded_model != config.model || recorded_dimension != dimension {
        bail!(
            "The search database holds {recorded_dimension}-dimension vectors from {recorded_model}, \
             but the service is configured for {dimension}-dimension vectors from {}. \
             Stored vectors must be re-encoded with the new model before the service can start; \
             otherwise restore SEARCH_EMBEDDING_MODEL and SEARCH_EMBEDDING_DIMENSION.",
            config.model
        );
    }
    Ok(())
}
