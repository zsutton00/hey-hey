-- Persist only canonical, non-secret controller intent and bounded follow-on
-- authority. Raw WebAuthn assertions, signatures, client/authenticator data,
-- executable payloads, credentials, and private material do not belong here.
CREATE TYPE "host_action_category" AS ENUM (
    'CONVERSATION',
    'PLATFORM_EVENT',
    'AUTHORITY_INCREASING_CONTROL',
    'TASK_MONITOR',
    'CLI_READ',
    'APPLICATION_EFFECT',
    'EXACT_ACTION'
);

CREATE TYPE "host_affecting_action_type" AS ENUM (
    'CONVERSATION_TRIGGER',
    'PLATFORM_EVENT_TRIGGER',
    'CONVERSATION_CONTROL_COMPACT_RUN',
    'CONVERSATION_CONTROL_PERMISSION_DECISION',
    'TASK_MONITOR_START',
    'TASK_MONITOR_RESUME',
    'TASK_MONITOR_JUDGMENT_RESOLVED',
    'TASK_MONITOR_CONTINUE',
    'TASK_MONITOR_COMPLETE',
    'CLI_READ',
    'APPLICATION_EFFECT_LAUNCH',
    'EXACT_ACTION_DELIVERY'
);

CREATE TYPE "host_action_target_kind" AS ENUM (
    'CONVERSATION',
    'AGENT_SESSION',
    'TASK_MONITOR',
    'PLATFORM_EVENT',
    'CLI_READ',
    'APPLICATION_EFFECT',
    'EXACT_ACTION'
);

CREATE TYPE "execution_authorization_outcome" AS ENUM (
    'ADMITTED',
    'DENIED'
);

