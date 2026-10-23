-- Add enum value in its own migration so PostgreSQL commits it before any usage.
-- SUPERSEDED is appended last to match the order declared in
-- src/generated/model/workStatus.ts and prisma/schema.prisma.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname = 'WorkStatus'
      AND e.enumlabel = 'SUPERSEDED'
  ) THEN
    ALTER TYPE "WorkStatus" ADD VALUE 'SUPERSEDED';
  END IF;
END $$;
