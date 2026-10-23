-- Irreversible post-window cutover for the original pairing protocol.
--
-- pairing_codes is the version-1 code store. Retain every row and its owner,
-- machine link, and timestamps, but consume every code that could otherwise
-- still be redeemed, including codes whose expiry window has already elapsed.
-- Existing machines predate the explicit protocol column, so NULL is the
-- legacy value and is normalized to version 1 before the state transition.
DO $migration$
BEGIN
    UPDATE "pairing_codes"
    SET "consumed_at" = CURRENT_TIMESTAMP
    WHERE "consumed_at" IS NULL;

    UPDATE "machines"
    SET "authorization_protocol_version" = 1
    WHERE "authorization_protocol_version" IS NULL;

    UPDATE "machines"
    SET "authorization_state" = 'CONTROLLER_ENROLLMENT_REQUIRED'
    WHERE "revoked_at" IS NULL
      AND "authorization_protocol_version" = 1
      AND "authorization_state" <> 'CONTROLLER_ENROLLMENT_REQUIRED';
END
$migration$;
