-- Preserve legacy machine rows while making protocol readiness explicit. A
-- legacy row has no protocol-v2 claim or organization until a later local
-- enrollment activates it; this migration must not promote existing rows.
CREATE TYPE "machine_authorization_state" AS ENUM (
    'LEGACY',
    'CONTROLLER_ENROLLMENT_REQUIRED',
    'READY'
);

ALTER TABLE "machines"
    ADD COLUMN "organization_id" TEXT,
    ADD COLUMN "authorization_protocol_version" INTEGER,
    ADD COLUMN "authorization_state" "machine_authorization_state" NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "machines"
    ADD CONSTRAINT "machines_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    ADD CONSTRAINT "machines_authorization_protocol_version_check"
        CHECK (
            "authorization_protocol_version" IS NULL
            OR "authorization_protocol_version" BETWEEN 1 AND 2
        );

CREATE INDEX "machines_organization_id_idx"
    ON "machines" ("organization_id");
CREATE INDEX "machines_authorization_state_idx"
    ON "machines" ("authorization_state");
CREATE INDEX "machines_organization_authorization_state_idx"
    ON "machines" ("organization_id", "authorization_state");

-- One durable controller record is created from one consumed, verified
-- enrollment. The enrollment foreign key is unique so retries or competing
-- confirmations cannot create a second active binding from that claim.
CREATE TABLE "machine_controller_credentials" (
    "id"                         TEXT NOT NULL DEFAULT gen_random_uuid(),
    "machine_id"                 TEXT NOT NULL,
    "user_id"                    TEXT NOT NULL,
    "organization_id"            TEXT NOT NULL,
    "credential_id"              TEXT NOT NULL,
    "credential_public_key_x"    BYTEA NOT NULL,
    "credential_public_key_y"    BYTEA NOT NULL,
    "credential_transports"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "credential_aaguid"          BYTEA,
    "credential_sign_count"      INTEGER NOT NULL,
    "credential_backup_eligible" BOOLEAN NOT NULL,
    "credential_backup_state"    BOOLEAN NOT NULL,
    "controller_label"           TEXT NOT NULL,
    "credential_fingerprint"     VARCHAR(64) NOT NULL,
    "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_used_at"               TIMESTAMPTZ,
    "revoked_at"                 TIMESTAMPTZ,
    "enrollment_id"              TEXT NOT NULL,

    CONSTRAINT "machine_controller_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "machine_controller_credentials_credential_id_key"
        UNIQUE ("credential_id"),
    CONSTRAINT "machine_controller_credentials_enrollment_id_key"
        UNIQUE ("enrollment_id"),
    CONSTRAINT "machine_controller_credentials_machine_id_fkey"
        FOREIGN KEY ("machine_id") REFERENCES "machines"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "machine_controller_credentials_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "machine_controller_credentials_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "machine_controller_credentials_enrollment_id_fkey"
        FOREIGN KEY ("enrollment_id") REFERENCES "pending_machine_enrollments"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "machine_controller_credentials_public_key_check"
        CHECK (
            octet_length("credential_public_key_x") = 32
            AND octet_length("credential_public_key_y") = 32
        ),
    CONSTRAINT "machine_controller_credentials_aaguid_check"
        CHECK ("credential_aaguid" IS NULL OR octet_length("credential_aaguid") = 16),
    CONSTRAINT "machine_controller_credentials_sign_count_check"
        CHECK ("credential_sign_count" >= 0),
    CONSTRAINT "machine_controller_credentials_fingerprint_check"
        CHECK ("credential_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "machine_controller_credentials_last_used_at_check"
        CHECK ("last_used_at" IS NULL OR "last_used_at" >= "created_at"),
    CONSTRAINT "machine_controller_credentials_revoked_at_check"
        CHECK ("revoked_at" IS NULL OR "revoked_at" >= "created_at")
);

CREATE INDEX "machine_controller_credentials_machine_revoked_at_idx"
    ON "machine_controller_credentials" ("machine_id", "revoked_at");
CREATE INDEX "machine_controller_credentials_user_revoked_at_idx"
    ON "machine_controller_credentials" ("user_id", "revoked_at");
CREATE INDEX "machine_controller_credentials_organization_revoked_at_idx"
    ON "machine_controller_credentials" ("organization_id", "revoked_at");
