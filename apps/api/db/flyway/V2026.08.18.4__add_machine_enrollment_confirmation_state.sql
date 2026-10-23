-- Poll throttling and the server-issued nonce are durable enrollment state.
-- Keeping both on the pending row makes polling and confirmation safe across
-- API instances and restarts.
ALTER TABLE "pending_machine_enrollments"
    ADD COLUMN "last_polled_at" TIMESTAMPTZ,
    ADD COLUMN "confirmation_nonce" TEXT;

ALTER TABLE "pending_machine_enrollments"
    ADD CONSTRAINT "pending_machine_enrollments_confirmation_nonce_check"
        CHECK (
            "confirmation_nonce" IS NULL
            OR "confirmation_nonce" ~ '^[A-Za-z0-9_-]+$'
        );

CREATE INDEX "pending_machine_enrollments_confirmation_nonce_idx"
    ON "pending_machine_enrollments" ("confirmation_nonce");
