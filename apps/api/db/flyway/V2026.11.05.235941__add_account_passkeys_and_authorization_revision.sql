-- Account passkeys and browser-session authorization revision.
--
-- Every browser access token snapshots the user's authorization revision.
-- Adding or removing an account passkey increments it in the same
-- transaction that revokes earlier browser sessions, so stale access is
-- rejected on its next request instead of at token expiry.
ALTER TABLE "users"
    ADD COLUMN "authorization_revision" INTEGER NOT NULL DEFAULT 0,
    ADD CONSTRAINT "users_authorization_revision_check"
        CHECK ("authorization_revision" >= 0);

-- Account-login passkeys. Only the verified public key and the metadata
-- SimpleWebAuthn needs to verify later assertions are stored; there is no
-- private key material. These are distinct from controller credentials.
CREATE TABLE "account_passkeys" (
    "id"                TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id"           TEXT NOT NULL,
    "credential_id"     VARCHAR(1024) NOT NULL,
    "public_key"        BYTEA NOT NULL,
    "sign_count"        BIGINT NOT NULL DEFAULT 0,
    "transports"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "device_type"       VARCHAR(32) NOT NULL,
    "backed_up"         BOOLEAN NOT NULL,
    "aaguid"            VARCHAR(64),
    "name"              VARCHAR(100) NOT NULL,
    "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_used_at"      TIMESTAMPTZ,

    CONSTRAINT "account_passkeys_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_passkeys_credential_id_key" UNIQUE ("credential_id"),
    CONSTRAINT "account_passkeys_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_passkeys_sign_count_check" CHECK ("sign_count" >= 0)
);

CREATE INDEX "account_passkeys_user_id_idx" ON "account_passkeys"("user_id");

-- Short-lived, single-use WebAuthn ceremony state. A challenge is bound to
-- its purpose and, where applicable, to the account, the acting browser
-- session and the removal target. Consumption is atomic.
CREATE TABLE "account_passkey_challenges" (
    "id"                    TEXT NOT NULL DEFAULT gen_random_uuid(),
    "challenge"             VARCHAR(128) NOT NULL,
    "purpose"               VARCHAR(32) NOT NULL,
    "user_id"               TEXT,
    "browser_session_id"    TEXT,
    "target_passkey_id"     TEXT,
    "rp_id"                 VARCHAR(255) NOT NULL,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at"            TIMESTAMPTZ NOT NULL,
    "consumed_at"           TIMESTAMPTZ,

    CONSTRAINT "account_passkey_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_passkey_challenges_challenge_key" UNIQUE ("challenge"),
    CONSTRAINT "account_passkey_challenges_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_passkey_challenges_purpose_check"
        CHECK ("purpose" IN ('sign_in', 'register', 'proof_register', 'proof_remove')),
    CONSTRAINT "account_passkey_challenges_binding_check"
        CHECK (
            ("purpose" = 'sign_in' AND "user_id" IS NULL AND "browser_session_id" IS NULL)
            OR ("purpose" <> 'sign_in' AND "user_id" IS NOT NULL AND "browser_session_id" IS NOT NULL)
        ),
    CONSTRAINT "account_passkey_challenges_expiry_check"
        CHECK ("expires_at" > "created_at")
);

CREATE INDEX "account_passkey_challenges_expires_at_idx"
    ON "account_passkey_challenges"("expires_at");
