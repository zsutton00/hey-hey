CREATE TYPE password_change_credential_kind AS ENUM (
  'REQUIRED_CHANGE',
  'ACCOUNT_RECOVERY'
);

ALTER TABLE password_change_credentials
  ADD COLUMN issuance_kind password_change_credential_kind;

UPDATE password_change_credentials
SET issuance_kind = 'REQUIRED_CHANGE'
WHERE issuance_kind IS NULL;

ALTER TABLE password_change_credentials
  ALTER COLUMN issuance_kind SET NOT NULL,
  ALTER COLUMN issuance_kind SET DEFAULT 'REQUIRED_CHANGE',
  ADD CONSTRAINT password_change_credentials_recovery_expiry_check
    CHECK (
      issuance_kind <> 'ACCOUNT_RECOVERY'
      OR (
        expires_at IS NOT NULL
        AND expires_at > issued_at
        AND expires_at <= issued_at + INTERVAL '15 minutes'
      )
    );

CREATE INDEX password_change_credentials_user_kind_consumed_expiry_idx
  ON password_change_credentials (
    user_id,
    issuance_kind,
    consumed_at,
    expires_at
  );
