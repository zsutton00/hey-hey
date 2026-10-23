-- Add enum value in its own migration so PostgreSQL commits it before any usage.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'plan_status'
      AND e.enumlabel = 'ON_HOLD'
  ) THEN
    ALTER TYPE "plan_status" ADD VALUE 'ON_HOLD';
  END IF;
END $$;
