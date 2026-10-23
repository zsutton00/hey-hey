ALTER TABLE "proposals" ADD COLUMN "message_id" TEXT;

CREATE INDEX "proposals_message_id_idx" ON "proposals"("message_id");

ALTER TABLE "proposals" ADD CONSTRAINT "proposals_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
