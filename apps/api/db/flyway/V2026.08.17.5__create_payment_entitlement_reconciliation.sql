DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'payment_provider_binding_status'
  ) THEN
    CREATE TYPE payment_provider_binding_status AS ENUM ('ACTIVE', 'DISABLED');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'payment_provider_event_processing_status'
  ) THEN
    CREATE TYPE payment_provider_event_processing_status AS ENUM (
      'RECEIVED',
      'ACCEPTED',
      'IGNORED',
      'FAILED'
    );
  END IF;
END
$$;

CREATE TABLE payment_provider_bindings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL
    REFERENCES organizations(id) ON DELETE CASCADE,
  provider VARCHAR(64) NOT NULL,
  environment VARCHAR(32) NOT NULL,
  external_customer_id VARCHAR(255),
  external_subscription_id VARCHAR(255),
  status payment_provider_binding_status NOT NULL DEFAULT 'ACTIVE',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by VARCHAR(120) NOT NULL,
  created_reason VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR(120) NOT NULL,
  update_reason VARCHAR(255) NOT NULL,
  CONSTRAINT payment_provider_bindings_revision_check CHECK (revision > 0),
  CONSTRAINT payment_provider_bindings_provider_check CHECK (length(btrim(provider)) > 0),
  CONSTRAINT payment_provider_bindings_environment_check CHECK (length(btrim(environment)) > 0),
  CONSTRAINT payment_provider_bindings_external_identity_check CHECK (
    external_customer_id IS NOT NULL OR external_subscription_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX payment_provider_bindings_active_customer_idx
  ON payment_provider_bindings (provider, environment, external_customer_id)
  WHERE status = 'ACTIVE' AND external_customer_id IS NOT NULL;

CREATE UNIQUE INDEX payment_provider_bindings_active_subscription_idx
  ON payment_provider_bindings (provider, environment, external_subscription_id)
  WHERE status = 'ACTIVE' AND external_subscription_id IS NOT NULL;

CREATE INDEX payment_provider_bindings_organization_status_idx
  ON payment_provider_bindings (organization_id, status);

CREATE TABLE payment_provider_event_inbox (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT
    REFERENCES organizations(id) ON DELETE SET NULL,
  binding_id TEXT
    REFERENCES payment_provider_bindings(id) ON DELETE SET NULL,
  provider VARCHAR(64) NOT NULL,
  environment VARCHAR(32) NOT NULL,
  provider_event_id VARCHAR(255) NOT NULL,
  normalized_event_kind VARCHAR(100) NOT NULL,
  payload_hash VARCHAR(128) NOT NULL,
  provider_occurred_at TIMESTAMPTZ,
  provider_event_version VARCHAR(255),
  provider_event_sequence BIGINT,
  processing_status payment_provider_event_processing_status NOT NULL DEFAULT 'RECEIVED',
  failure_reason VARCHAR(2000),
  accepted_entitlement_revision INTEGER,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT payment_provider_event_inbox_provider_check CHECK (length(btrim(provider)) > 0),
  CONSTRAINT payment_provider_event_inbox_environment_check CHECK (length(btrim(environment)) > 0),
  CONSTRAINT payment_provider_event_inbox_event_id_check CHECK (length(btrim(provider_event_id)) > 0),
  CONSTRAINT payment_provider_event_inbox_kind_check CHECK (length(btrim(normalized_event_kind)) > 0),
  CONSTRAINT payment_provider_event_inbox_payload_hash_check CHECK (
    payload_hash ~ '^[0-9A-Fa-f]{64,128}$'
  ),
  CONSTRAINT payment_provider_event_inbox_revision_check CHECK (
    accepted_entitlement_revision IS NULL OR accepted_entitlement_revision > 0
  ),
  CONSTRAINT payment_provider_event_inbox_failure_check CHECK (
    processing_status <> 'FAILED' OR length(btrim(COALESCE(failure_reason, ''))) > 0
  )
);

CREATE UNIQUE INDEX payment_provider_event_inbox_identity_idx
  ON payment_provider_event_inbox (provider, environment, provider_event_id);

CREATE INDEX payment_provider_event_inbox_binding_created_at_idx
  ON payment_provider_event_inbox (binding_id, created_at);

CREATE INDEX payment_provider_event_inbox_organization_created_at_idx
  ON payment_provider_event_inbox (organization_id, created_at);

CREATE INDEX payment_provider_event_inbox_processing_status_idx
  ON payment_provider_event_inbox (processing_status, created_at);
