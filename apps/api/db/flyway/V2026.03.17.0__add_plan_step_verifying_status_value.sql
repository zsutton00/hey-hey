-- Add VERIFYING enum value to plan_step_status for 1-1 tracking with task VERIFYING status.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'plan_step_status'
      AND e.enumlabel = 'VERIFYING'
  ) THEN
    ALTER TYPE "plan_step_status" ADD VALUE 'VERIFYING';
  END IF;
END $$;
