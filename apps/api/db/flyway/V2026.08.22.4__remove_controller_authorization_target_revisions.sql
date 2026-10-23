-- Controller-authorized machine commands bind the exact action and durable
-- machine target. The machine evaluates Task Monitor commands against its
-- own current snapshot and internal revision; caller-supplied target
-- revisions are not part of this authorization contract.

DROP TRIGGER IF EXISTS "execution_authorizations_immutability_trigger"
    ON "execution_authorizations";
DROP FUNCTION IF EXISTS "enforce_execution_authorization_immutability"();

DROP TRIGGER IF EXISTS "execution_grants_immutability_trigger"
    ON "execution_grants";
DROP FUNCTION IF EXISTS "enforce_execution_grant_immutability"();

ALTER TABLE "execution_authorizations"
    DROP CONSTRAINT IF EXISTS "execution_authorizations_target_revision_check",
    DROP CONSTRAINT IF EXISTS "execution_authorizations_monitor_revision_check",
    DROP CONSTRAINT IF EXISTS "execution_authorizations_monitor_binding_check",
    DROP COLUMN IF EXISTS "target_revision",
    DROP COLUMN IF EXISTS "task_monitor_revision";

ALTER TABLE "execution_grants"
    DROP CONSTRAINT IF EXISTS "execution_grants_scope_arm_check",
    DROP CONSTRAINT IF EXISTS "execution_grants_monitor_revision_check",
    DROP COLUMN IF EXISTS "monitor_revision";

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
            )
        );

CREATE FUNCTION "enforce_execution_authorization_immutability"()
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
        NEW."agent_session_id",
        NEW."task_monitor_id",
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
        OLD."agent_session_id",
        OLD."task_monitor_id",
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

CREATE TRIGGER "execution_authorizations_immutability_trigger"
BEFORE UPDATE ON "execution_authorizations"
FOR EACH ROW
EXECUTE FUNCTION "enforce_execution_authorization_immutability"();

CREATE FUNCTION "enforce_execution_grant_immutability"()
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

CREATE TRIGGER "execution_grants_immutability_trigger"
BEFORE UPDATE ON "execution_grants"
FOR EACH ROW
EXECUTE FUNCTION "enforce_execution_grant_immutability"();
