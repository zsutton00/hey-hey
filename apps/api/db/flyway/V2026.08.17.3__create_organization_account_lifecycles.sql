CREATE TYPE organization_account_lifecycle_state AS ENUM (
  'ACTIVE',
  'SCHEDULED_FOR_DELETION',
  'DELETING',
  'DELETED'
);

CREATE TABLE organization_account_lifecycles (
  organization_id TEXT PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,
  lifecycle_state organization_account_lifecycle_state NOT NULL,
  effective_closure_at TIMESTAMPTZ,
  closure_entitlement_revision INTEGER,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by VARCHAR(120) NOT NULL,
  created_reason VARCHAR(255) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by VARCHAR(120) NOT NULL,
  update_reason VARCHAR(255) NOT NULL,
  CONSTRAINT organization_account_lifecycles_state_check CHECK (
    (
      lifecycle_state = 'ACTIVE'
      AND effective_closure_at IS NULL
      AND closure_entitlement_revision IS NULL
    )
    OR (
      lifecycle_state IN ('SCHEDULED_FOR_DELETION', 'DELETING', 'DELETED')
      AND effective_closure_at IS NOT NULL
      AND closure_entitlement_revision IS NOT NULL
      AND closure_entitlement_revision > 0
    )
  )
);

CREATE TABLE organization_account_lifecycle_transitions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  organization_id TEXT NOT NULL
    REFERENCES organization_account_lifecycles(organization_id) ON DELETE CASCADE,
  from_revision INTEGER,
  to_revision INTEGER NOT NULL CHECK (to_revision > 0),
  previous_lifecycle_state organization_account_lifecycle_state,
  lifecycle_state organization_account_lifecycle_state NOT NULL,
  previous_effective_closure_at TIMESTAMPTZ,
  effective_closure_at TIMESTAMPTZ,
  previous_closure_entitlement_revision INTEGER,
  closure_entitlement_revision INTEGER,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by VARCHAR(120) NOT NULL,
  reason VARCHAR(255) NOT NULL,
  CONSTRAINT organization_account_lifecycle_transitions_revision_check CHECK (
    (from_revision IS NULL AND to_revision = 1)
    OR (from_revision IS NOT NULL AND from_revision > 0 AND to_revision = from_revision + 1)
  ),
  CONSTRAINT organization_account_lifecycle_transitions_state_check CHECK (
    (
      lifecycle_state = 'ACTIVE'
      AND effective_closure_at IS NULL
      AND closure_entitlement_revision IS NULL
    )
    OR (
      lifecycle_state IN ('SCHEDULED_FOR_DELETION', 'DELETING', 'DELETED')
      AND effective_closure_at IS NOT NULL
      AND closure_entitlement_revision IS NOT NULL
      AND closure_entitlement_revision > 0
    )
  ),
  UNIQUE (organization_id, to_revision)
);

CREATE INDEX organization_account_lifecycle_transitions_organization_changed_at_idx
  ON organization_account_lifecycle_transitions (organization_id, changed_at);
