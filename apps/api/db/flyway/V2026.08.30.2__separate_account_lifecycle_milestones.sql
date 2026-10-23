ALTER TABLE organization_account_lifecycles
  ADD COLUMN access_ends_at TIMESTAMPTZ,
  ADD COLUMN deletion_eligible_at TIMESTAMPTZ,
  ADD COLUMN irreversible_closure_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE organization_account_lifecycle_transitions
  ADD COLUMN previous_access_ends_at TIMESTAMPTZ,
  ADD COLUMN access_ends_at TIMESTAMPTZ,
  ADD COLUMN previous_deletion_eligible_at TIMESTAMPTZ,
  ADD COLUMN deletion_eligible_at TIMESTAMPTZ,
  ADD COLUMN previous_irreversible_closure_at TIMESTAMPTZ,
  ADD COLUMN irreversible_closure_at TIMESTAMPTZ,
  ADD COLUMN previous_deleted_at TIMESTAMPTZ,
  ADD COLUMN deleted_at TIMESTAMPTZ;

ALTER TABLE organization_account_lifecycles
  DROP CONSTRAINT organization_account_lifecycles_state_check;
ALTER TABLE organization_account_lifecycle_transitions
  DROP CONSTRAINT organization_account_lifecycle_transitions_state_check;

UPDATE organization_account_lifecycles lifecycle
SET
  access_ends_at = lifecycle.effective_closure_at,
  deletion_eligible_at = CASE
    WHEN lifecycle.lifecycle_state IN ('DELETING', 'DELETED')
      THEN lifecycle.effective_closure_at
    ELSE lifecycle.effective_closure_at + INTERVAL '27 days'
  END,
  irreversible_closure_at = CASE
    WHEN lifecycle.lifecycle_state IN ('DELETING', 'DELETED')
      THEN lifecycle.effective_closure_at
    ELSE NULL
  END,
  deleted_at = CASE
    WHEN lifecycle.lifecycle_state = 'DELETED'
      THEN COALESCE(execution.completed_at, lifecycle.updated_at)
    ELSE NULL
  END,
  lifecycle_state = CASE
    WHEN lifecycle.lifecycle_state = 'DELETED'
      THEN 'DELETED'::organization_account_lifecycle_state
    WHEN lifecycle.lifecycle_state = 'DELETING'
      THEN 'IRREVERSIBLY_CLOSED'::organization_account_lifecycle_state
    WHEN lifecycle.lifecycle_state = 'SCHEDULED_FOR_DELETION'
      AND lifecycle.effective_closure_at <= clock_timestamp()
      THEN 'SUSPENDED'::organization_account_lifecycle_state
    ELSE 'ACTIVE'::organization_account_lifecycle_state
  END
FROM organization_closure_executions execution
WHERE execution.organization_id IS NOT DISTINCT FROM lifecycle.organization_id;

UPDATE organization_account_lifecycles lifecycle
SET
  access_ends_at = lifecycle.effective_closure_at,
  deletion_eligible_at = CASE
    WHEN lifecycle.lifecycle_state IN ('DELETING', 'DELETED')
      THEN lifecycle.effective_closure_at
    ELSE lifecycle.effective_closure_at + INTERVAL '27 days'
  END,
  irreversible_closure_at = CASE
    WHEN lifecycle.lifecycle_state IN ('DELETING', 'DELETED')
      THEN lifecycle.effective_closure_at
    ELSE NULL
  END,
  deleted_at = CASE
    WHEN lifecycle.lifecycle_state = 'DELETED' THEN lifecycle.updated_at
    ELSE NULL
  END,
  lifecycle_state = CASE
    WHEN lifecycle.lifecycle_state = 'DELETED'
      THEN 'DELETED'::organization_account_lifecycle_state
    WHEN lifecycle.lifecycle_state = 'DELETING'
      THEN 'IRREVERSIBLY_CLOSED'::organization_account_lifecycle_state
    WHEN lifecycle.lifecycle_state = 'SCHEDULED_FOR_DELETION'
      AND lifecycle.effective_closure_at <= clock_timestamp()
      THEN 'SUSPENDED'::organization_account_lifecycle_state
    ELSE 'ACTIVE'::organization_account_lifecycle_state
  END
WHERE lifecycle.effective_closure_at IS NOT NULL
  AND lifecycle.access_ends_at IS NULL;

