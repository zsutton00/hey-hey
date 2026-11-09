use std::{net::SocketAddr, str::FromStr};

use anyhow::{Context, Result, bail};
use sqlx::postgres::PgConnectOptions;

use crate::{graph::config::GraphConfig, search::config::SearchConfig};

pub const DATABASE_NAME: &str = "heyhey_graph_search";

pub struct Config {
    pub database: PgConnectOptions,
    pub bind: SocketAddr,
    pub max_connections: u32,
    pub graph: GraphConfig,
    pub search: SearchConfig,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Self::from_lookup(|key| match std::env::var(key) {
            Ok(value) => Ok(Some(value)),
            Err(std::env::VarError::NotPresent) => Ok(None),
            Err(_) => bail!("{key} must contain valid Unicode"),
        })
    }

    pub fn from_lookup(lookup: impl Fn(&str) -> Result<Option<String>>) -> Result<Self> {
        let url = lookup("GRAPH_SEARCH_DATABASE_URL")?.context(
            "Set GRAPH_SEARCH_DATABASE_URL to the dedicated heyhey_graph_search database",
        )?;
        // Never print the URL or its parse error: either can contain credentials.
        let database = PgConnectOptions::from_str(&url).map_err(|_| {
            anyhow::anyhow!("GRAPH_SEARCH_DATABASE_URL must be a valid PostgreSQL connection URL")
        })?;
        if database.get_database() != Some(DATABASE_NAME) {
            bail!(
                "GRAPH_SEARCH_DATABASE_URL must name heyhey_graph_search, never the API database"
            );
        }

        let bind = setting(&lookup, "GRAPH_SEARCH_BIND", "127.0.0.1:8090")?;
        let max_connections = setting(&lookup, "GRAPH_SEARCH_MAX_CONNECTIONS", "5")?;
        if !(1..=100).contains(&max_connections) {
            bail!("GRAPH_SEARCH_MAX_CONNECTIONS must be between 1 and 100");
        }

        Ok(Self {
            database,
            bind,
            max_connections,
            graph: GraphConfig::from_lookup(&lookup)?,
            search: SearchConfig::from_lookup(&lookup)?,
        })
    }
}

pub(crate) fn setting<T: FromStr>(
    lookup: &impl Fn(&str) -> Result<Option<String>>,
    name: &str,
    default: &str,
) -> Result<T> {
    let value = lookup(name)?.unwrap_or_else(|| default.to_owned());
    value.parse().map_err(|_| {
        anyhow::anyhow!("Invalid {name}; expected the same format as its default ({default})")
    })
}
