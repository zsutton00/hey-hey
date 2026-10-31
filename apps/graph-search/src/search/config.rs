use std::path::PathBuf;

use anyhow::{Result, bail};

use crate::config::setting;

#[derive(Clone)]
pub struct SearchConfig {
    pub enabled: bool,
    pub encoder: EncoderConfig,
}

#[derive(Clone)]
pub struct EncoderConfig {
    /// Hugging Face model name under the Snowflake organization; recorded with
    /// every stored vector so a model change is an explicit re-encode.
    pub model: String,
    pub dimension: usize,
    /// Memory grows almost linearly with batch size and throughput does not,
    /// so the default encodes one text at a time.
    pub max_batch: usize,
    pub model_dir: PathBuf,
}

impl SearchConfig {
    pub fn from_lookup(lookup: &impl Fn(&str) -> Result<Option<String>>) -> Result<Self> {
        Ok(Self {
            enabled: setting(lookup, "SEARCH_ENABLED", "true")?,
            encoder: EncoderConfig::from_lookup(lookup)?,
        })
    }
}

impl EncoderConfig {
    fn from_lookup(lookup: &impl Fn(&str) -> Result<Option<String>>) -> Result<Self> {
        let model: String = setting(lookup, "SEARCH_EMBEDDING_MODEL", "snowflake-arctic-embed-s")?;
        if model.is_empty() {
            bail!("SEARCH_EMBEDDING_MODEL must name a model");
        }

        let dimension = setting(lookup, "SEARCH_EMBEDDING_DIMENSION", "384")?;
        if !(1..=4096).contains(&dimension) {
            bail!("SEARCH_EMBEDDING_DIMENSION must be between 1 and 4096");
        }

        let max_batch = setting(lookup, "SEARCH_EMBEDDING_MAX_BATCH", "1")?;
        if !(1..=8).contains(&max_batch) {
            bail!("SEARCH_EMBEDDING_MAX_BATCH must be between 1 and 8");
        }

        let default_dir = format!("models/{model}");
        let model_dir = setting(lookup, "SEARCH_EMBEDDING_MODEL_DIR", &default_dir)?;

        Ok(Self {
            model,
            dimension,
            max_batch,
            model_dir,
        })
    }
}
