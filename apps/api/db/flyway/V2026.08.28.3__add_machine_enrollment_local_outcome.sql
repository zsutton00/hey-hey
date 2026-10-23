ALTER TABLE pending_machine_enrollments
  ADD COLUMN IF NOT EXISTS local_outcome_code VARCHAR(64),
  ADD COLUMN IF NOT EXISTS local_outcome_issued_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS local_outcome_consumed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'pending_machine_enrollments_local_outcome_code_check'
  ) THEN
    ALTER TABLE pending_machine_enrollments
      ADD CONSTRAINT pending_machine_enrollments_local_outcome_code_check
      CHECK (
        local_outcome_code IS NULL
        OR local_outcome_code = 'MACHINE_ENROLLMENT_ORIGIN_ACCOUNT_MISMATCH'
      );
  END IF;
END
$$;
