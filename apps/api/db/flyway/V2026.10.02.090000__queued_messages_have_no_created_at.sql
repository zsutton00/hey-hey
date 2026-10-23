-- A queued executable input enters the conversation timeline only when the
-- platform accepts the agent's start of it. Until then it has no timeline
-- position (created_at) and no session-recency timestamp (content_updated_at).
-- Defaults stay so every other insert path keeps writing now().
ALTER TABLE "messages"
  ALTER COLUMN "created_at" DROP NOT NULL,
  ALTER COLUMN "content_updated_at" DROP NOT NULL;

UPDATE "messages"
SET "created_at" = NULL,
    "content_updated_at" = NULL
WHERE "execution_status" = 'queued';
