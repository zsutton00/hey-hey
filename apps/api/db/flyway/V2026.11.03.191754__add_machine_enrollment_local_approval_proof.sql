-- Opaque first-time `heyhey local` approval proof submitted with a browser
-- claim. Only the originating CLI can verify it; it confers no API authority.
ALTER TABLE pending_machine_enrollments
  ADD COLUMN IF NOT EXISTS local_approval_proof VARCHAR(43);
