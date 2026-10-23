-- Record which machine a pairing code produced once it is consumed. Nullable
-- because pending codes (and any pre-existing rows) have not yet been redeemed;
-- ON DELETE SET NULL so revoking/deleting a machine leaves the historical code
-- row intact rather than cascading it away.
ALTER TABLE "pairing_codes"
    ADD COLUMN "machine_id" TEXT;

ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_machine_id_fkey"
        FOREIGN KEY ("machine_id") REFERENCES "machines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "pairing_codes_machine_id_idx" ON "pairing_codes"("machine_id");
