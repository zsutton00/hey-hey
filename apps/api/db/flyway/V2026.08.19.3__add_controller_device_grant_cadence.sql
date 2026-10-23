-- Extend the exact-action authorization rows with the browser-installation
-- identity and the server-owned reusable-grant descriptor. Existing rows are
-- intentionally not assigned synthetic authority: if this migration finds
-- pre-existing authorization rows, it fails and requires an explicit drain or
-- backfill plan.
CREATE TYPE "controller_authorization_cadence" AS ENUM (
    'EVERY_ACTION',
    'CURRENT_BROWSER_SESSION',
    'EIGHT_HOURS',
    'ONE_DAY',
    'ONE_WEEK',
    'ONE_MONTH'
);

CREATE TYPE "execution_grant_scope" AS ENUM (
    'interactive_turn',
    'task_monitor',
    'controller_device_window'
);

ALTER TABLE "execution_authorizations"
    ADD COLUMN "controller_installation_id" UUID,
    ADD COLUMN "cadence" "controller_authorization_cadence",
    ADD COLUMN "policy_revision" INTEGER,
    ADD COLUMN "grant_descriptor_hash" VARCHAR(64);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "execution_authorizations"
        WHERE "controller_installation_id" IS NULL
           OR "cadence" IS NULL
           OR "policy_revision" IS NULL
           OR "grant_descriptor_hash" IS NULL
    ) THEN
        RAISE EXCEPTION
            'execution authorizations exist without controller-device descriptor state; explicit backfill required';
    END IF;
END;
$$;

ALTER TABLE "execution_authorizations"
    ALTER COLUMN "controller_installation_id" SET NOT NULL,
    ALTER COLUMN "cadence" SET NOT NULL,
    ALTER COLUMN "policy_revision" SET NOT NULL,
    ALTER COLUMN "grant_descriptor_hash" SET NOT NULL;

ALTER TABLE "execution_authorizations"
    ADD CONSTRAINT "execution_authorizations_policy_revision_check"
        CHECK ("policy_revision" > 0),
    ADD CONSTRAINT "execution_authorizations_grant_descriptor_hash_check"
        CHECK ("grant_descriptor_hash" ~ '^[0-9a-f]{64}$');

CREATE INDEX "execution_authorizations_controller_installation_expiry_idx"
    ON "execution_authorizations" (
        "controller_installation_id", "expires_at", "consumed_at"
    );

ALTER TABLE "execution_grants"
    ADD COLUMN "scope" "execution_grant_scope",
    ADD COLUMN "controller_installation_id" UUID,
    ADD COLUMN "cadence" "controller_authorization_cadence",
    ADD COLUMN "policy_revision" INTEGER,
    ADD COLUMN "grant_descriptor_hash" VARCHAR(64);

UPDATE "execution_grants" AS g
SET
    "scope" = CASE
        WHEN g."task_monitor_id" IS NOT NULL THEN 'task_monitor'::"execution_grant_scope"
        ELSE 'interactive_turn'::"execution_grant_scope"
    END,
    "controller_installation_id" = a."controller_installation_id",
    "cadence" = a."cadence",
    "policy_revision" = a."policy_revision",
    "grant_descriptor_hash" = a."grant_descriptor_hash"
FROM "execution_authorizations" AS a
WHERE a."authorization_id" = g."authorization_id";

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "execution_grants"
        WHERE "scope" IS NULL
           OR "controller_installation_id" IS NULL
           OR "cadence" IS NULL
           OR "policy_revision" IS NULL
           OR "grant_descriptor_hash" IS NULL
    ) THEN
        RAISE EXCEPTION
            'execution grants exist without controller-device descriptor state; explicit backfill required';
    END IF;
END;
$$;

ALTER TABLE "execution_grants"
    ALTER COLUMN "scope" SET NOT NULL,
    ALTER COLUMN "controller_installation_id" SET NOT NULL,
    ALTER COLUMN "cadence" SET NOT NULL,
    ALTER COLUMN "policy_revision" SET NOT NULL,
    ALTER COLUMN "grant_descriptor_hash" SET NOT NULL;

