-- Protocol-version-2 enrollment starts on the CLI. The API owns the pending
-- record and reserves the machine identifier before the active machines row
-- exists, so machine_id is unique but deliberately has no foreign key here.
CREATE TYPE "machine_enrollment_state" AS ENUM (
    'PENDING',
    'BROWSER_CLAIMED',
    'AWAITING_MACHINE_CONFIRMATION',
    'ACTIVE',
    'EXPIRED',
    'REJECTED',
    'CONSUMED'
);

CREATE TYPE "machine_enrollment_os_family" AS ENUM (
    'macos',
    'windows',
    'linux'
);

CREATE TABLE "pending_machine_enrollments" (
    "id"                              TEXT NOT NULL DEFAULT gen_random_uuid(),
    "machine_id"                      TEXT NOT NULL,
    "machine_public_key"              TEXT NOT NULL,
    "machine_public_key_fingerprint"  VARCHAR(64) NOT NULL,
    "machine_name"                    TEXT NOT NULL,
    "os_family"                       "machine_enrollment_os_family" NOT NULL,
    "cli_version"                     TEXT NOT NULL,
    "authorization_protocol_version"   INTEGER NOT NULL,
    "user_code_hmac"                  VARCHAR(64) NOT NULL,
    "device_secret_digest"            VARCHAR(64) NOT NULL,
    "state"                           "machine_enrollment_state" NOT NULL DEFAULT 'PENDING',
    "failure_count"                   INTEGER NOT NULL DEFAULT 0,
    "expires_at"                      TIMESTAMPTZ NOT NULL,
    "created_at"                      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "browser_claimed_at"              TIMESTAMPTZ,
    "awaiting_machine_confirmation_at" TIMESTAMPTZ,
    "activated_at"                    TIMESTAMPTZ,
    "expired_at"                      TIMESTAMPTZ,
    "rejected_at"                     TIMESTAMPTZ,
    "consumed_at"                     TIMESTAMPTZ,
    "updated_at"                      TIMESTAMPTZ NOT NULL,

    CONSTRAINT "pending_machine_enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pending_machine_enrollments_machine_id_key" UNIQUE ("machine_id"),
    CONSTRAINT "pending_machine_enrollments_user_code_hmac_key" UNIQUE ("user_code_hmac"),
    CONSTRAINT "pending_machine_enrollments_device_secret_digest_key" UNIQUE ("device_secret_digest"),
    CONSTRAINT "pending_machine_enrollments_protocol_version_check"
        CHECK ("authorization_protocol_version" = 2),
    CONSTRAINT "pending_machine_enrollments_failure_count_check"
        CHECK ("failure_count" >= 0),
    CONSTRAINT "pending_machine_enrollments_expiry_check"
        CHECK ("expires_at" > "created_at"),
    CONSTRAINT "pending_machine_enrollments_fingerprint_check"
        CHECK ("machine_public_key_fingerprint" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "pending_machine_enrollments_user_code_hmac_check"
        CHECK ("user_code_hmac" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "pending_machine_enrollments_device_secret_digest_check"
        CHECK ("device_secret_digest" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "pending_machine_enrollments_expires_at_idx"
    ON "pending_machine_enrollments" ("expires_at");
CREATE INDEX "pending_machine_enrollments_state_expires_at_idx"
    ON "pending_machine_enrollments" ("state", "expires_at");
CREATE INDEX "pending_machine_enrollments_fingerprint_state_expires_at_idx"
    ON "pending_machine_enrollments" (
        "machine_public_key_fingerprint",
        "state",
        "expires_at"
    );

CREATE TABLE "machine_enrollment_creation_attempts" (
    "id"             TEXT NOT NULL DEFAULT gen_random_uuid(),
    "source_address" VARCHAR(45) NOT NULL,
    "attempted_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "machine_enrollment_creation_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "machine_enrollment_attempts_source_attempted_at_idx"
    ON "machine_enrollment_creation_attempts" ("source_address", "attempted_at");
