ALTER TABLE "messages"
  ADD COLUMN "activity_at" TIMESTAMP(3);

UPDATE "messages"
SET "activity_at" = "created_at"
WHERE "activity_at" IS NULL;

ALTER TABLE "messages"
  ALTER COLUMN "activity_at" SET DEFAULT CURRENT_TIMESTAMP,
  ALTER COLUMN "activity_at" SET NOT NULL;

CREATE INDEX "messages_conversation_activity_id_idx"
  ON "messages" ("conversation_id", "activity_at" DESC, "id" DESC);

CREATE FUNCTION "set_message_activity_at_on_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."activity_at" := GREATEST(
    clock_timestamp()::timestamp(3),
    OLD."activity_at" + INTERVAL '1 millisecond'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER "messages_activity_at_on_update"
  BEFORE UPDATE ON "messages"
  FOR EACH ROW
  EXECUTE FUNCTION "set_message_activity_at_on_update"();