CREATE TABLE "execution_authorizations" (
    "authorization_id"         TEXT NOT NULL DEFAULT gen_random_uuid(),
    "canonical_intent"         TEXT NOT NULL,
    "webauthn_challenge"       VARCHAR(43) NOT NULL,
    "controller_credential_id" TEXT NOT NULL,
    "machine_id"               TEXT NOT NULL,
    "user_id"                  TEXT NOT NULL,
    "organization_id"          TEXT NOT NULL,
    "project_id"               TEXT NOT NULL,
    "action_category"          "host_action_category" NOT NULL,
    "action_type"              "host_affecting_action_type" NOT NULL,
    "action_payload_hash"      VARCHAR(64) NOT NULL,
    "target_kind"              "host_action_target_kind" NOT NULL,
    "target_id"                TEXT NOT NULL,
    "target_revision"          BIGINT,
    "agent_session_id"         TEXT,
    "task_monitor_id"          TEXT,
    "task_monitor_revision"    BIGINT,
    "nonce"                    VARCHAR(43) NOT NULL,
    "issued_at"                TIMESTAMPTZ NOT NULL,
    "expires_at"               TIMESTAMPTZ NOT NULL,
    "consumed_at"              TIMESTAMPTZ,
    "outcome"                  "execution_authorization_outcome",
    "outcome_reason"           VARCHAR(64),
    "outcome_recorded_at"      TIMESTAMPTZ,
    "created_at"               TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "execution_authorizations_pkey"
        PRIMARY KEY ("authorization_id"),
    CONSTRAINT "execution_authorizations_webauthn_challenge_key"
        UNIQUE ("webauthn_challenge"),
    CONSTRAINT "execution_authorizations_nonce_key"
        UNIQUE ("nonce"),
    CONSTRAINT "execution_authorizations_controller_credential_id_fkey"
        FOREIGN KEY ("controller_credential_id")
        REFERENCES "machine_controller_credentials"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_authorizations_machine_id_fkey"
        FOREIGN KEY ("machine_id") REFERENCES "machines"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_authorizations_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_authorizations_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_authorizations_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_authorizations_agent_session_id_fkey"
        FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_authorizations_intent_check"
        CHECK (length("canonical_intent") > 0),
    CONSTRAINT "execution_authorizations_challenge_check"
        CHECK ("webauthn_challenge" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "execution_authorizations_payload_hash_check"
        CHECK ("action_payload_hash" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "execution_authorizations_nonce_check"
        CHECK ("nonce" ~ '^[A-Za-z0-9_-]{43}$'),
    CONSTRAINT "execution_authorizations_target_revision_check"
        CHECK ("target_revision" IS NULL OR "target_revision" >= 0),
    CONSTRAINT "execution_authorizations_monitor_revision_check"
        CHECK ("task_monitor_revision" IS NULL OR "task_monitor_revision" >= 0),
    CONSTRAINT "execution_authorizations_monitor_binding_check"
        CHECK (
            ("task_monitor_id" IS NULL AND "task_monitor_revision" IS NULL)
            OR ("task_monitor_id" IS NOT NULL AND "task_monitor_revision" IS NOT NULL)
        ),
    CONSTRAINT "execution_authorizations_lifetime_check"
        CHECK ("expires_at" = "issued_at" + INTERVAL '2 minutes'),
    CONSTRAINT "execution_authorizations_consumption_check"
        CHECK (
            "consumed_at" IS NULL
            OR ("consumed_at" >= "issued_at" AND "consumed_at" <= "expires_at")
        ),
    CONSTRAINT "execution_authorizations_outcome_check"
        CHECK (
            ("outcome" IS NULL AND "outcome_reason" IS NULL AND "outcome_recorded_at" IS NULL)
            OR (
                "outcome" IS NOT NULL
                AND "outcome_recorded_at" IS NOT NULL
                AND "outcome_recorded_at" >= "issued_at"
                AND ("outcome_reason" IS NULL OR "outcome_reason" ~ '^[A-Z0-9_]+$')
                AND ("outcome" <> 'ADMITTED' OR "consumed_at" IS NOT NULL)
            )
        )
);

CREATE INDEX "execution_authorizations_expiry_consumption_idx"
    ON "execution_authorizations" ("expires_at", "consumed_at");
CREATE INDEX "execution_authorizations_machine_expiry_idx"
    ON "execution_authorizations" ("machine_id", "expires_at");
CREATE INDEX "execution_authorizations_controller_expiry_idx"
    ON "execution_authorizations" ("controller_credential_id", "expires_at");
CREATE INDEX "execution_authorizations_scope_expiry_idx"
    ON "execution_authorizations" ("organization_id", "project_id", "expires_at");

-- The prepared intent is immutable, and consumption is a one-way transition.
-- Atomic consumers still use `consumed_at IS NULL`, while this trigger makes a
-- previously consumed row impossible to reopen or consume at a second time.
CREATE FUNCTION "enforce_execution_authorization_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."authorization_id",
        NEW."canonical_intent",
        NEW."webauthn_challenge",
        NEW."controller_credential_id",
        NEW."machine_id",
        NEW."user_id",
        NEW."organization_id",
        NEW."project_id",
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
        OLD."canonical_intent",
        OLD."webauthn_challenge",
        OLD."controller_credential_id",
        OLD."machine_id",
        OLD."user_id",
        OLD."organization_id",
        OLD."project_id",
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

CREATE TRIGGER "execution_authorizations_immutability_trigger"
BEFORE UPDATE ON "execution_authorizations"
FOR EACH ROW
EXECUTE FUNCTION "enforce_execution_authorization_immutability"();

CREATE TABLE "execution_grants" (
    "id"                        TEXT NOT NULL DEFAULT gen_random_uuid(),
    "authorization_id"          TEXT NOT NULL,
    "controller_credential_id"  TEXT NOT NULL,
    "machine_id"                TEXT NOT NULL,
    "user_id"                   TEXT NOT NULL,
    "organization_id"           TEXT NOT NULL,
    "project_id"                TEXT NOT NULL,
    "target_kind"               "host_action_target_kind" NOT NULL,
    "target_id"                 TEXT NOT NULL,
    "allowed_actions"           "host_affecting_action_type"[] NOT NULL,
    "agent_session_id"          TEXT,
    "authorized_turn_id"        TEXT,
    "task_monitor_id"           TEXT,
    "selected_work_fingerprint" VARCHAR(64),
    "policy_fingerprint"        VARCHAR(64),
    "monitor_revision"          BIGINT,
    "issued_at"                 TIMESTAMPTZ NOT NULL,
    "expires_at"                TIMESTAMPTZ NOT NULL,
    "suspended_at"              TIMESTAMPTZ,
    "terminal_at"               TIMESTAMPTZ,
    "revoked_at"                TIMESTAMPTZ,
    "created_at"                TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "execution_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "execution_grants_authorization_id_key" UNIQUE ("authorization_id"),
    CONSTRAINT "execution_grants_authorization_id_fkey"
        FOREIGN KEY ("authorization_id")
        REFERENCES "execution_authorizations"("authorization_id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_controller_credential_id_fkey"
        FOREIGN KEY ("controller_credential_id")
        REFERENCES "machine_controller_credentials"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_machine_id_fkey"
        FOREIGN KEY ("machine_id") REFERENCES "machines"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_agent_session_id_fkey"
        FOREIGN KEY ("agent_session_id") REFERENCES "agent_sessions"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_authorized_turn_id_fkey"
        FOREIGN KEY ("authorized_turn_id") REFERENCES "messages"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_task_monitor_id_fkey"
        FOREIGN KEY ("task_monitor_id") REFERENCES "tasks"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "execution_grants_allowed_actions_check"
        CHECK (cardinality("allowed_actions") > 0 AND array_position("allowed_actions", NULL) IS NULL),
    CONSTRAINT "execution_grants_scope_arm_check"
        CHECK (
            (
                "agent_session_id" IS NOT NULL
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
                "agent_session_id" IS NULL
                AND "authorized_turn_id" IS NULL
                AND "task_monitor_id" IS NOT NULL
                AND "selected_work_fingerprint" IS NOT NULL
                AND "policy_fingerprint" IS NOT NULL
                AND "monitor_revision" IS NOT NULL
                AND "target_kind" = 'TASK_MONITOR'
                AND "target_id" = "task_monitor_id"
            )
        ),
    CONSTRAINT "execution_grants_selected_work_fingerprint_check"
        CHECK (
            "selected_work_fingerprint" IS NULL
            OR "selected_work_fingerprint" ~ '^[0-9a-f]{64}$'
        ),
    CONSTRAINT "execution_grants_policy_fingerprint_check"
        CHECK (
            "policy_fingerprint" IS NULL
            OR "policy_fingerprint" ~ '^[0-9a-f]{64}$'
        ),
    CONSTRAINT "execution_grants_monitor_revision_check"
        CHECK ("monitor_revision" IS NULL OR "monitor_revision" >= 0),
    CONSTRAINT "execution_grants_lifetime_check"
        CHECK ("expires_at" > "issued_at"),
    CONSTRAINT "execution_grants_lifecycle_check"
        CHECK (
            ("suspended_at" IS NULL OR "suspended_at" >= "issued_at")
            AND ("terminal_at" IS NULL OR "terminal_at" >= "issued_at")
            AND ("revoked_at" IS NULL OR "revoked_at" >= "issued_at")
        )
);

CREATE INDEX "execution_grants_expires_at_idx"
    ON "execution_grants" ("expires_at");
CREATE INDEX "execution_grants_machine_active_expiry_idx"
    ON "execution_grants" (
        "machine_id", "suspended_at", "terminal_at", "revoked_at", "expires_at"
    );
CREATE INDEX "execution_grants_controller_active_expiry_idx"
    ON "execution_grants" (
        "controller_credential_id", "suspended_at", "terminal_at", "revoked_at", "expires_at"
    );
CREATE INDEX "execution_grants_target_active_expiry_idx"
    ON "execution_grants" (
        "target_kind", "target_id", "suspended_at", "terminal_at", "revoked_at", "expires_at"
    );
CREATE INDEX "execution_grants_scope_expiry_idx"
    ON "execution_grants" ("organization_id", "project_id", "expires_at");

-- Grant scope never widens in place. Suspension, terminal state, and
-- revocation are one-way authority reductions; resume derives a fresh grant.
CREATE FUNCTION "enforce_execution_grant_immutability"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."id",
        NEW."authorization_id",
        NEW."controller_credential_id",
        NEW."machine_id",
        NEW."user_id",
        NEW."organization_id",
        NEW."project_id",
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
        OLD."controller_credential_id",
        OLD."machine_id",
        OLD."user_id",
        OLD."organization_id",
        OLD."project_id",
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

CREATE TRIGGER "execution_grants_immutability_trigger"
BEFORE UPDATE ON "execution_grants"
FOR EACH ROW
EXECUTE FUNCTION "enforce_execution_grant_immutability"();

-- A grant is derivable only after successful single-use consumption, and its
-- durable ownership bindings must be identical to the creating authorization.
CREATE FUNCTION "enforce_execution_grant_authorization_binding"()
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

    IF NEW."issued_at" < creating_authorization."consumed_at"
       OR NEW."controller_credential_id" <> creating_authorization."controller_credential_id"
       OR NEW."machine_id" <> creating_authorization."machine_id"
       OR NEW."user_id" <> creating_authorization."user_id"
       OR NEW."organization_id" <> creating_authorization."organization_id"
       OR NEW."project_id" <> creating_authorization."project_id" THEN
        RAISE EXCEPTION 'execution grant widens its creating authorization binding'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "execution_grants_authorization_binding_trigger"
BEFORE INSERT OR UPDATE OF
    "authorization_id",
    "controller_credential_id",
    "machine_id",
    "user_id",
    "organization_id",
    "project_id",
    "issued_at"
ON "execution_grants"
FOR EACH ROW
EXECUTE FUNCTION "enforce_execution_grant_authorization_binding"();
