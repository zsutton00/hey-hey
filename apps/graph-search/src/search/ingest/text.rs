//! The searchable text of a work item: its name plus its textual sections.
//!
//! A section is textual when its current content is a string that is not a
//! structured JSON payload. An html/css payload contributes the text of its
//! HTML; styles, scripts, markup and layout never do.

use std::sync::LazyLock;

use regex::Regex;
use serde_json::Value;

use super::{error::IngestError, event::Section, html_css::HtmlCss};

macro_rules! patterns {
    ($($name:ident = $pattern:expr;)*) => {
        $(static $name: LazyLock<Regex> =
            LazyLock::new(|| Regex::new($pattern).expect("pattern is valid"));)*
    };
}

patterns! {
    HTML_COMMENT = r"(?s)<!--.*?-->";
    HTML_HIDDEN = r"(?is)<(script|style|template|noscript)\b[^>]*>.*?</(script|style|template|noscript)\s*>";
    HTML_TAG = r"(?s)<[^>]*>";
    SPACES = r"\s+";
    CODE_BLOCK = r"(?s)```(?:[\w+-]+)?\n?(.*?)```";
    INLINE_CODE = r"`([^`]*)`";
    IMAGE = r"!\[([^\]]*)\]\([^)]+\)";
    LINK = r"\[([^\]]+)\]\([^)]+\)";
    HEADING = r"(?m)^[ \t]*#{1,6}[ \t]*(.*)$";
    QUOTE = r"(?m)^[ \t]*>[ \t]?";
    BOLD_STARS = r"\*\*(.*?)\*\*";
    BOLD_UNDERSCORES = r"(^|\W)__(.+?)__(\W|$)";
    ITALIC_STAR = r"\*([^*\n]+)\*";
    ITALIC_UNDERSCORE = r"(^|\W)_([^_\n]+)_(\W|$)";
    BULLET = r"(?m)^[ \t]*[-*+]\s+";
    NUMBERED = r"(?m)^[ \t]*\d+\.\s+";
    RULE = r"(?m)^-{3,}\s*$";
    MARKUP = r"<[^>]+>";
    BLANK_LINES = r"\n{3,}";
    TRAILING_SPACE = r"(?m)[ \t]+$";
}

/// Markdown reduced to plain words. Underscores inside identifiers such as
/// `task_type` are kept: only underscores at word edges mark emphasis.
pub fn strip_markdown(text: &str) -> String {
    let cleaned = text.replace("\r\n", "\n");
    let cleaned = CODE_BLOCK.replace_all(&cleaned, "\n$1\n");
    let cleaned = INLINE_CODE.replace_all(&cleaned, "$1");
    let cleaned = IMAGE.replace_all(&cleaned, "$1");
    let cleaned = LINK.replace_all(&cleaned, "$1");
    let cleaned = HEADING.replace_all(&cleaned, "$1");
    let cleaned = QUOTE.replace_all(&cleaned, "");
    let cleaned = BOLD_STARS.replace_all(&cleaned, "$1");
    let cleaned = BOLD_UNDERSCORES.replace_all(&cleaned, "$1$2$3");
    let cleaned = ITALIC_STAR.replace_all(&cleaned, "$1");
    let cleaned = ITALIC_UNDERSCORE.replace_all(&cleaned, "$1$2$3");
    let cleaned = BULLET.replace_all(&cleaned, "");
    let cleaned = NUMBERED.replace_all(&cleaned, "");
    let cleaned = RULE.replace_all(&cleaned, "");
    let cleaned = MARKUP.replace_all(&cleaned, "");
    let cleaned = BLANK_LINES.replace_all(&cleaned, "\n\n");
    let cleaned = TRAILING_SPACE.replace_all(&cleaned, "");
    cleaned.trim().to_owned()
}

/// The words a reader sees in an HTML fragment. Comments, scripts, styles and
/// templates are dropped, tags separate words, and entities are decoded.
pub fn html_text(html: &str) -> String {
    let visible = HTML_COMMENT.replace_all(html, " ");
    let visible = HTML_HIDDEN.replace_all(&visible, " ");
    let visible = HTML_TAG.replace_all(&visible, " ");
    let decoded = html_escape::decode_html_entities(&visible);
    SPACES.replace_all(&decoded, " ").trim().to_owned()
}

/// The text of one section's current content, or `None` when the section
/// carries no searchable words. A structured payload that claims to be an
/// html/css section but does not match that shape is malformed and rejected,
/// so a bad event cannot replace what was searchable before.
fn section_content(section: &Section) -> Result<Option<String>, IngestError> {
    let Some(content) = &section.materialized_markdown else {
        return Ok(None);
    };
    if section.key == "requirements" || content.trim().is_empty() {
        return Ok(None);
    }

    let trimmed = content.trim_start();
    if trimmed.starts_with('{') {
        let payload = serde_json::from_str::<Value>(content).map_err(|_| {
            IngestError::rejected(format!(
                "section {} holds malformed structured content",
                section.key
            ))
        })?;
        return structured_text(&section.key, payload);
    }

    // A bracket opens markdown (links, task lists) as often as a JSON array.
    if trimmed.starts_with('[') && serde_json::from_str::<Value>(content).is_ok() {
        return Ok(None);
    }

    Ok(Some(content.clone()))
}

/// Structured payloads are authoritative as they are stored; only the
/// html/css payload has a text projection. A payload that names `html` or
/// `css` must be a complete, canonical html/css payload.
fn structured_text(key: &str, payload: Value) -> Result<Option<String>, IngestError> {
    let claims_html_css = payload
        .as_object()
        .is_some_and(|object| object.contains_key("html") || object.contains_key("css"));
    if !claims_html_css {
        return Ok(None);
    }

    let page = serde_json::from_value::<HtmlCss>(payload).map_err(|error| {
        IngestError::rejected(format!(
            "section {key} is not a valid html/css payload: {error}"
        ))
    })?;
    let text = html_text(&page.html);
    Ok((!text.is_empty()).then_some(text))
}

