CREATE TABLE organization_closure_provider_correlation_tombstones (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL,
  marker_id TEXT NOT NULL
    REFERENCES organization_deletion_markers(id) ON DELETE RESTRICT,
  provider VARCHAR(64) NOT NULL,
  environment VARCHAR(32) NOT NULL,
  external_customer_id VARCHAR(255),
  external_subscription_id VARCHAR(255),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT organization_closure_provider_correlation_identity_check CHECK (
    length(btrim(provider)) > 0
    AND length(btrim(environment)) > 0
    AND (
      external_customer_id IS NOT NULL
      OR external_subscription_id IS NOT NULL
    )
  )
);

CREATE INDEX organization_closure_provider_correlation_customer_idx
  ON organization_closure_provider_correlation_tombstones
    (provider, environment, external_customer_id);

CREATE INDEX organization_closure_provider_correlation_subscription_idx
  ON organization_closure_provider_correlation_tombstones
    (provider, environment, external_subscription_id);

CREATE UNIQUE INDEX organization_closure_provider_correlation_snapshot_idx
  ON organization_closure_provider_correlation_tombstones
    (marker_id, provider, environment, external_customer_id, external_subscription_id);
