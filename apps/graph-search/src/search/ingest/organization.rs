//! `organization.closed`: an irreversibly closed organization's searchable
//! content is deleted and fenced, exactly as the authenticated deletion
//! command does it.

use anyhow::anyhow;
use serde::Deserialize;
use serde_json::Value;

use super::{
    Ingest,
    error::IngestError,
    event::{self, OrganizationClosed},
};
use crate::search::{
    store::{self, DeletionOutcome},
    wire::ProjectionDeletionCommand,
};

pub async fn closed(ingest: &Ingest, envelope_event: &Value) -> Result<(), IngestError> {
    // The closure event is project-less and has exactly these keys.
    let Some(keys) = envelope_event.as_object() else {
        return Err(IngestError::rejected("event must be an object"));
    };
    let mut names: Vec<&str> = keys.keys().map(String::as_str).collect();
    names.sort_unstable();
    if names != ["aggregateId", "id", "payload", "type"] {
        return Err(IngestError::rejected(
            "organization.closed event keys must be exactly id, type, aggregateId and payload",
        ));
    }

    let id = event::aggregate_id(envelope_event)?;
    let payload = OrganizationClosed::deserialize(&envelope_event["payload"])
        .map_err(|error| IngestError::rejected(error.to_string()))?;
    if payload.payload_type != event::ORGANIZATION_CLOSED {
        return Err(IngestError::rejected(
            "organization.closed payloadType must match the event type",
        ));
    }
    if id != payload.organization_id {
        return Err(IngestError::rejected(
            "organization.closed aggregateId must match organizationId",
        ));
    }
    if payload.marker_id != payload.marker_id.to_lowercase() {
        return Err(IngestError::rejected(
            "organization.closed markerId must be a canonical UUID",
        ));
    }

    let identity = ProjectionDeletionCommand {
        organization_id: payload.organization_id,
        marker_id: payload.marker_id,
        irreversible_closure_at: payload.irreversible_closure_at,
        deletion_deadline: payload.deletion_deadline,
    }
    .validate()
    .map_err(|invalid| IngestError::rejected(format!("{} {}", invalid.field, invalid.message)))?;

    match store::delete_organization(&ingest.pool, &identity).await? {
        DeletionOutcome::Deleted => Ok(()),
        DeletionOutcome::Conflict(_) => Err(IngestError::Failed(anyhow!(
            "a different closure is already recorded for this organization"
        ))),
    }
}
