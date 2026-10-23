-- Additive vocabulary required by canonical PLAN and PLAN_STAGE work items.
-- Definitions that use these values are seeded only by the later
-- V2026.09.11.4 migration so PostgreSQL never has to consume a new enum value
-- in the transaction that adds it.
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    WHERE type.typname = 'WorkStatus'
      AND value.enumlabel = 'REFINING'
  ) THEN
    ALTER TYPE "WorkStatus" ADD VALUE 'REFINING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum value
    JOIN pg_type type ON type.oid = value.enumtypid
    WHERE type.typname = 'WorkStatus'
      AND value.enumlabel = 'BLOCKED'
  ) THEN
    ALTER TYPE "WorkStatus" ADD VALUE 'BLOCKED';
  END IF;
END
$migration$;
