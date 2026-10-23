-- Drop CONVERSATION_CONTROL_QUESTION_ANSWER from host_affecting_action_type.
-- A question answer is authorized as CONVERSATION_TRIGGER; the separate
-- operation changed the controller-device grant bundle and invalidated every
-- paired grant. Postgres does not support DROP VALUE, so we recreate the type.

-- Grants issued with the value covered a 13-operation descriptor hash and can
-- never be admitted again. Revoking is the only lifecycle change the
-- immutability trigger permits; the value itself is stripped by the column
-- type rewrite below, which does not fire row triggers.
UPDATE "execution_grants"
SET "revoked_at" = now()
WHERE "revoked_at" IS NULL
  AND 'CONVERSATION_CONTROL_QUESTION_ANSWER' = ANY ("allowed_actions");

DO $$
DECLARE
  referenced INTEGER;
BEGIN
  SELECT COUNT(*) INTO referenced
  FROM "execution_authorizations" a
  WHERE a."action_type" = 'CONVERSATION_CONTROL_QUESTION_ANSWER'
    AND (
      EXISTS (SELECT 1 FROM "execution_grants" g WHERE g."authorization_id" = a."authorization_id")
      OR EXISTS (SELECT 1 FROM "agent_operation_dispatches" d WHERE d."authorization_id" = a."authorization_id")
    );

  IF referenced > 0 THEN
    RAISE EXCEPTION
      'Cannot drop host_affecting_action_type value: % referenced execution authorization(s) use CONVERSATION_CONTROL_QUESTION_ANSWER.',
      referenced;
  END IF;
END
$$;

DELETE FROM "execution_authorizations"
WHERE "action_type" = 'CONVERSATION_CONTROL_QUESTION_ANSWER';

CREATE TYPE "host_affecting_action_type_new" AS ENUM (
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

ALTER TABLE "execution_authorizations"
  ALTER COLUMN "action_type" TYPE "host_affecting_action_type_new"
  USING "action_type"::text::"host_affecting_action_type_new";

-- The CHECK's NULL literal is bound to the old type, so it is re-created
-- unchanged around the column rewrite.
ALTER TABLE "execution_grants"
  DROP CONSTRAINT "execution_grants_allowed_actions_check";

ALTER TABLE "execution_grants"
  ALTER COLUMN "allowed_actions" TYPE "host_affecting_action_type_new"[]
  USING array_remove("allowed_actions"::text[], 'CONVERSATION_CONTROL_QUESTION_ANSWER')::"host_affecting_action_type_new"[];

ALTER TABLE "execution_grants"
  ADD CONSTRAINT "execution_grants_allowed_actions_check"
  CHECK (cardinality("allowed_actions") > 0 AND array_position("allowed_actions", NULL) IS NULL);

DROP TYPE "host_affecting_action_type";

ALTER TYPE "host_affecting_action_type_new" RENAME TO "host_affecting_action_type";
