DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    WHERE t.typname = 'TaskSource'
  ) THEN
    CREATE TYPE "TaskSource" AS ENUM ('system', 'user', 'agent');
  END IF;
END
$$;

ALTER TABLE "tasks"
ADD COLUMN IF NOT EXISTS "source" "TaskSource";

UPDATE "tasks"
SET "source" = 'system'
WHERE "source" IS NULL;

ALTER TABLE "tasks"
ALTER COLUMN "source" SET DEFAULT 'system',
ALTER COLUMN "source" SET NOT NULL;
