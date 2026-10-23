DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'private_beta_disclosure_document_kind'
  ) THEN
    CREATE TYPE private_beta_disclosure_document_kind AS ENUM (
      'TERMS', 'PRIVACY', 'SECURITY'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'private_beta_disclosure_action_type'
  ) THEN
    CREATE TYPE private_beta_disclosure_action_type AS ENUM (
      'AGREED', 'ACKNOWLEDGED'
    );
  END IF;
END
$$;

CREATE TABLE private_beta_disclosure_acceptances (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  organization_id TEXT NOT NULL,
  document_kind private_beta_disclosure_document_kind NOT NULL,
  version VARCHAR(128) NOT NULL,
  effective_date DATE NOT NULL,
  action_type private_beta_disclosure_action_type NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT private_beta_disclosure_acceptances_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT private_beta_disclosure_acceptances_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX private_beta_disclosure_acceptances_identity_key
  ON private_beta_disclosure_acceptances (
    user_id, organization_id, document_kind, version
  );

CREATE INDEX private_beta_disclosure_acceptances_lookup_idx
  ON private_beta_disclosure_acceptances (
    user_id, organization_id, document_kind
  );
