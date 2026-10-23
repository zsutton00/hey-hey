CREATE TYPE account_subscription_type AS ENUM ('BETA', 'PAID');
CREATE TYPE account_access_status AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED');

CREATE TABLE account_entitlements (
  organization_id TEXT PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,
  subscription_type account_subscription_type NOT NULL,
  access_status account_access_status NOT NULL,
  access_through_at TIMESTAMPTZ,
  paid_through_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by VARCHAR(120) NOT NULL,
  created_reason VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR(120) NOT NULL,
  update_reason VARCHAR(255) NOT NULL,
  CONSTRAINT account_entitlements_beta_paid_through_check
    CHECK (subscription_type <> 'BETA' OR paid_through_at IS NULL)
);

CREATE TABLE account_entitlement_transitions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL
    REFERENCES account_entitlements(organization_id) ON DELETE CASCADE,
  from_revision INTEGER,
  to_revision INTEGER NOT NULL CHECK (to_revision > 0),
  previous_subscription_type account_subscription_type,
  subscription_type account_subscription_type NOT NULL,
  previous_access_status account_access_status,
  access_status account_access_status NOT NULL,
  previous_access_through_at TIMESTAMPTZ,
  access_through_at TIMESTAMPTZ,
  previous_paid_through_at TIMESTAMPTZ,
  paid_through_at TIMESTAMPTZ,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by VARCHAR(120) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  CONSTRAINT account_entitlement_transitions_revision_check CHECK (
    (from_revision IS NULL AND to_revision = 1)
    OR (from_revision IS NOT NULL AND from_revision > 0 AND to_revision = from_revision + 1)
  ),
  CONSTRAINT account_entitlement_transitions_beta_paid_through_check
    CHECK (subscription_type <> 'BETA' OR paid_through_at IS NULL),
  UNIQUE (organization_id, to_revision)
);

CREATE INDEX account_entitlement_transitions_organization_changed_at_idx
  ON account_entitlement_transitions (organization_id, changed_at);

INSERT INTO account_entitlements (
  organization_id,
  subscription_type,
  access_status,
  revision,
  created_by,
  created_reason,
  updated_by,
  update_reason
)
SELECT
  organization.id,
  'BETA'::account_subscription_type,
  CASE
    WHEN organization.is_active THEN 'ACTIVE'::account_access_status
    ELSE 'REVOKED'::account_access_status
  END,
  1,
  'SYSTEM_MIGRATION',
  'Existing admitted organization backfill',
  'SYSTEM_MIGRATION',
  'Existing admitted organization backfill'
FROM organizations AS organization;

INSERT INTO account_entitlement_transitions (
  organization_id,
  from_revision,
  to_revision,
  subscription_type,
  access_status,
  changed_by,
  reason
)
SELECT
  entitlement.organization_id,
  NULL,
  1,
  entitlement.subscription_type,
  entitlement.access_status,
  entitlement.created_by,
  entitlement.created_reason
FROM account_entitlements AS entitlement;