ALTER TABLE "execution_grants"
    ADD CONSTRAINT "execution_grants_policy_revision_check"
        CHECK ("policy_revision" > 0),
    ADD CONSTRAINT "execution_grants_grant_descriptor_hash_check"
        CHECK ("grant_descriptor_hash" ~ '^[0-9a-f]{64}$'),
    ADD CONSTRAINT "execution_grants_controller_device_window_expiry_check"
        CHECK (
            "scope" <> 'controller_device_window'
            OR (
                ("cadence" = 'CURRENT_BROWSER_SESSION'
                    AND "expires_at" = "issued_at" + INTERVAL '30 days')
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

ALTER TABLE "execution_grants"
    DROP CONSTRAINT "execution_grants_scope_arm_check";

ALTER TABLE "execution_grants"
    ADD CONSTRAINT "execution_grants_scope_arm_check"
        CHECK (
            (
                "scope" = 'interactive_turn'
                AND "agent_session_id" IS NOT NULL
                AND "authorized_turn_id" IS NOT NULL
                AND "task_monitor_id" IS NULL
                AND "selected_work_fingerprint" IS NULL
                AND "policy_fingerprint" IS NULL
                AND "monitor_revision" IS NULL
                AND "target_kind" = 'AGENT_SESSION'
                AND "target_id" = "agent_session_id"
            )
            OR
            (
                "scope" = 'task_monitor'
                AND "agent_session_id" IS NULL
                AND "authorized_turn_id" IS NULL
                AND "task_monitor_id" IS NOT NULL
                AND "selected_work_fingerprint" IS NOT NULL
                AND "policy_fingerprint" IS NOT NULL
                AND "monitor_revision" IS NOT NULL
                AND "target_kind" = 'TASK_MONITOR'
                AND "target_id" = "task_monitor_id"
            )
            OR
            (
                "scope" = 'controller_device_window'
                AND "agent_session_id" IS NULL
                AND "authorized_turn_id" IS NULL
                AND "task_monitor_id" IS NULL
                AND "selected_work_fingerprint" IS NULL
                AND "policy_fingerprint" IS NULL
                AND "monitor_revision" IS NULL
            )
        );

CREATE INDEX "execution_grants_controller_installation_active_expiry_idx"
    ON "execution_grants" (
        "controller_installation_id", "scope", "suspended_at",
        "terminal_at", "revoked_at", "expires_at"
    );

CREATE OR REPLACE FUNCTION "enforce_execution_authorization_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."authorization_id",
        NEW."request_id",
        NEW."canonical_intent",
        NEW."webauthn_challenge",
        NEW."controller_credential_id",
        NEW."controller_installation_id",
        NEW."machine_id",
        NEW."user_id",
        NEW."organization_id",
        NEW."project_id",
        NEW."cadence",
        NEW."policy_revision",
        NEW."grant_descriptor_hash",
        NEW."action_category",
        NEW."action_type",
        NEW."action_payload_hash",
        NEW."target_kind",
        NEW."target_id",
        NEW."target_revision",
        NEW."agent_session_id",
        NEW."task_monitor_id",
        NEW."task_monitor_revision",
        NEW."nonce",
        NEW."issued_at",
        NEW."expires_at",
        NEW."created_at"
    ) IS DISTINCT FROM ROW(
        OLD."authorization_id",
        OLD."request_id",
        OLD."canonical_intent",
        OLD."webauthn_challenge",
        OLD."controller_credential_id",
        OLD."controller_installation_id",
        OLD."machine_id",
        OLD."user_id",
        OLD."organization_id",
        OLD."project_id",
        OLD."cadence",
        OLD."policy_revision",
        OLD."grant_descriptor_hash",
        OLD."action_category",
        OLD."action_type",
        OLD."action_payload_hash",
        OLD."target_kind",
        OLD."target_id",
        OLD."target_revision",
        OLD."agent_session_id",
        OLD."task_monitor_id",
        OLD."task_monitor_revision",
        OLD."nonce",
        OLD."issued_at",
        OLD."expires_at",
        OLD."created_at"
    ) THEN
        RAISE EXCEPTION 'execution authorization intent is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."consumed_at" IS NOT NULL
       AND NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at" THEN
        RAISE EXCEPTION 'consumed execution authorization cannot be reused'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_execution_grant_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."id",
        NEW."authorization_id",
        NEW."scope",
        NEW."controller_credential_id",
        NEW."controller_installation_id",
        NEW."machine_id",
        NEW."user_id",
        NEW."organization_id",
        NEW."project_id",
        NEW."cadence",
        NEW."policy_revision",
        NEW."grant_descriptor_hash",
        NEW."target_kind",
        NEW."target_id",
        NEW."allowed_actions",
        NEW."agent_session_id",
        NEW."authorized_turn_id",
        NEW."task_monitor_id",
        NEW."selected_work_fingerprint",
        NEW."policy_fingerprint",
        NEW."monitor_revision",
        NEW."issued_at",
        NEW."expires_at",
        NEW."created_at"
    ) IS DISTINCT FROM ROW(
        OLD."id",
        OLD."authorization_id",
        OLD."scope",
        OLD."controller_credential_id",
        OLD."controller_installation_id",
        OLD."machine_id",
        OLD."user_id",
        OLD."organization_id",
        OLD."project_id",
        OLD."cadence",
        OLD."policy_revision",
        OLD."grant_descriptor_hash",
        OLD."target_kind",
        OLD."target_id",
        OLD."allowed_actions",
        OLD."agent_session_id",
        OLD."authorized_turn_id",
        OLD."task_monitor_id",
        OLD."selected_work_fingerprint",
        OLD."policy_fingerprint",
        OLD."monitor_revision",
        OLD."issued_at",
        OLD."expires_at",
        OLD."created_at"
    ) THEN
        RAISE EXCEPTION 'execution grant scope is immutable'
            USING ERRCODE = '23514';
    END IF;

    IF (OLD."suspended_at" IS NOT NULL AND NEW."suspended_at" IS DISTINCT FROM OLD."suspended_at")
       OR (OLD."terminal_at" IS NOT NULL AND NEW."terminal_at" IS DISTINCT FROM OLD."terminal_at")
       OR (OLD."revoked_at" IS NOT NULL AND NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at") THEN
        RAISE EXCEPTION 'execution grant lifecycle reductions are irreversible'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "enforce_execution_grant_authorization_binding"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    creating_authorization "execution_authorizations"%ROWTYPE;
BEGIN
    SELECT *
      INTO creating_authorization
      FROM "execution_authorizations"
     WHERE "authorization_id" = NEW."authorization_id"
     FOR KEY SHARE;

    IF NOT FOUND OR creating_authorization."consumed_at" IS NULL THEN
        RAISE EXCEPTION 'execution grant requires a consumed authorization'
            USING ERRCODE = '23514';
    END IF;

    -- Reusable-window lifetime is anchored at preparation so the two-minute
    -- assertion window cannot be extended by assertion timing. The consumed
    -- authorization check above still makes this an admitted one-shot derivation.
    IF (
           NEW."scope" <> 'controller_device_window'
           AND NEW."issued_at" < creating_authorization."consumed_at"
       )
       OR NEW."controller_credential_id" <> creating_authorization."controller_credential_id"
       OR NEW."controller_installation_id" <> creating_authorization."controller_installation_id"
       OR NEW."machine_id" <> creating_authorization."machine_id"
       OR NEW."user_id" <> creating_authorization."user_id"
       OR NEW."organization_id" <> creating_authorization."organization_id"
       OR NEW."project_id" <> creating_authorization."project_id"
       OR NEW."cadence" <> creating_authorization."cadence"
       OR NEW."policy_revision" <> creating_authorization."policy_revision"
       OR NEW."grant_descriptor_hash" <> creating_authorization."grant_descriptor_hash"
       OR (
           NEW."scope" = 'controller_device_window'
           AND (
               creating_authorization."cadence" = 'EVERY_ACTION'
               OR NEW."target_kind" <> creating_authorization."target_kind"
               OR NEW."target_id" <> creating_authorization."target_id"
           )
       ) THEN
        RAISE EXCEPTION 'execution grant widens its creating authorization binding'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER "execution_grants_authorization_binding_trigger"
    ON "execution_grants";

CREATE TRIGGER "execution_grants_authorization_binding_trigger"
BEFORE INSERT OR UPDATE OF
    "authorization_id",
    "scope",
    "controller_credential_id",
    "controller_installation_id",
    "machine_id",
    "user_id",
    "organization_id",
    "project_id",
    "cadence",
    "policy_revision",
    "grant_descriptor_hash",
    "issued_at"
ON "execution_grants"
FOR EACH ROW
EXECUTE FUNCTION "enforce_execution_grant_authorization_binding"();
