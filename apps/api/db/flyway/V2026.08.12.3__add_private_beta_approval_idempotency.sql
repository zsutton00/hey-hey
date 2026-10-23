ALTER TABLE private_beta_access_requests
  ADD COLUMN IF NOT EXISTS provisioning_user_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisioning_organization_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisioning_credential_id TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_credential_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisioning_organization_api_key_id TEXT,
  ADD COLUMN IF NOT EXISTS provisioning_organization_api_key_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS welcome_email_idempotency_key VARCHAR(255),
  ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_provisioned_user_id_key
  ON private_beta_access_requests (provisioned_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_provisioned_organization_id_key
  ON private_beta_access_requests (provisioned_organization_id);

CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_provisioning_credential_id_key
  ON private_beta_access_requests (provisioning_credential_id);

CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_provisioning_api_key_id_key
  ON private_beta_access_requests (provisioning_organization_api_key_id);

CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_welcome_email_idempotency_key_key
  ON private_beta_access_requests (welcome_email_idempotency_key);

ALTER TABLE password_change_credentials
  ADD COLUMN IF NOT EXISTS private_beta_access_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS password_change_credentials_private_beta_access_request_id_key
  ON password_change_credentials (private_beta_access_request_id);
