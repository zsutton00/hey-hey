-- Password-change JWTs carry only this durable identifier. The signed token
-- and any raw credential material are never persisted.
CREATE TABLE "password_change_credentials" (
    "id"                    TEXT NOT NULL DEFAULT gen_random_uuid(),
    "credential_id"         VARCHAR(128) NOT NULL,
    "user_id"               TEXT NOT NULL,
    "issued_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "expires_at"            TIMESTAMPTZ NOT NULL,
    "consumed_at"           TIMESTAMPTZ,
    "issued_ip_address"     VARCHAR(45),
    "issued_user_agent"     VARCHAR(512),
    "consumed_ip_address"   VARCHAR(45),
    "consumed_user_agent"   VARCHAR(512),

    CONSTRAINT "password_change_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "password_change_credentials_credential_id_key"
        UNIQUE ("credential_id"),
    CONSTRAINT "password_change_credentials_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "password_change_credentials_expiry_check"
        CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "password_change_credentials_consumed_at_check"
        CHECK ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
);

CREATE INDEX "password_change_credentials_user_consumed_expiry_idx"
    ON "password_change_credentials"("user_id", "consumed_at", "expires_at");
CREATE INDEX "password_change_credentials_expires_at_idx"
    ON "password_change_credentials"("expires_at");
CREATE INDEX "password_change_credentials_consumed_at_idx"
    ON "password_change_credentials"("consumed_at");
