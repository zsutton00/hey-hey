use anyhow::Result;

#[derive(Clone, Copy)]
pub struct GraphConfig {
    pub enabled: bool,
}

impl GraphConfig {
    pub fn from_lookup(lookup: &impl Fn(&str) -> Result<Option<String>>) -> Result<Self> {
        Ok(Self {
            enabled: crate::config::setting(lookup, "GRAPH_ENABLED", "true")?,
        })
    }
}
