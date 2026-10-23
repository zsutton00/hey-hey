ALTER TABLE "execution_authorizations"
    ADD COLUMN "request_id" UUID;

UPDATE "execution_authorizations"
SET "request_id" = "authorization_id"::UUID
WHERE "request_id" IS NULL;

ALTER TABLE "execution_authorizations"
    ALTER COLUMN "request_id" SET NOT NULL;

CREATE INDEX "execution_authorizations_user_request_idx"
    ON "execution_authorizations" ("user_id", "request_id");

ALTER TABLE "monitor_commands"
    ADD COLUMN "authorization_id" UUID;
