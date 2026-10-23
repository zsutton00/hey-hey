-- Browser refresh continuity is represented as a bounded, revocable family
-- with immutable generation evidence. Only hashes of refresh secrets are
-- stored; the raw secret exists only in the browser's HttpOnly cookie.
CREATE TABLE "browser_session_families" (
    "id"                     TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id"                TEXT NOT NULL,
    "session_id"             TEXT NOT NULL,
    "family_id"              TEXT NOT NULL,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    "last_used_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "inactivity_expires_at"  TIMESTAMPTZ NOT NULL,
    "absolute_expires_at"    TIMESTAMPTZ NOT NULL,
    "revoked_at"             TIMESTAMPTZ,
    "revocation_reason"      VARCHAR(64),
    "created_ip_address"     VARCHAR(45),
    "created_user_agent"     VARCHAR(512),
    "last_used_ip_address"   VARCHAR(45),
    "last_used_user_agent"   VARCHAR(512),

    CONSTRAINT "browser_session_families_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "browser_session_families_session_id_key" UNIQUE ("session_id"),
    CONSTRAINT "browser_session_families_family_id_key" UNIQUE ("family_id"),
    CONSTRAINT "browser_session_families_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "browser_session_families_deadlines_check"
        CHECK (
            "last_used_at" >= "created_at"
            AND "inactivity_expires_at" > "created_at"
            AND "absolute_expires_at" > "created_at"
            AND "inactivity_expires_at" <= "absolute_expires_at"
        ),
    CONSTRAINT "browser_session_families_revocation_check"
        CHECK (
            ("revoked_at" IS NULL AND "revocation_reason" IS NULL)
            OR ("revoked_at" IS NOT NULL AND "revocation_reason" IS NOT NULL)
        )
);

CREATE INDEX "browser_session_families_user_id_revoked_at_idx"
    ON "browser_session_families"("user_id", "revoked_at");
CREATE INDEX "browser_session_families_inactivity_expires_at_idx"
    ON "browser_session_families"("inactivity_expires_at");
CREATE INDEX "browser_session_families_absolute_expires_at_idx"
    ON "browser_session_families"("absolute_expires_at");
CREATE INDEX "browser_session_families_revoked_at_idx"
    ON "browser_session_families"("revoked_at");

CREATE TABLE "refresh_generations" (
    "id"                         TEXT NOT NULL DEFAULT gen_random_uuid(),
    "browser_session_family_id"  TEXT NOT NULL,
    "generation"                 INTEGER NOT NULL,
    "secret_hash"                VARCHAR(128) NOT NULL,
    "issued_at"                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    "consumed_at"                TIMESTAMPTZ,

    CONSTRAINT "refresh_generations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "refresh_generations_secret_hash_key" UNIQUE ("secret_hash"),
    CONSTRAINT "refresh_generations_family_generation_key"
        UNIQUE ("browser_session_family_id", "generation"),
    CONSTRAINT "refresh_generations_browser_session_family_id_fkey"
        FOREIGN KEY ("browser_session_family_id")
        REFERENCES "browser_session_families"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "refresh_generations_generation_check"
        CHECK ("generation" >= 0),
    CONSTRAINT "refresh_generations_consumed_at_check"
        CHECK ("consumed_at" IS NULL OR "consumed_at" >= "issued_at")
);

CREATE INDEX "refresh_generations_family_consumed_at_idx"
    ON "refresh_generations"("browser_session_family_id", "consumed_at");
CREATE UNIQUE INDEX "refresh_generations_one_active_per_family_idx"
    ON "refresh_generations"("browser_session_family_id")
    WHERE "consumed_at" IS NULL;
CREATE INDEX "refresh_generations_issued_at_idx"
    ON "refresh_generations"("issued_at");
CREATE INDEX "refresh_generations_consumed_at_idx"
    ON "refresh_generations"("consumed_at");
