DROP TRIGGER IF EXISTS "messages_activity_at_on_update" ON "messages";

DROP FUNCTION IF EXISTS "set_message_activity_at_on_update"();

ALTER TABLE "messages"
  RENAME COLUMN "activity_at" TO "content_updated_at";

ALTER INDEX "messages_conversation_activity_id_idx"
  RENAME TO "messages_conversation_content_updated_id_idx";
