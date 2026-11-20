ALTER TABLE "outbox_events"
    ADD COLUMN "claim_token" TEXT,
    ADD COLUMN "claim_expires_at" TIMESTAMP(3);

-- Recover claims abandoned by publishers that predate leases.
UPDATE "outbox_events"
SET "claim_expires_at" = CURRENT_TIMESTAMP
WHERE "status" = 'PROCESSING';

CREATE INDEX "outbox_events_status_claim_expires_at_idx"
    ON "outbox_events" ("status", "claim_expires_at");
