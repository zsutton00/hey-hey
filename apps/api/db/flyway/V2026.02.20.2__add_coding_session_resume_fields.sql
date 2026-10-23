ALTER TABLE "coding_sessions"
ADD COLUMN "service_id" TEXT,
ADD COLUMN "provider" TEXT,
ADD COLUMN "agent_session_id" TEXT;

ALTER TABLE "coding_sessions"
ADD CONSTRAINT "coding_sessions_service_id_fkey"
FOREIGN KEY ("service_id") REFERENCES "services"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

CREATE INDEX "coding_sessions_service_id_idx"
ON "coding_sessions"("service_id");

CREATE INDEX "coding_sessions_organization_id_task_id_updated_at_idx"
ON "coding_sessions"("organization_id", "task_id", "updated_at");

CREATE UNIQUE INDEX "coding_sessions_agent_session_id_unique_idx"
ON "coding_sessions"("agent_session_id")
WHERE "agent_session_id" IS NOT NULL;