UPDATE organization_account_lifecycle_transitions
SET
  previous_access_ends_at = previous_effective_closure_at,
  access_ends_at = effective_closure_at,
  previous_deletion_eligible_at = CASE
    WHEN previous_effective_closure_at IS NULL THEN NULL
    WHEN previous_lifecycle_state IN ('DELETING', 'DELETED')
      THEN previous_effective_closure_at
    ELSE previous_effective_closure_at + INTERVAL '27 days'
  END,
  deletion_eligible_at = CASE
    WHEN effective_closure_at IS NULL THEN NULL
    WHEN lifecycle_state IN ('DELETING', 'DELETED')
      THEN effective_closure_at
    ELSE effective_closure_at + INTERVAL '27 days'
  END,
  previous_irreversible_closure_at = CASE
    WHEN previous_lifecycle_state IN ('DELETING', 'DELETED')
      THEN previous_effective_closure_at
    ELSE NULL
  END,
  irreversible_closure_at = CASE
    WHEN lifecycle_state IN ('DELETING', 'DELETED') THEN effective_closure_at
    ELSE NULL
  END,
  previous_deleted_at = CASE
    WHEN previous_lifecycle_state = 'DELETED' THEN changed_at
    ELSE NULL
  END,
  deleted_at = CASE
    WHEN lifecycle_state = 'DELETED' THEN changed_at
    ELSE NULL
  END,
  previous_lifecycle_state = CASE
    WHEN previous_lifecycle_state = 'DELETED'
      THEN 'DELETED'::organization_account_lifecycle_state
    WHEN previous_lifecycle_state = 'DELETING'
      THEN 'IRREVERSIBLY_CLOSED'::organization_account_lifecycle_state
    WHEN previous_lifecycle_state = 'SCHEDULED_FOR_DELETION'
      AND previous_effective_closure_at <= changed_at
      THEN 'SUSPENDED'::organization_account_lifecycle_state
    WHEN previous_lifecycle_state = 'SCHEDULED_FOR_DELETION'
      THEN 'ACTIVE'::organization_account_lifecycle_state
    ELSE previous_lifecycle_state
  END,
  lifecycle_state = CASE
    WHEN lifecycle_state = 'DELETED'
      THEN 'DELETED'::organization_account_lifecycle_state
    WHEN lifecycle_state = 'DELETING'
      THEN 'IRREVERSIBLY_CLOSED'::organization_account_lifecycle_state
    WHEN lifecycle_state = 'SCHEDULED_FOR_DELETION'
      AND effective_closure_at <= changed_at
      THEN 'SUSPENDED'::organization_account_lifecycle_state
    WHEN lifecycle_state = 'SCHEDULED_FOR_DELETION'
      THEN 'ACTIVE'::organization_account_lifecycle_state
    ELSE lifecycle_state
  END;

ALTER TABLE organization_account_lifecycles
  DROP COLUMN effective_closure_at,
  ADD CONSTRAINT organization_account_lifecycles_state_check CHECK (
    (
      lifecycle_state = 'ACTIVE'
      AND irreversible_closure_at IS NULL
      AND deleted_at IS NULL
      AND (
        (
          access_ends_at IS NULL
          AND deletion_eligible_at IS NULL
          AND closure_entitlement_revision IS NULL
        )
        OR (
          access_ends_at IS NOT NULL
          AND deletion_eligible_at IS NOT NULL
          AND deletion_eligible_at >= access_ends_at
          AND closure_entitlement_revision > 0
        )
      )
    )
    OR (
      lifecycle_state = 'SUSPENDED'
      AND access_ends_at IS NOT NULL
      AND deletion_eligible_at IS NOT NULL
      AND deletion_eligible_at >= access_ends_at
      AND irreversible_closure_at IS NULL
      AND deleted_at IS NULL
      AND closure_entitlement_revision > 0
    )
    OR (
      lifecycle_state = 'IRREVERSIBLY_CLOSED'
      AND access_ends_at IS NOT NULL
      AND deletion_eligible_at IS NOT NULL
      AND irreversible_closure_at IS NOT NULL
      AND irreversible_closure_at >= deletion_eligible_at
      AND deleted_at IS NULL
      AND closure_entitlement_revision > 0
    )
    OR (
      lifecycle_state = 'DELETED'
      AND access_ends_at IS NOT NULL
      AND deletion_eligible_at IS NOT NULL
      AND irreversible_closure_at IS NOT NULL
      AND deleted_at IS NOT NULL
      AND closure_entitlement_revision > 0
    )
  );

ALTER TABLE organization_account_lifecycle_transitions
  DROP COLUMN previous_effective_closure_at,
  DROP COLUMN effective_closure_at,
  ADD CONSTRAINT organization_account_lifecycle_transitions_state_check CHECK (
    (
      lifecycle_state = 'ACTIVE'
      AND irreversible_closure_at IS NULL
      AND deleted_at IS NULL
    )
    OR (
      lifecycle_state = 'SUSPENDED'
      AND access_ends_at IS NOT NULL
      AND deletion_eligible_at IS NOT NULL
      AND irreversible_closure_at IS NULL
      AND deleted_at IS NULL
      AND closure_entitlement_revision > 0
    )
    OR (
      lifecycle_state = 'IRREVERSIBLY_CLOSED'
      AND access_ends_at IS NOT NULL
      AND deletion_eligible_at IS NOT NULL
      AND irreversible_closure_at IS NOT NULL
      AND deleted_at IS NULL
      AND closure_entitlement_revision > 0
    )
    OR (
      lifecycle_state = 'DELETED'
      AND access_ends_at IS NOT NULL
      AND deletion_eligible_at IS NOT NULL
      AND irreversible_closure_at IS NOT NULL
      AND deleted_at IS NOT NULL
      AND closure_entitlement_revision > 0
    )
  );
