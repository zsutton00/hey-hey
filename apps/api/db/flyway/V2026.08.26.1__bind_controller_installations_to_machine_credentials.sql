ALTER TABLE pending_machine_enrollments
  ADD COLUMN IF NOT EXISTS controller_installation_id UUID;

ALTER TABLE machine_controller_credentials
  ADD COLUMN IF NOT EXISTS controller_installation_id UUID;

CREATE INDEX IF NOT EXISTS pending_machine_enrollments_controller_installation_idx
  ON pending_machine_enrollments (controller_installation_id);

CREATE INDEX IF NOT EXISTS machine_controller_credentials_installation_machine_revoked_idx
  ON machine_controller_credentials (controller_installation_id, machine_id, revoked_at);
