use anyhow::{Result, bail};

use crate::config::setting;

/// How the search consumer reads events. Names match the API and the deployed
/// Embeddings service where they exist there.
#[derive(Clone)]
pub struct EventsConfig {
    pub redis_url: String,
    pub channel_prefix: String,
    /// Events of one item always use the same lane, so they apply in order.
    pub lanes: usize,
    /// Events waiting per lane before the reader waits for the lane.
    pub lane_capacity: usize,
}

impl EventsConfig {
    /// `None` when event consumption is switched off.
    pub fn from_lookup(lookup: &impl Fn(&str) -> Result<Option<String>>) -> Result<Option<Self>> {
        let enabled: bool = setting(lookup, "SEARCH_EVENTS_ENABLED", "true")?;
        if !enabled {
            return Ok(None);
        }

        let Some(redis_url) = lookup("REDIS_URL")?.filter(|url| !url.is_empty()) else {
            bail!(
                "Set REDIS_URL to the Redis the API publishes events to, \
                 or SEARCH_EVENTS_ENABLED=false to run search without event ingestion"
            );
        };

        let lanes = setting(lookup, "SEARCH_EVENT_LANES", "4")?;
        if !(1..=64).contains(&lanes) {
            bail!("SEARCH_EVENT_LANES must be between 1 and 64");
        }
        let lane_capacity = setting(lookup, "SEARCH_EVENT_LANE_CAPACITY", "64")?;
        if !(1..=10_000).contains(&lane_capacity) {
            bail!("SEARCH_EVENT_LANE_CAPACITY must be between 1 and 10000");
        }

        Ok(Some(Self {
            redis_url,
            channel_prefix: setting(lookup, "EVENTS_CHANNEL_PREFIX", "hey-hey:bus:")?,
            lanes,
            lane_capacity,
        }))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn config(pairs: &[(&str, &str)]) -> Result<Option<EventsConfig>> {
        let values: HashMap<_, _> = pairs.iter().copied().collect();
        EventsConfig::from_lookup(&|key| Ok(values.get(key).map(|value| (*value).to_owned())))
    }

    #[test]
    fn events_need_a_redis_url_unless_switched_off() {
        assert!(config(&[]).is_err());
        assert!(
            config(&[("SEARCH_EVENTS_ENABLED", "false")])
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn defaults_match_the_api_channel_prefix() {
        let config = config(&[("REDIS_URL", "redis://localhost:6379")])
            .unwrap()
            .unwrap();
        assert_eq!(config.channel_prefix, "hey-hey:bus:");
        assert_eq!((config.lanes, config.lane_capacity), (4, 64));
    }

    #[test]
    fn lane_count_is_bounded() {
        let pairs = [("REDIS_URL", "redis://x"), ("SEARCH_EVENT_LANES", "0")];
        assert!(config(&pairs).is_err());
    }
}
