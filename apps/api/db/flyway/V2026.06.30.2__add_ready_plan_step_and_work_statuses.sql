-- Add READY in its own enum-only migration. No defaults or row updates use the
-- new values here, so PostgreSQL commits the values before any later usage.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'WorkStatus'
      AND e.enumlabel = 'READY'
  ) THEN
    ALTER TYPE "WorkStatus" ADD VALUE 'READY' AFTER 'BACKLOG';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'plan_step_status'
      AND e.enumlabel = 'READY'
  ) THEN
    ALTER TYPE "plan_step_status" ADD VALUE 'READY' AFTER 'NOT_STARTED';
  END IF;
END $$;
