//! Where an exact search matched, as spans over the text returned with them.

use serde::Serialize;
use serde_json::Value;

/// A literal occurrence of the query, as UTF-16 offsets into the returned text.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MatchSpan {
    pub start: usize,
    pub end: usize,
    pub strength: f64,
}

fn fold(c: char) -> char {
    c.to_lowercase().next().unwrap_or(c)
}

/// Every non-overlapping case-insensitive occurrence of `query` in `text`.
pub fn literal_spans(text: &str, query: &str) -> Vec<MatchSpan> {
    let haystack: Vec<char> = text.chars().map(fold).collect();
    let needle: Vec<char> = query.chars().map(fold).collect();
    if needle.is_empty() || needle.len() > haystack.len() {
        return Vec::new();
    }

    let mut offsets = Vec::with_capacity(haystack.len() + 1);
    let mut position = 0;
    offsets.push(position);
    for c in text.chars() {
        position += c.len_utf16();
        offsets.push(position);
    }

    let mut spans = Vec::new();
    let mut index = 0;
    while index + needle.len() <= haystack.len() {
        if haystack[index..index + needle.len()] == needle[..] {
            spans.push(MatchSpan {
                start: offsets[index],
                end: offsets[index + needle.len()],
                strength: 1.0,
            });
            index += needle.len();
        } else {
            index += 1;
        }
    }
    spans
}

fn title_of(metadata: &Value) -> Option<&str> {
    ["name", "title", "featureName"]
        .into_iter()
        .find_map(|key| metadata.get(key).and_then(Value::as_str))
        .filter(|title| !title.is_empty())
}

/// The text to return and its spans: the body when it contains the phrase,
/// otherwise the matching title, since spans are valid only for the text
/// returned with them.
pub fn literal_evidence(text: String, metadata: &Value, query: &str) -> (String, Vec<MatchSpan>) {
    let spans = literal_spans(&text, query);
    if !spans.is_empty() {
        return (text, spans);
    }
    match title_of(metadata) {
        Some(title) => {
            let title_spans = literal_spans(title, query);
            if title_spans.is_empty() {
                (text, spans)
            } else {
                (title.to_string(), title_spans)
            }
        }
        None => (text, spans),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn spans_are_utf16_offsets_for_every_case_insensitive_occurrence() {
        let spans = literal_spans("😀 Foo and foo", "FOO");
        let ranges: Vec<_> = spans.iter().map(|s| (s.start, s.end)).collect();
        assert_eq!(ranges, [(3, 6), (11, 14)]);
    }

    #[test]
    fn a_title_only_match_returns_the_title_as_the_span_source() {
        let metadata = json!({ "name": "Fix buildTurnInputs" });
        let (text, spans) = literal_evidence("unrelated".into(), &metadata, "buildturninputs");
        assert_eq!(text, "Fix buildTurnInputs");
        assert_eq!((spans[0].start, spans[0].end), (4, 19));
    }

    #[test]
    fn surrounding_whitespace_is_part_of_the_phrase() {
        assert!(literal_spans("x foo", " foo ").is_empty());
        assert_eq!(literal_spans("x foo y", " foo ").len(), 1);
    }
}
