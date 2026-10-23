-- One durable Open Items triage Agent Session per user and project.
CREATE TABLE "open_items_triage_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "agent_session_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_items_triage_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "open_items_triage_sessions_agent_session_id_key"
        UNIQUE ("agent_session_id"),
    CONSTRAINT "open_items_triage_sessions_identity_key"
        UNIQUE ("organization_id", "project_id", "user_id"),
    CONSTRAINT "open_items_triage_sessions_agent_session_id_fkey"
        FOREIGN KEY ("agent_session_id")
        REFERENCES "agent_sessions"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "open_items_triage_sessions_organization_id_fkey"
        FOREIGN KEY ("organization_id")
        REFERENCES "organizations"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "open_items_triage_sessions_project_id_fkey"
        FOREIGN KEY ("project_id")
        REFERENCES "projects"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE,
    CONSTRAINT "open_items_triage_sessions_user_id_fkey"
        FOREIGN KEY ("user_id")
        REFERENCES "users"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);
