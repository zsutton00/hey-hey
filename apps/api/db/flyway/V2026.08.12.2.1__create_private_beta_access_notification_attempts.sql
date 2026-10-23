DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'private_beta_access_notification_recipient_role'
  ) THEN
    CREATE TYPE private_beta_access_notification_recipient_role AS ENUM (
      'REQUESTER',
      'OPERATOR'
    );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'private_beta_access_notification_delivery_state'
  ) THEN
    CREATE TYPE private_beta_access_notification_delivery_state AS ENUM (
      'PENDING',
      'PROCESSING',
      'SENT',
      'FAILED'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS private_beta_access_notification_attempts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_id TEXT NOT NULL,
  recipient_role private_beta_access_notification_recipient_role NOT NULL,
  delivery_state private_beta_access_notification_delivery_state NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK (max_attempts >= 1),
  claimed_at TIMESTAMPTZ,
  claim_expires_at TIMESTAMPTZ,
  claim_token TEXT,
  last_attempt_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  last_error VARCHAR(2000),
  next_retry_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT private_beta_access_notification_attempts_request_fk
    FOREIGN KEY (request_id)
    REFERENCES private_beta_access_requests (id)
    ON DELETE CASCADE,
  CONSTRAINT private_beta_access_notification_attempts_request_role_key
    UNIQUE (request_id, recipient_role)
);

CREATE INDEX IF NOT EXISTS private_beta_access_notification_attempts_due_idx
  ON private_beta_access_notification_attempts (delivery_state, next_retry_at);

CREATE INDEX IF NOT EXISTS private_beta_access_notification_attempts_claim_idx
  ON private_beta_access_notification_attempts (delivery_state, claim_expires_at);