/// The current sections in canonical order, each at most once.
fn ordered(sections: &[Section]) -> Result<Vec<&Section>, IngestError> {
    let mut seen = std::collections::HashSet::new();
    for section in sections {
        if section.key.is_empty() {
            return Err(IngestError::rejected("a section key must not be empty"));
        }
        if !seen.insert(section.key.as_str()) {
            return Err(IngestError::rejected(format!(
                "section {} appears more than once",
                section.key
            )));
        }
    }

    let mut ordered: Vec<&Section> = sections.iter().collect();
    ordered.sort_by_key(|section| section.order);
    Ok(ordered)
}

/// Selected sections in canonical order as `key:\ncontent`.
pub fn compose_sections(sections: &[Section]) -> Result<Vec<String>, IngestError> {
    let mut composed = Vec::new();
    for section in ordered(sections)? {
        if let Some(content) = section_content(section)? {
            composed.push(format!("{}:\n{}", section.key, content.trim()));
        }
    }
    Ok(composed)
}

/// The text of the section with this key, if it is textual.
pub fn section_text(sections: &[Section], key: &str) -> Result<Option<String>, IngestError> {
    match sections.iter().find(|section| section.key == key) {
        Some(section) => section_content(section),
        None => Ok(None),
    }
}

/// Joins non-blank parts and reduces markdown, as the deployed service does.
pub fn searchable_text(parts: &[String]) -> String {
    let parts: Vec<&str> = parts
        .iter()
        .map(|part| part.trim())
        .filter(|part| !part.is_empty())
        .collect();
    strip_markdown(&parts.join("\n\n"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn section(key: &str, order: i64, content: Option<&str>) -> Section {
        Section {
            key: key.into(),
            order,
            materialized_markdown: content.map(str::to_owned),
        }
    }

    fn compose(sections: &[Section]) -> Vec<String> {
        compose_sections(sections).unwrap()
    }

    #[test]
    fn html_text_keeps_words_and_drops_markup_styles_and_scripts() {
        let html = "<style>.hero { color: red }</style><!-- note -->\
            <h1>Billing&nbsp;page</h1><p>Pay &amp; download</p><script>alert('x')</script>\
            <div style=\"display:none\">Visible words</div>";
        assert_eq!(html_text(html), "Billing page Pay & download Visible words");
    }

    #[test]
    fn html_css_payload_contributes_only_html_text() {
        let payload = json!({
            "html": "<main><button>Export invoices</button></main>",
            "css": "button { content: 'hidden-style-word' }",
            "annotations": [],
        })
        .to_string();
        let sections = [section("mockup", 1, Some(&payload))];
        assert_eq!(compose(&sections), ["mockup:\nExport invoices"]);
    }

    #[test]
    fn valid_structured_and_empty_content_is_not_searchable() {
        let sections = [
            section("data", 1, Some(r#"{"nodes":[1,2]}"#)),
            section("list", 2, Some("[1, 2]")),
            section("empty", 3, None),
            section("blank", 4, Some("  ")),
            section("requirements", 5, Some("raw")),
        ];
        assert!(compose(&sections).is_empty());
    }

    #[test]
    fn markdown_that_opens_with_a_bracket_is_text() {
        let sections = [section(
            "details",
            1,
            Some("[Spec](http://x) lists the steps"),
        )];
        assert_eq!(
            compose(&sections),
            ["details:\n[Spec](http://x) lists the steps"]
        );
    }

    #[test]
    fn malformed_structured_content_is_rejected_not_skipped_or_indexed() {
        let malformed = [
            r#"{"html": "<p>x</p>""#,
            r#"{"html": "<p>x</p>"}"#,
            r#"{"css": "p {}"}"#,
            r#"{"html": 3, "css": ""}"#,
            r#"{"html": "<p>x</p>", "css": "", "extra": true}"#,
            r#"{"html": "<p>x</p>", "css": "", "sizeKey": 4}"#,
            r#"{"html": "<p>x</p>", "css": "", "annotations": {}}"#,
            r#"{"html": "<p>x</p>", "css": "", "sizeKey": ""}"#,
            r#"{"html": "<p>x</p>", "css": "", "annotations": [42]}"#,
        ];
        for content in malformed {
            let sections = [section("mockup", 1, Some(content))];
            assert!(
                matches!(compose_sections(&sections), Err(IngestError::Rejected(_))),
                "{content}"
            );
            assert!(section_text(&sections, "mockup").is_err(), "{content}");
        }
    }

    #[test]
    fn ambiguous_section_snapshots_are_rejected() {
        let duplicated = [
            section("description", 1, Some("a")),
            section("description", 2, Some("b")),
        ];
        assert!(compose_sections(&duplicated).is_err());
        assert!(compose_sections(&[section("", 1, Some("a"))]).is_err());
    }

    #[test]
    fn sections_compose_in_canonical_order() {
        let sections = [
            section("acceptanceCriteria", 2, Some("Second")),
            section("description", 1, Some(" First ")),
        ];
        assert_eq!(
            compose(&sections),
            ["description:\nFirst", "acceptanceCriteria:\nSecond"]
        );
    }

    #[test]
    fn markdown_reduces_to_words_but_keeps_identifiers() {
        let text =
            "# Title\n\nUse **bold** and _soft_ text with `task_type` and [a link](http://x).";
        assert_eq!(
            strip_markdown(text),
            "Title\n\nUse bold and soft text with task_type and a link."
        );
    }
}
