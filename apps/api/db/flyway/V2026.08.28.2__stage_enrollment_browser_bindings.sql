ALTER TABLE pending_machine_enrollments
  ADD COLUMN browser_binding_credential_hash VARCHAR(64),
  ADD COLUMN browser_binding_issued_at TIMESTAMPTZ,
  ADD COLUMN browser_binding_expires_at TIMESTAMPTZ,
  ADD CONSTRAINT pending_machine_enrollments_browser_binding_hash_check
    CHECK (
      browser_binding_credential_hash IS NULL
      OR browser_binding_credential_hash ~ '^[0-9a-f]{64}$'
    ),
  ADD CONSTRAINT pending_machine_enrollments_browser_binding_lifecycle_check
    CHECK (
      (browser_binding_credential_hash IS NULL
        AND browser_binding_issued_at IS NULL
        AND browser_binding_expires_at IS NULL)
      OR
      (browser_binding_credential_hash IS NOT NULL
        AND browser_binding_issued_at IS NOT NULL
        AND browser_binding_expires_at > browser_binding_issued_at)
    );

CREATE UNIQUE INDEX pending_machine_enrollments_browser_binding_hash_key
  ON pending_machine_enrollments (browser_binding_credential_hash)
  WHERE browser_binding_credential_hash IS NOT NULL;
