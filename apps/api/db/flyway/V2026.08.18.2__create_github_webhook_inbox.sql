CREATE TABLE github_webhook_inbox (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    integration_id TEXT NOT NULL,
    organization_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    delivery_id VARCHAR(255) NOT NULL,
    event_name VARCHAR(100) NOT NULL,
    repository_full_name VARCHAR(255) NOT NULL,
    payload_hash VARCHAR(64) NOT NULL,
    normalized_event JSONB NOT NULL,
    accepted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_github_webhook_inbox_integration
      FOREIGN KEY (integration_id) REFERENCES integrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_github_webhook_inbox_organization
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    CONSTRAINT fk_github_webhook_inbox_project
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    CONSTRAINT ux_github_webhook_inbox_integration_delivery
      UNIQUE (integration_id, delivery_id)
);

CREATE INDEX ix_github_webhook_inbox_project_accepted
  ON github_webhook_inbox (project_id, accepted_at DESC);

CREATE INDEX ix_github_webhook_inbox_event_accepted
  ON github_webhook_inbox (event_name, accepted_at DESC);
