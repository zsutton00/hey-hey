DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'CodingSessionStatus'
  ) THEN
    CREATE TYPE "CodingSessionStatus" AS ENUM (
      'NOT_STARTED',
      'IN_PROGRESS',
      'COMPLETED',
      'ERRORED'
    );
  END IF;
END
$$;

ALTER TABLE "coding_sessions"
ADD COLUMN IF NOT EXISTS "status" "CodingSessionStatus";

UPDATE "coding_sessions"
SET "status" = 'NOT_STARTED'
WHERE "status" IS NULL;

ALTER TABLE "coding_sessions"
ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED',
ALTER COLUMN "status" SET NOT NULL;
