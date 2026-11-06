-- An UNTIL_REVOKED controller-device grant has no expiry and stays valid until
-- it is revoked. Every other grant keeps its fixed expiry, and a bounded
-- cadence can no longer be stored without one.
ALTER TABLE "execution_grants"
    ALTER COLUMN "expires_at" DROP NOT NULL;

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
                OR ("cadence" = 'UNTIL_REVOKED'
                    AND "expires_at" IS NULL)
            )
        );

-- Only a controller-device window may omit its expiry.
ALTER TABLE "execution_grants"
    ADD CONSTRAINT "execution_grants_expiry_required_check"
        CHECK ("scope" = 'controller_device_window' OR "expires_at" IS NOT NULL);
