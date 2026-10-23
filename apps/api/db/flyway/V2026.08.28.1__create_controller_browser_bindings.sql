CREATE TABLE controller_browser_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_hash VARCHAR(64) NOT NULL UNIQUE,
  controller_installation_id UUID NOT NULL,
  controller_credential_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  revocation_reason VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT controller_browser_bindings_controller_credential_id_fkey
    FOREIGN KEY (controller_credential_id)
    REFERENCES machine_controller_credentials(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT controller_browser_bindings_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT controller_browser_bindings_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT controller_browser_bindings_hash_check
    CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT controller_browser_bindings_lifetime_check
    CHECK (expires_at > issued_at),
  CONSTRAINT controller_browser_bindings_last_used_check
    CHECK (
      last_used_at IS NULL
      OR (last_used_at >= issued_at AND last_used_at <= expires_at)
    ),
  CONSTRAINT controller_browser_bindings_revocation_check
    CHECK (
      (revoked_at IS NULL AND revocation_reason IS NULL)
      OR (
        revoked_at IS NOT NULL
        AND revoked_at >= issued_at
        AND revocation_reason ~ '^[A-Z0-9_]+$'
      )
    )
);

CREATE UNIQUE INDEX controller_browser_bindings_active_identity_key
  ON controller_browser_bindings (
    controller_installation_id,
    controller_credential_id,
    user_id,
    organization_id
  )
  WHERE revoked_at IS NULL;

CREATE INDEX controller_browser_bindings_lookup_idx
  ON controller_browser_bindings (
    credential_hash,
    user_id,
    organization_id,
    revoked_at,
    expires_at
  );

CREATE INDEX controller_browser_bindings_credential_revocation_idx
  ON controller_browser_bindings (
    controller_credential_id,
    revoked_at,
    expires_at
  );
