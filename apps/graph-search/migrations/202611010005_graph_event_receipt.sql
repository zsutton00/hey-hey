-- Local deduplication only: this is not an event log or replay source.
CREATE TABLE graph.event_receipt (
    organization_id text NOT NULL,
    project_id text NOT NULL,
    event_id text NOT NULL,
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (organization_id, project_id, event_id)
);
CREATE INDEX graph_event_receipt_expiry ON graph.event_receipt (processed_at);
