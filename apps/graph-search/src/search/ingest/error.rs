use std::fmt;

/// Why an event did not change the searchable state.
#[derive(Debug)]
pub enum IngestError {
    /// The event is malformed or unsupported. It is never coerced into
    /// something indexable.
    Rejected(String),
    /// The event was valid but storing or encoding it failed.
    Failed(anyhow::Error),
}

impl IngestError {
    pub fn rejected(reason: impl Into<String>) -> Self {
        Self::Rejected(reason.into())
    }

    /// A short stable label for logs.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Rejected(_) => "rejected",
            Self::Failed(_) => "failed",
        }
    }
}

impl From<anyhow::Error> for IngestError {
    fn from(error: anyhow::Error) -> Self {
        Self::Failed(error)
    }
}

impl fmt::Display for IngestError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Rejected(reason) => formatter.write_str(reason),
            Self::Failed(error) => write!(formatter, "{error:#}"),
        }
    }
}

impl std::error::Error for IngestError {}
