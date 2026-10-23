CREATE TYPE "ValidationSessionStatus" AS ENUM ('CREATED', 'RUNNING', 'COMPLETED', 'FAILED');

ALTER TYPE "EntityType" ADD VALUE 'VALIDATION_SESSION';

CREATE TABLE "validation_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "title" TEXT,
    "status" "ValidationSessionStatus" NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "validation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_validation_sessions" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "validation_session_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_validation_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "validation_sessions_organization_id_idx" ON "validation_sessions"("organization_id");
CREATE INDEX "validation_sessions_organization_id_status_idx" ON "validation_sessions"("organization_id", "status");
CREATE INDEX "validation_sessions_task_id_idx" ON "validation_sessions"("task_id");
CREATE INDEX "validation_sessions_task_id_status_idx" ON "validation_sessions"("task_id", "status");
CREATE INDEX "validation_sessions_conversation_id_idx" ON "validation_sessions"("conversation_id");
CREATE INDEX "validation_sessions_user_id_idx" ON "validation_sessions"("user_id");

CREATE UNIQUE INDEX "service_validation_sessions_service_id_validation_session_id_key" ON "service_validation_sessions"("service_id", "validation_session_id");
CREATE INDEX "service_validation_sessions_service_id_idx" ON "service_validation_sessions"("service_id");
CREATE INDEX "service_validation_sessions_validation_session_id_idx" ON "service_validation_sessions"("validation_session_id");

ALTER TABLE "validation_sessions" ADD CONSTRAINT "validation_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "validation_sessions" ADD CONSTRAINT "validation_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "validation_sessions" ADD CONSTRAINT "validation_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "validation_sessions" ADD CONSTRAINT "validation_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_validation_sessions" ADD CONSTRAINT "service_validation_sessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "service_validation_sessions" ADD CONSTRAINT "service_validation_sessions_validation_session_id_fkey" FOREIGN KEY ("validation_session_id") REFERENCES "validation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
