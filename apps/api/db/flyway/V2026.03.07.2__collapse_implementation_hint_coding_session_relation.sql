ALTER TABLE "implementation_hints"
ADD COLUMN IF NOT EXISTS "coding_session_id" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'implementation_hint_coding_sessions'
  ) AND EXISTS (
    SELECT 1
    FROM "implementation_hint_coding_sessions"
    GROUP BY "implementation_hint_id"
    HAVING COUNT(DISTINCT "coding_session_id") > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate implementation_hints: at least one hint is linked to multiple coding sessions';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'implementation_hint_coding_sessions'
  ) THEN
    UPDATE "implementation_hints" AS hints
    SET "coding_session_id" = links."coding_session_id"
    FROM (
      SELECT
        "implementation_hint_id",
        MIN("coding_session_id") AS "coding_session_id"
      FROM "implementation_hint_coding_sessions"
      GROUP BY "implementation_hint_id"
    ) AS links
    WHERE hints."id" = links."implementation_hint_id"
      AND hints."coding_session_id" IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  DELETE FROM "implementation_hints"
  WHERE "coding_session_id" IS NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "implementation_hints"
    WHERE "coding_session_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate implementation_hints: at least one hint is missing coding_session_id after backfill';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'implementation_hints_coding_session_id_fkey'
  ) THEN
    ALTER TABLE "implementation_hints"
    ADD CONSTRAINT "implementation_hints_coding_session_id_fkey"
    FOREIGN KEY ("coding_session_id")
    REFERENCES "coding_sessions"("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "implementation_hints_coding_session_id_idx"
ON "implementation_hints"("coding_session_id");

ALTER TABLE "implementation_hints"
ALTER COLUMN "coding_session_id" SET NOT NULL;

DROP TABLE IF EXISTS "implementation_hint_coding_sessions";
