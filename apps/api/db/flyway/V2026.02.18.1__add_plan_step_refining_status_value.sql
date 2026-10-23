-- Add enum value in its own migration so PostgreSQL commits it before any usage.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'plan_step_status'
      AND e.enumlabel = 'REFINING'
  ) THEN
    ALTER TYPE "plan_step_status" ADD VALUE 'REFINING';
  END IF;
END $$;
