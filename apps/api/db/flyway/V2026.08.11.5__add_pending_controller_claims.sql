-- A pending enrollment owns at most one browser claim. The enrollment state
-- and its existing transition timestamps remain the compare-and-set source of
-- truth; these columns retain only the authenticated claimant, the
-- challenge, and normalized public credential evidence needed by the later
-- machine-confirmation step.
ALTER TABLE "pending_machine_enrollments"
    ADD COLUMN "claimant_user_id" TEXT,
    ADD COLUMN "claimant_organization_id" TEXT,
    ADD COLUMN "controller_label" TEXT,
    ADD COLUMN "webauthn_challenge" TEXT,
    ADD COLUMN "challenge_issued_at" TIMESTAMPTZ,
    ADD COLUMN "challenge_expires_at" TIMESTAMPTZ,
    ADD COLUMN "challenge_consumed_at" TIMESTAMPTZ,
    ADD COLUMN "credential_id" TEXT,
    ADD COLUMN "credential_public_key_x" BYTEA,
    ADD COLUMN "credential_public_key_y" BYTEA,
    ADD COLUMN "credential_transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "credential_aaguid" BYTEA,
    ADD COLUMN "credential_sign_count" INTEGER,
    ADD COLUMN "credential_backup_eligible" BOOLEAN,
    ADD COLUMN "credential_backup_state" BOOLEAN,
    ADD COLUMN "credential_fingerprint" VARCHAR(64),
    ADD COLUMN "credential_verified_at" TIMESTAMPTZ;

ALTER TABLE "pending_machine_enrollments"
    ADD CONSTRAINT "pending_machine_enrollments_claimant_user_id_fkey"
        FOREIGN KEY ("claimant_user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "pending_machine_enrollments_claimant_organization_id_fkey"
        FOREIGN KEY ("claimant_organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    ADD CONSTRAINT "pending_machine_enrollments_credential_id_key"
        UNIQUE ("credential_id"),
    ADD CONSTRAINT "pending_machine_enrollments_claimant_pair_check"
        CHECK (
            ("claimant_user_id" IS NULL AND "claimant_organization_id" IS NULL)
            OR ("claimant_user_id" IS NOT NULL AND "claimant_organization_id" IS NOT NULL)
        ),
    ADD CONSTRAINT "pending_machine_enrollments_claim_challenge_pair_check"
        CHECK (
            ("webauthn_challenge" IS NULL
                AND "challenge_issued_at" IS NULL
                AND "challenge_expires_at" IS NULL
                AND "challenge_consumed_at" IS NULL)
            OR ("webauthn_challenge" IS NOT NULL
                AND "challenge_issued_at" IS NOT NULL
                AND "challenge_expires_at" IS NOT NULL
                AND "challenge_expires_at" > "challenge_issued_at"
                AND ("challenge_consumed_at" IS NULL OR "challenge_consumed_at" >= "challenge_issued_at"))
        ),
    ADD CONSTRAINT "pending_machine_enrollments_verified_credential_pair_check"
        CHECK (
            ("credential_id" IS NULL
                AND "credential_public_key_x" IS NULL
                AND "credential_public_key_y" IS NULL
                AND "credential_sign_count" IS NULL
                AND "credential_backup_eligible" IS NULL
                AND "credential_backup_state" IS NULL
                AND "credential_fingerprint" IS NULL
                AND "credential_verified_at" IS NULL)
            OR ("credential_id" IS NOT NULL
                AND "credential_public_key_x" IS NOT NULL
                AND "credential_public_key_y" IS NOT NULL
                AND "credential_sign_count" IS NOT NULL
                AND "credential_backup_eligible" IS NOT NULL
                AND "credential_backup_state" IS NOT NULL
                AND "credential_fingerprint" IS NOT NULL
                AND "credential_verified_at" IS NOT NULL)
        ),
    ADD CONSTRAINT "pending_machine_enrollments_credential_public_key_check"
        CHECK (
            ("credential_public_key_x" IS NULL OR octet_length("credential_public_key_x") = 32)
            AND ("credential_public_key_y" IS NULL OR octet_length("credential_public_key_y") = 32)
        ),
    ADD CONSTRAINT "pending_machine_enrollments_credential_aaguid_check"
        CHECK ("credential_aaguid" IS NULL OR octet_length("credential_aaguid") = 16),
    ADD CONSTRAINT "pending_machine_enrollments_credential_sign_count_check"
        CHECK ("credential_sign_count" IS NULL OR "credential_sign_count" >= 0),
    ADD CONSTRAINT "pending_machine_enrollments_credential_fingerprint_check"
        CHECK ("credential_fingerprint" IS NULL OR "credential_fingerprint" ~ '^[0-9a-f]{64}$');

CREATE INDEX "pending_machine_enrollments_challenge_expires_at_idx"
    ON "pending_machine_enrollments" ("challenge_expires_at");
CREATE INDEX "pending_machine_enrollments_state_challenge_expiry_idx"
    ON "pending_machine_enrollments" ("state", "challenge_expires_at");
CREATE INDEX "pending_machine_enrollments_id_state_idx"
    ON "pending_machine_enrollments" ("id", "state");
CREATE INDEX "pending_machine_enrollments_claimant_state_idx"
    ON "pending_machine_enrollments" ("claimant_user_id", "state");

-- Every failed authenticated browser submission is retained outside the
-- enrollment transaction so account and source-address rolling limits survive
-- retries, rollbacks, and API restarts. The optional enrollment reference is
-- non-authoritative and is nulled if the enrollment is later removed.
CREATE TABLE "machine_enrollment_claim_failures" (
    "id"             TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id"        TEXT NOT NULL,
    "source_address" VARCHAR(45) NOT NULL,
    "enrollment_id"  TEXT,
    "attempted_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "machine_enrollment_claim_failures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "machine_enrollment_claim_failures_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "machine_enrollment_claim_failures_enrollment_id_fkey"
        FOREIGN KEY ("enrollment_id") REFERENCES "pending_machine_enrollments"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "machine_enrollment_claim_failures_user_attempted_idx"
    ON "machine_enrollment_claim_failures" ("user_id", "attempted_at");
CREATE INDEX "machine_enrollment_claim_failures_source_attempted_idx"
    ON "machine_enrollment_claim_failures" ("source_address", "attempted_at");
CREATE INDEX "machine_enrollment_claim_failures_enrollment_attempted_idx"
    ON "machine_enrollment_claim_failures" ("enrollment_id", "attempted_at");
