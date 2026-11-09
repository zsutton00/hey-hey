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

/// The text to return and its spans. Spans are valid only for the text returned
/// with them, so a phrase found only in the title returns the title, and any
/// phrase found in the body returns the full text.
pub fn literal_evidence(text: String, metadata: &Value, query: &str) -> (String, Vec<MatchSpan>) {
    let title = title_of(metadata);
    let body = match title {
        Some(title) => text.strip_prefix(title).unwrap_or(&text),
        None => &text,
    };
    if !literal_spans(body, query).is_empty() {
        let spans = literal_spans(&text, query);
        return (text, spans);
    }

    if let Some(title) = title {
        let title_spans = literal_spans(title, query);
        if !title_spans.is_empty() {
            return (title.to_string(), title_spans);
        }
    }
    let spans = literal_spans(&text, query);
    (text, spans)
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
    fn a_title_only_match_ignores_the_stored_body_that_follows_the_title() {
        let metadata = json!({ "name": "Exact title literal 42 phrase" });
        let stored = "Exact title literal 42 phrase\n\nevidence_text:\nUnrelated body";
        let (text, spans) = literal_evidence(stored.into(), &metadata, "literal 42 phrase");
        assert_eq!(text, "Exact title literal 42 phrase");
        assert_eq!((spans[0].start, spans[0].end), (12, 29));
    }

    #[test]
    fn a_body_match_returns_the_full_text() {
        let metadata = json!({ "name": "Title" });
        let (text, spans) = literal_evidence("Title\n\n😀 needle".into(), &metadata, "needle");
        assert_eq!(text, "Title\n\n😀 needle");
        assert_eq!(spans.len(), 1);
    }

    #[test]
    fn surrounding_whitespace_is_part_of_the_phrase() {
        assert!(literal_spans("x foo", " foo ").is_empty());
        assert_eq!(literal_spans("x foo y", " foo ").len(), 1);
    }
}
