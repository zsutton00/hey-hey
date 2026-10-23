DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'ImplementationHintExtractedFrom'
  ) THEN
    CREATE TYPE "ImplementationHintExtractedFrom" AS ENUM ('AGENT', 'USER');
  END IF;
END $$;

ALTER TABLE "implementation_hints"
  ADD COLUMN IF NOT EXISTS "hint" TEXT,
  ADD COLUMN IF NOT EXISTS "context" JSONB,
  ADD COLUMN IF NOT EXISTS "extracted_from" "ImplementationHintExtractedFrom",
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "implementation_hints"
SET "version" = 1
WHERE "version" IS NULL;

ALTER TABLE "implementation_hints"
  ALTER COLUMN "version" SET DEFAULT 1,
  ALTER COLUMN "version" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "implementation_hints_extracted_from_idx"
ON "implementation_hints"("extracted_from");

CREATE INDEX IF NOT EXISTS "implementation_hints_confidence_idx"
ON "implementation_hints"("confidence");

CREATE TABLE IF NOT EXISTS "implementation_hint_versions" (
  "id" TEXT NOT NULL,
  "hint_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "hint" TEXT NOT NULL,
  "context" JSONB,
  "extracted_from" "ImplementationHintExtractedFrom" NOT NULL,
  "confidence" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "implementation_hint_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "implementation_hint_file_references" (
  "id" TEXT NOT NULL,
  "hint_id" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "start_line" INTEGER,
  "end_line" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "implementation_hint_file_references_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'implementation_hint_versions_hint_id_fkey'
  ) THEN
    ALTER TABLE "implementation_hint_versions"
      ADD CONSTRAINT "implementation_hint_versions_hint_id_fkey"
      FOREIGN KEY ("hint_id") REFERENCES "implementation_hints"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'implementation_hint_file_references_hint_id_fkey'
  ) THEN
    ALTER TABLE "implementation_hint_file_references"
      ADD CONSTRAINT "implementation_hint_file_references_hint_id_fkey"
      FOREIGN KEY ("hint_id") REFERENCES "implementation_hints"("id")
      ON DELETE CASCADE
      ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "implementation_hint_versions_hint_id_idx"
ON "implementation_hint_versions"("hint_id");

CREATE INDEX IF NOT EXISTS "implementation_hint_versions_created_at_idx"
ON "implementation_hint_versions"("created_at");

CREATE UNIQUE INDEX IF NOT EXISTS "implementation_hint_versions_hint_id_version_key"
ON "implementation_hint_versions"("hint_id", "version");

CREATE INDEX IF NOT EXISTS "implementation_hint_file_references_hint_id_idx"
ON "implementation_hint_file_references"("hint_id");

CREATE INDEX IF NOT EXISTS "implementation_hint_file_references_file_path_idx"
ON "implementation_hint_file_references"("file_path");

CREATE INDEX IF NOT EXISTS "implementation_hint_file_references_hint_id_file_path_idx"
ON "implementation_hint_file_references"("hint_id", "file_path");
