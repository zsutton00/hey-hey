//! The FEATURE requirements collection carried on a task event.
//!
//! The API owns the collection. The event holds a serialized copy that is
//! checked against the `FeatureRequirementsSection` shape before any text is
//! derived from it; a copy that does not match is rejected, never repaired.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::error::IngestError;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Collection {
    records: Vec<Record>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Record {
    id: String,
    statement: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<String>,
    // Citations are not searchable text; they are stored as received.
    designed_by: Vec<Value>,
    fulfilled_by: Vec<Value>,
    contracts: Vec<Value>,
}

pub struct Requirements {
    /// The validated collection as stored in the document metadata.
    pub canonical: String,
    /// Ordered statements, each prefixed by its group; empty without records.
    pub text: String,
}

pub fn parse(content: &str) -> Result<Requirements, IngestError> {
    let collection: Collection = serde_json::from_str(content.trim()).map_err(|error| {
        IngestError::rejected(format!(
            "requirements is not a canonical collection: {error}"
        ))
    })?;

    let text = collection
        .records
        .iter()
        .map(|record| match &record.group {
            Some(group) => format!("{group}: {}", record.statement),
            None => record.statement.clone(),
        })
        .collect::<Vec<_>>()
        .join("\n");
    let canonical = serde_json::to_string(&collection).map_err(|error| {
        IngestError::rejected(format!("requirements cannot be stored: {error}"))
    })?;

    Ok(Requirements { canonical, text })
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn record(statement: &str, group: Option<&str>) -> Value {
        let mut record = json!({
            "id": "6f5b8c1e-2d40-4c0a-9a7e-0f4e8f2c7a11",
            "statement": statement,
            "designedBy": [], "fulfilledBy": [], "contracts": [],
        });
        if let Some(group) = group {
            record["group"] = json!(group);
        }
        record
    }

    #[test]
    fn statements_keep_order_and_group_prefix() {
        let content = json!({"records": [
            record("Invoices download as PDF.", Some("Billing")),
            record("Receipts are emailed.", None),
        ]});
        let requirements = parse(&content.to_string()).unwrap();
        assert_eq!(
            requirements.text,
            "Billing: Invoices download as PDF.\nReceipts are emailed."
        );
    }

    #[test]
    fn a_collection_without_records_has_no_text() {
        assert_eq!(parse(r#"{"records":[]}"#).unwrap().text, "");
    }

    #[test]
    fn legacy_text_and_unknown_fields_are_rejected() {
        assert!(parse("- plain markdown requirement").is_err());
        assert!(parse("").is_err());
        assert!(parse(r#"{"records":[],"lintFindings":[]}"#).is_err());
    }
}
