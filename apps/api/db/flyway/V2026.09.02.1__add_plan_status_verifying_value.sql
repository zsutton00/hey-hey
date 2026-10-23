-- Add the Plan-level verification checkpoint before any runtime code writes it.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'plan_status'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'plan_status'
      AND e.enumlabel = 'VERIFYING'
  ) THEN
    ALTER TYPE "plan_status" ADD VALUE 'VERIFYING' BEFORE 'COMPLETE';
  END IF;
END $$;
