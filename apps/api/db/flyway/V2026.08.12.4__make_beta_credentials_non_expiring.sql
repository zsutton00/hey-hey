ALTER TABLE password_change_credentials
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

ALTER TABLE password_change_credentials
  DROP CONSTRAINT IF EXISTS password_change_credentials_expiry_check;

ALTER TABLE password_change_credentials
  ADD CONSTRAINT password_change_credentials_expiry_check
    CHECK (expires_at IS NULL OR expires_at > issued_at);

ALTER TABLE password_change_credentials
  ADD CONSTRAINT password_change_credentials_revoked_at_check
    CHECK (revoked_at IS NULL OR revoked_at >= issued_at);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'password_change_credentials_private_beta_access_request_id_fkey'
  ) THEN
    ALTER TABLE password_change_credentials
      ADD CONSTRAINT password_change_credentials_private_beta_access_request_id_fkey
      FOREIGN KEY (private_beta_access_request_id)
      REFERENCES private_beta_access_requests (id)
      ON DELETE CASCADE;
  END IF;
END
$$;

-- Beta credentials issued by the previous implementation must not be shortened
-- by the old fifteen-minute policy when this contract is deployed.
UPDATE password_change_credentials
SET expires_at = NULL
WHERE private_beta_access_request_id IS NOT NULL
  AND consumed_at IS NULL;
