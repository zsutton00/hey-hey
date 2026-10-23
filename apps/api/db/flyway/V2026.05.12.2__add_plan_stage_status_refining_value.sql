-- Add enum value in its own migration so PostgreSQL commits it before any usage.
-- REFINING is positioned BEFORE 'IN_PROGRESS' to match the order declared in
-- src/generated/model/planStageStatus.ts and prisma/schema.prisma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'plan_stage_status'
      AND e.enumlabel = 'REFINING'
  ) THEN
    ALTER TYPE "plan_stage_status" ADD VALUE 'REFINING' BEFORE 'IN_PROGRESS';
  END IF;
END $$;
