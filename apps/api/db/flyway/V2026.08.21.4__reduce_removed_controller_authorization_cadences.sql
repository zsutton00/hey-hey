-- Removed browser-session authority must stop being usable before the active
-- cadence constraint is narrowed. Historical rows remain readable only after
-- they have been durably revoked.
UPDATE "execution_grants"
SET "revoked_at" = COALESCE("revoked_at", CURRENT_TIMESTAMP)
WHERE "scope" = 'controller_device_window'
  AND "cadence" IN ('EVERY_ACTION', 'CURRENT_BROWSER_SESSION');

ALTER TABLE "execution_grants"
    DROP CONSTRAINT "execution_grants_controller_device_window_expiry_check";

ALTER TABLE "execution_grants"
    ADD CONSTRAINT "execution_grants_controller_device_window_expiry_check"
        CHECK (
            "scope" <> 'controller_device_window'
            OR "revoked_at" IS NOT NULL
            OR (
                ("cadence" = 'FIVE_MINUTES'
                    AND "expires_at" = "issued_at" + INTERVAL '5 minutes')
                OR ("cadence" = 'EIGHT_HOURS'
                    AND "expires_at" = "issued_at" + INTERVAL '8 hours')
                OR ("cadence" = 'ONE_DAY'
                    AND "expires_at" = "issued_at" + INTERVAL '1 day')
                OR ("cadence" = 'ONE_WEEK'
                    AND "expires_at" = "issued_at" + INTERVAL '7 days')
                OR ("cadence" = 'ONE_MONTH'
                    AND "expires_at" = "issued_at" + INTERVAL '30 days')
            )
        );
