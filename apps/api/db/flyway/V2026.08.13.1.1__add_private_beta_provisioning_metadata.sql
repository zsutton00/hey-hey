ALTER TABLE private_beta_access_requests
  ADD COLUMN IF NOT EXISTS provisioning_attempted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provisioning_failure_code VARCHAR(120);

COMMENT ON COLUMN private_beta_access_requests.provisioning_attempted_at IS
  'Timestamp of the latest private-beta provisioning attempt; distinct from decision_at.';

COMMENT ON COLUMN private_beta_access_requests.provisioning_failure_code IS
  'Bounded private-beta provisioning failure code; raw provider and database errors are never stored.';
