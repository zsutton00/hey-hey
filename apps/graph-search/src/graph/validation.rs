use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::LazyLock;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

static SCHEMAS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(super::generated::REQUEST_SCHEMAS).expect("generated schemas")
});

pub fn decode<T: DeserializeOwned>(name: &str, value: Value) -> Result<T, String> {
    validate(&SCHEMAS[name], &value, name)?;
    serde_json::from_value(value).map_err(|error| error.to_string())
}
pub fn uuid(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(i, b)| {
            if [8, 13, 18, 23].contains(&i) {
                b == b'-'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
fn validate(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    if value.is_null() && schema["nullable"] == true {
        return Ok(());
    }
    let fail = || format!("Invalid {path}");
    if let Some(values) = schema["enum"].as_array()
        && !values.contains(value)
    {
        return Err(fail());
    }
    match schema["type"].as_str() {
        Some("object") => {
            let object = value.as_object().ok_or_else(fail)?;
            if let Some(required) = schema["required"].as_array() {
                for key in required.iter().filter_map(Value::as_str) {
                    if !object.contains_key(key) {
                        return Err(format!("{path}.{key} is required"));
                    }
                }
            }
            for (key, item) in object {
                if let Some(property) = schema["properties"].get(key) {
                    validate(property, item, &format!("{path}.{key}"))?;
                } else if schema["additionalProperties"] == false {
                    return Err(fail());
                }
            }
        }
        Some("array") => {
            let items = value.as_array().ok_or_else(fail)?;
            if schema["minItems"]
                .as_u64()
                .is_some_and(|min| items.len() < (min as usize))
                || schema["maxItems"]
                    .as_u64()
                    .is_some_and(|max| items.len() > (max as usize))
            {
                return Err(fail());
            }
            for item in items {
                validate(&schema["items"], item, path)?;
            }
        }
        Some("string") => {
            let text = value.as_str().ok_or_else(fail)?;
            let length = text.chars().count() as u64;
            if schema["minLength"].as_u64().is_some_and(|n| length < n)
                || schema["maxLength"].as_u64().is_some_and(|n| length > n)
            {
                return Err(fail());
            }
            match schema["format"].as_str() {
                Some("uuid") if !uuid(text) => return Err(fail()),
                Some("date-time") if OffsetDateTime::parse(text, &Rfc3339).is_err() => {
                    return Err(fail());
                }
                _ => {}
            }
        }
        Some("integer" | "number") => {
            let number = value.as_f64().ok_or_else(fail)?;
            if schema["type"] == "integer" && value.as_i64().is_none()
                || schema["minimum"].as_f64().is_some_and(|min| number < min)
                || schema["maximum"].as_f64().is_some_and(|max| number > max)
            {
                return Err(fail());
            }
        }
        Some("boolean") if !value.is_boolean() => return Err(fail()),
        _ => {}
    }
    Ok(())
}
