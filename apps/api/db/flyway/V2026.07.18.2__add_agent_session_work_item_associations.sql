CREATE TABLE "agent_session_work_item_associations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "coordinator_type" "AgentSessionType" NOT NULL,
    "work_item_type" TEXT NOT NULL,
    "work_item_id" TEXT NOT NULL,
    "agent_session_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_session_work_item_associations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "agent_session_work_item_associations_agent_session_id_key"
        UNIQUE ("agent_session_id"),
    CONSTRAINT "agent_session_work_item_associations_identity_key"
        UNIQUE (
            "organization_id",
            "project_id",
            "coordinator_type",
            "work_item_type",
            "work_item_id"
        ),
    CONSTRAINT "agent_session_work_item_associations_agent_session_id_fkey"
        FOREIGN KEY ("agent_session_id")
        REFERENCES "agent_sessions"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "agent_session_work_item_associations_organization_id_fkey"
        FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "agent_session_work_item_associations_project_id_fkey"
        FOREIGN KEY ("project_id")
        REFERENCES "projects"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "agent_session_work_item_associations_work_item_id_fkey"
        FOREIGN KEY ("work_item_id")
        REFERENCES "tasks"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

CREATE INDEX "agent_session_work_item_associations_work_item_idx"
    ON "agent_session_work_item_associations"(
        "organization_id",
        "project_id",
        "work_item_id"
    );
