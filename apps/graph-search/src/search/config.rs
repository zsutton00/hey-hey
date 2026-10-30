use anyhow::Result;

#[derive(Clone, Copy)]
pub struct SearchConfig {
    pub enabled: bool,
}

impl SearchConfig {
    pub fn from_lookup(lookup: &impl Fn(&str) -> Result<Option<String>>) -> Result<Self> {
        Ok(Self {
            enabled: crate::config::setting(lookup, "SEARCH_ENABLED", "true")?,
        })
    }
}
