//! Combines text and meaning signals into one ordered, paginated result list.

use super::{
    store::Candidate,
    wire::{MatchType, Search, SearchType},
};

/// One unit on the requested page, in rank order.
pub struct Ranked {
    pub id: String,
    pub chunk_index: i32,
    pub similarity: f64,
    pub match_type: MatchType,
}

/// Share of a hybrid score that comes from meaning; the rest is text matching.
const SEMANTIC_WEIGHT: f64 = 0.7;
const RECENCY_BOOST: f64 = 0.05;
const RECENCY_DAYS: f64 = 30.0;

pub fn rank(candidates: Vec<Candidate>, search: &Search, now_epoch: f64) -> Vec<Ranked> {
    let top_keyword = candidates
        .iter()
        .filter_map(|candidate| candidate.keyword)
        .fold(0.0_f64, f64::max);

    let mut scored: Vec<(f64, Candidate)> = candidates
        .into_iter()
        .filter_map(|candidate| {
            let semantic = candidate.semantic.map(|score| score.clamp(0.0, 1.0));
            let keyword = candidate
                .keyword
                .filter(|_| top_keyword > 0.0)
                .map(|score| score / top_keyword);

            let base = match search.search_type {
                SearchType::Semantic => semantic?,
                SearchType::Keyword => keyword?,
                SearchType::Hybrid => {
                    SEMANTIC_WEIGHT * semantic.unwrap_or(0.0)
                        + (1.0 - SEMANTIC_WEIGHT) * keyword.unwrap_or(0.0)
                }
            };
            let score = base + boost(&candidate, search, now_epoch);
            Some((score, candidate))
        })
        .collect();

    scored.sort_by(|left, right| right.0.total_cmp(&left.0));

    // The threshold is relative to the top hit, as the spec describes.
    let top = scored.first().map_or(0.0, |(score, _)| *score);
    let offset = usize::try_from(search.offset).unwrap_or(usize::MAX);
    let limit = usize::try_from(search.max_results).unwrap_or(usize::MAX);

    scored
        .into_iter()
        .filter(|(score, _)| top > 0.0 && score / top >= search.threshold)
        .skip(offset)
        .take(limit)
        .map(|(score, candidate)| Ranked {
            match_type: match (candidate.semantic, candidate.keyword) {
                (Some(_), Some(_)) if search.search_type == SearchType::Hybrid => MatchType::Hybrid,
                (Some(_), _) if search.search_type != SearchType::Keyword => MatchType::Semantic,
                _ => MatchType::Keyword,
            },
            id: candidate.id,
            similarity: score.clamp(0.0, 1.0),
            chunk_index: candidate.chunk_index,
        })
        .collect()
}

fn boost(candidate: &Candidate, search: &Search, now_epoch: f64) -> f64 {
    let type_boost: f64 = search
        .boosts
        .iter()
        .filter(|boost| {
            boost.kind.eq_ignore_ascii_case(&candidate.kind)
                || candidate
                    .task_type
                    .as_deref()
                    .is_some_and(|task_type| boost.kind.eq_ignore_ascii_case(task_type))
        })
        .map(|boost| boost.weight)
        .sum();

    let recency = match (search.boost_recent, candidate.created_epoch) {
        (true, Some(created)) => {
            let age_days = ((now_epoch - created) / 86_400.0).max(0.0);
            RECENCY_BOOST * (-age_days / RECENCY_DAYS).exp()
        }
        _ => 0.0,
    };
    type_boost + recency
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::search::wire::Filter;

    fn candidate(id: &str, semantic: Option<f64>, keyword: Option<f64>) -> Candidate {
        Candidate {
            id: id.into(),
            chunk_index: 0,
            kind: "task".into(),
            task_type: Some("STANDARD".into()),
            created_epoch: None,
            semantic,
            keyword,
        }
    }

    fn search(search_type: SearchType, threshold: f64, offset: u32, max_results: u32) -> Search {
        Search {
            query: "q".into(),
            keyword_text: Some("q".into()),
            semantic_text: Some("q".into()),
            search_type,
            title_only: false,
            exact: false,
            max_results,
            offset,
            threshold,
            boosts: Vec::new(),
            boost_recent: false,
            filter: Filter::default(),
        }
    }

    fn ids(results: &[Ranked]) -> Vec<&str> {
        results.iter().map(|result| result.id.as_str()).collect()
    }

    #[test]
    fn threshold_is_relative_to_the_top_hit_and_pagination_follows_ordering() {
        let candidates = || {
            vec![
                candidate("weak", Some(0.05), None),
                candidate("best", Some(0.9), Some(2.0)),
                candidate("good", Some(0.6), Some(1.0)),
                candidate("text-only", None, Some(1.5)),
            ]
        };

        let all = rank(candidates(), &search(SearchType::Hybrid, 0.0, 0, 10), 0.0);
        assert_eq!(ids(&all), ["best", "good", "text-only", "weak"]);
        assert_eq!(all[0].match_type, MatchType::Hybrid);
        assert_eq!(all[2].match_type, MatchType::Keyword);

        let filtered = rank(candidates(), &search(SearchType::Hybrid, 0.4, 0, 10), 0.0);
        assert_eq!(ids(&filtered), ["best", "good"]);

        let page = rank(candidates(), &search(SearchType::Hybrid, 0.0, 1, 2), 0.0);
        assert_eq!(ids(&page), ["good", "text-only"]);
    }

    #[test]
    fn single_signal_searches_use_only_their_signal() {
        let candidates = || {
            vec![
                candidate("meaning", Some(0.8), None),
                candidate("words", None, Some(1.0)),
            ]
        };
        let semantic = rank(candidates(), &search(SearchType::Semantic, 0.0, 0, 10), 0.0);
        assert_eq!(ids(&semantic), ["meaning"]);
        let keyword = rank(candidates(), &search(SearchType::Keyword, 0.0, 0, 10), 0.0);
        assert_eq!(ids(&keyword), ["words"]);
    }
}
