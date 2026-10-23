DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "coding_sessions"
    WHERE "conversation_id" IS NULL
  ) THEN
    RAISE EXCEPTION
      'Cannot enforce coding_sessions.conversation_id NOT NULL: existing rows are missing conversation_id';
  END IF;
END $$;

ALTER TABLE "coding_sessions"
ALTER COLUMN "conversation_id" SET NOT NULL;

ALTER TABLE "coding_sessions"
DROP CONSTRAINT IF EXISTS "coding_sessions_conversation_id_fkey";

ALTER TABLE "coding_sessions"
ADD CONSTRAINT "coding_sessions_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;
