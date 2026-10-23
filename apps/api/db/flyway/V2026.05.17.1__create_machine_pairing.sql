CREATE TABLE "machines" (
    "id"          TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id"     TEXT NOT NULL,
    "name"        TEXT NOT NULL,
    "public_key"  TEXT NOT NULL,
    "token_hash"  TEXT NOT NULL,
    "paired_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen"   TIMESTAMP(3),
    "revoked_at"  TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "machines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "machines_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "machines_token_hash_key" UNIQUE ("token_hash")
);

CREATE INDEX "machines_user_id_idx" ON "machines"("user_id");
CREATE INDEX "machines_token_hash_idx" ON "machines"("token_hash");

CREATE TABLE "pairing_codes" (
    "id"          TEXT NOT NULL DEFAULT gen_random_uuid(),
    "code"        TEXT NOT NULL,
    "user_id"     TEXT NOT NULL,
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pairing_codes_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "pairing_codes_code_key" UNIQUE ("code")
);

CREATE INDEX "pairing_codes_user_id_idx" ON "pairing_codes"("user_id");
CREATE INDEX "pairing_codes_expires_at_idx" ON "pairing_codes"("expires_at");

CREATE TABLE "pairing_attempts" (
    "id"           TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id"      TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded"    BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT "pairing_attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pairing_attempts_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "pairing_attempts_user_id_attempted_at_idx" ON "pairing_attempts"("user_id", "attempted_at");
