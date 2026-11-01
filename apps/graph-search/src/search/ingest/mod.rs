//! Keeps searchable text current from the events the API publishes.
//!
//! The API is the only publisher and the only writer of canonical records.
//! This consumer reads the same events, in the same per-item order, as the
//! deployed Embeddings service, and writes through the search store that the
//! HTTP handlers use. Redis Pub/Sub has no replay: an event published while
//! the consumer is down is not delivered later, and there is no rebuild. That
//! is the recovery posture of the deployed service too.

pub mod config;
pub mod consumer;
pub mod error;
pub mod event;
mod html_css;
mod knowledge;
mod organization;
mod requirements;
mod task;
pub mod text;

use serde_json::Value;
use sqlx::PgPool;

use self::{
    error::IngestError,
    event::{Event, event_type},
};
use super::{
    encoder::Encoder,
    store,
    wire::{Document, Level},
};

/// Applies one event to the searchable state.
#[derive(Clone)]
pub struct Ingest {
    pool: PgPool,
    encoder: Encoder,
}

impl Ingest {
    pub fn new(pool: PgPool, encoder: Encoder) -> Self {
        Self { pool, encoder }
    }

    /// Applies an event envelope. An event that cannot be applied leaves the
    /// searchable state unchanged and reports why.
    pub async fn handle(&self, envelope: &Value) -> Result<(), IngestError> {
        let event = event::unwrap_envelope(envelope);
        let kind = event_type(event)?;

        if kind == event::ORGANIZATION_CLOSED {
            return organization::closed(self, event).await;
        }
        if !event::SUBSCRIBED.contains(&kind) {
            return Err(IngestError::rejected(format!(
                "unsupported event type {kind}"
            )));
        }

        // A payload that names another event type is not this event.
        let payload_type = event["payload"]["payloadType"].as_str();
        if payload_type.is_some_and(|payload_type| payload_type != kind) {
            return Err(IngestError::rejected(
                "payload.payloadType must match the event type",
            ));
        }

        match kind {
            event::TASK_CREATED => task::created(self, Event::parse(event)?).await,
            event::TASK_CONTENT_CHANGED => task::content_changed(self, Event::parse(event)?).await,
            event::TASK_UPDATED => task::updated(self, Event::parse(event)?).await,
            event::TASK_STATUS_CHANGED => task::status_changed(self, Event::parse(event)?).await,
            event::TASK_ARCHIVED => task::archived(self, Event::parse(event)?).await,
            _ => knowledge::handle(self, kind, event).await,
        }
    }

    /// Replaces everything searchable about a document. The encoder takes one
    /// text at a time, so a burst of events waits on it instead of growing
    /// memory.
    async fn store(&self, document: Document) -> Result<(), IngestError> {
        if document.text.trim().is_empty() {
            return Err(IngestError::rejected(
                "the event carries no searchable text",
            ));
        }
        debug_assert_eq!(document.level, Level::Document);

        let units = store::units(&document);
        let texts: Vec<&str> = units.iter().map(|unit| unit.text.as_str()).collect();
        let vectors = self.encoder.encode_batch(&texts).await?;

        store::replace_document(&self.pool, &document, &units, &vectors)
            .await?
            .map_err(|_| {
                IngestError::rejected("the organization was closed and accepts no content")
            })
    }
}
