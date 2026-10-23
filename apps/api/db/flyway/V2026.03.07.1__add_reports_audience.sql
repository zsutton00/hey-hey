DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReportAudience') THEN
    CREATE TYPE "ReportAudience" AS ENUM (
      'INTERNAL',
      'EXTERNAL_PROJECT',
      'EXTERNAL_ORGANIZATION'
    );
  END IF;
END $$;

ALTER TABLE "reports"
  ADD COLUMN IF NOT EXISTS "audience" "ReportAudience";

UPDATE "reports"
SET "audience" = 'INTERNAL'
WHERE "audience" IS NULL;

ALTER TABLE "reports"
  ALTER COLUMN "audience" SET NOT NULL;
