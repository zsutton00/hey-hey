-- A removed account passkey is retained as a tombstone so its credential id
-- can never be re-registered and revive authority. Controller credentials may
-- explicitly reference the account passkey they share a verified public key
-- with; removing the account passkey revokes every linked controller.
ALTER TABLE "account_passkeys"
    ADD COLUMN "revoked_at" TIMESTAMPTZ;

CREATE INDEX "account_passkeys_user_id_revoked_at_idx"
    ON "account_passkeys"("user_id", "revoked_at");

ALTER TABLE "machine_controller_credentials"
    ADD COLUMN "account_passkey_id" TEXT,
    ADD CONSTRAINT "machine_controller_credentials_account_passkey_id_fkey"
        FOREIGN KEY ("account_passkey_id") REFERENCES "account_passkeys"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "machine_controller_credentials_account_passkey_idx"
    ON "machine_controller_credentials"("account_passkey_id", "revoked_at");

-- A claim fixes how its credential will be used when it begins. A shared
-- claim records the account passkey it created so activation can attach it
-- to the controller credential, and refuses to if it has since been removed.
ALTER TABLE "pending_machine_enrollments"
    ADD COLUMN "enrollment_mode" VARCHAR(16) NOT NULL DEFAULT 'CONTROLLER_ONLY',
    ADD COLUMN "account_passkey_id" TEXT,
    ADD CONSTRAINT "pending_machine_enrollments_enrollment_mode_check"
        CHECK ("enrollment_mode" IN ('CONTROLLER_ONLY', 'SHARED_NEW')),
    ADD CONSTRAINT "pending_machine_enrollments_account_passkey_id_fkey"
        FOREIGN KEY ("account_passkey_id") REFERENCES "account_passkeys"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
