DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'private_beta_access_request_status'
  ) THEN
    CREATE TYPE private_beta_access_request_status AS ENUM (
      'PENDING',
      'APPROVAL_IN_PROGRESS',
      'APPROVED',
      'REJECTED',
      'PROVISIONING_FAILED'
    );
  END IF;
END
$$;

CREATE TABLE private_beta_access_requests (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  submitted_email VARCHAR(254) NOT NULL,
  normalized_email VARCHAR(254) NOT NULL,
  name VARCHAR(120) NOT NULL,
  organization_name VARCHAR(200) NOT NULL,
  team_size INTEGER NOT NULL CHECK (team_size BETWEEN 1 AND 10000),
  product_context VARCHAR(2000) NOT NULL,
  access_rationale VARCHAR(2000) NOT NULL,
  status private_beta_access_request_status NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decision_at TIMESTAMPTZ,
  provisioned_user_id TEXT,
  provisioned_organization_id TEXT,
  provisioning_completed_at TIMESTAMPTZ,
  provisioning_error VARCHAR(2000)
);

CREATE INDEX IF NOT EXISTS private_beta_access_requests_normalized_email_idx
  ON private_beta_access_requests (normalized_email);

CREATE INDEX IF NOT EXISTS private_beta_access_requests_status_created_at_idx
  ON private_beta_access_requests (status, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_one_pending_email_idx
  ON private_beta_access_requests (normalized_email)
  WHERE status = 'PENDING';
