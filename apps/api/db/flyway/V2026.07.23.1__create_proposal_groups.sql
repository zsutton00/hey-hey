CREATE TYPE "proposal_group_status" AS ENUM (
    'BUILDING',
    'REVIEWABLE',
    'SETTLED'
);

CREATE TYPE "proposal_group_member_execution_state" AS ENUM (
    'PENDING_APPROVAL',
    'WAITING_ON_DEPENDENCIES',
    'READY',
    'APPLYING',
    'RETRYABLE_FAILURE',
    'APPLIED',
    'REJECTED',
    'INVALIDATED',
    'FAILED'
);

CREATE TABLE "proposal_groups" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "status" "proposal_group_status" NOT NULL DEFAULT 'BUILDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "frozen_revision" INTEGER,
    "frozen_at" TIMESTAMPTZ,
    "settled_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "proposal_groups_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_groups_organization_id_fkey"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_groups_project_id_fkey"
        FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_groups_conversation_id_fkey"
        FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "proposal_groups_message_id_fkey"
        FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "proposal_groups_revision_positive_check" CHECK ("revision" > 0),
    CONSTRAINT "proposal_groups_frozen_revision_check"
        CHECK ("frozen_revision" IS NULL OR "frozen_revision" > 0),
    CONSTRAINT "proposal_groups_settled_status_check"
        CHECK (("status" = 'SETTLED') = ("settled_at" IS NOT NULL))
);

CREATE INDEX "proposal_groups_organization_id_project_id_status_idx"
    ON "proposal_groups"("organization_id", "project_id", "status");
CREATE INDEX "proposal_groups_conversation_id_idx"
    ON "proposal_groups"("conversation_id");
CREATE INDEX "proposal_groups_message_id_idx"
    ON "proposal_groups"("message_id");

CREATE TABLE "proposal_group_members" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "group_id" TEXT NOT NULL,
    "proposal_id" TEXT NOT NULL,
    "member_order" INTEGER NOT NULL,
    "reserved_target_entity_id" TEXT,
    "required_approvals" INTEGER,
    "approval_policy_revision" TEXT,
    "approval_satisfied_at" TIMESTAMPTZ,
    "execution_state" "proposal_group_member_execution_state" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "attempt_id" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "last_attempted_at" TIMESTAMPTZ,
    "applied_at" TIMESTAMPTZ,
    "rejected_at" TIMESTAMPTZ,
    "invalidated_at" TIMESTAMPTZ,
    "failed_at" TIMESTAMPTZ,
    "last_error" TEXT,
    "terminal_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "proposal_group_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_group_members_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "proposal_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_group_members_proposal_id_fkey"
        FOREIGN KEY ("proposal_id") REFERENCES "proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "proposal_group_members_member_order_check" CHECK ("member_order" >= 0),
    CONSTRAINT "proposal_group_members_required_approvals_check"
        CHECK ("required_approvals" IS NULL OR "required_approvals" >= 0),
    CONSTRAINT "proposal_group_members_attempt_count_check" CHECK ("attempt_count" >= 0),
    CONSTRAINT "proposal_group_members_proposal_id_key" UNIQUE ("proposal_id"),
    CONSTRAINT "proposal_group_members_reserved_target_entity_id_key"
        UNIQUE ("reserved_target_entity_id"),
    CONSTRAINT "proposal_group_members_group_id_member_order_key"
        UNIQUE ("group_id", "member_order"),
    CONSTRAINT "proposal_group_members_group_id_id_key"
        UNIQUE ("group_id", "id")
);

CREATE INDEX "proposal_group_members_group_id_execution_state_idx"
    ON "proposal_group_members"("group_id", "execution_state");
CREATE INDEX "proposal_group_members_group_id_member_order_idx"
    ON "proposal_group_members"("group_id", "member_order");

CREATE TABLE "proposal_group_dependencies" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "group_id" TEXT NOT NULL,
    "dependent_member_id" TEXT NOT NULL,
    "prerequisite_member_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "proposal_group_dependencies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "proposal_group_dependencies_group_id_fkey"
        FOREIGN KEY ("group_id") REFERENCES "proposal_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_group_dependencies_dependent_member_fkey"
        FOREIGN KEY ("group_id", "dependent_member_id")
        REFERENCES "proposal_group_members"("group_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_group_dependencies_prerequisite_member_fkey"
        FOREIGN KEY ("group_id", "prerequisite_member_id")
        REFERENCES "proposal_group_members"("group_id", "id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "proposal_group_dependencies_distinct_members_check"
        CHECK ("dependent_member_id" <> "prerequisite_member_id"),
    CONSTRAINT "proposal_group_dependencies_identity_key"
        UNIQUE ("group_id", "dependent_member_id", "prerequisite_member_id")
);

CREATE INDEX "proposal_group_dependencies_group_id_prerequisite_member_id_idx"
    ON "proposal_group_dependencies"("group_id", "prerequisite_member_id");
