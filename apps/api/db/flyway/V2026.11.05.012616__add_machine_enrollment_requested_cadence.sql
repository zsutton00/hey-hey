-- Duration a first-time `heyhey local` pairing page chose for its first grant.
-- Only the pending claim records the request; issued grants keep their own
-- cadence and expiry. Null means no first grant was requested.
ALTER TABLE pending_machine_enrollments
  ADD COLUMN IF NOT EXISTS requested_cadence "controller_authorization_cadence";
