-- Rename coding_sessions → agent_sessions, add AgentSessionType enum and type column
-- ===================================================================================

-- 1. Rename the main table
ALTER TABLE "coding_sessions" RENAME TO "agent_sessions";

-- 2. Rename primary key constraint
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_pkey" TO "agent_sessions_pkey";

-- 3. Rename foreign key constraints on agent_sessions
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_organization_id_fkey" TO "agent_sessions_organization_id_fkey";
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_user_id_fkey" TO "agent_sessions_user_id_fkey";
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_conversation_id_fkey" TO "agent_sessions_conversation_id_fkey";
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_initiative_id_fkey" TO "agent_sessions_initiative_id_fkey";
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_task_id_fkey" TO "agent_sessions_task_id_fkey";
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_design_doc_id_fkey" TO "agent_sessions_design_doc_id_fkey";
ALTER TABLE "agent_sessions" RENAME CONSTRAINT "coding_sessions_service_id_fkey" TO "agent_sessions_service_id_fkey";

-- 4. Rename indexes on agent_sessions
ALTER INDEX "coding_sessions_organization_id_session_date_idx" RENAME TO "agent_sessions_organization_id_session_date_idx";
ALTER INDEX "coding_sessions_user_id_session_date_idx" RENAME TO "agent_sessions_user_id_session_date_idx";
ALTER INDEX "coding_sessions_conversation_id_idx" RENAME TO "agent_sessions_conversation_id_idx";
ALTER INDEX "coding_sessions_initiative_id_idx" RENAME TO "agent_sessions_initiative_id_idx";
ALTER INDEX "coding_sessions_task_id_idx" RENAME TO "agent_sessions_task_id_idx";
ALTER INDEX "coding_sessions_design_doc_id_idx" RENAME TO "agent_sessions_design_doc_id_idx";
ALTER INDEX "coding_sessions_service_id_idx" RENAME TO "agent_sessions_service_id_idx";
ALTER INDEX "coding_sessions_organization_id_task_id_updated_at_idx" RENAME TO "agent_sessions_organization_id_task_id_updated_at_idx";
ALTER INDEX "coding_sessions_agent_session_id_unique_idx" RENAME TO "agent_sessions_provider_agent_session_id_unique_idx";

-- 5. Rename the provider's agent_session_id column to avoid confusion with FK columns
ALTER TABLE "agent_sessions" RENAME COLUMN "agent_session_id" TO "provider_agent_session_id";

-- 6. Rename FK column and related objects on coding_prompts
ALTER TABLE "coding_prompts" RENAME COLUMN "coding_session_id" TO "agent_session_id";
ALTER TABLE "coding_prompts" RENAME CONSTRAINT "coding_prompts_coding_session_id_fkey" TO "coding_prompts_agent_session_id_fkey";
ALTER INDEX "coding_prompts_organization_id_coding_session_id_idx" RENAME TO "coding_prompts_organization_id_agent_session_id_idx";
ALTER INDEX "coding_prompts_coding_session_id_idx" RENAME TO "coding_prompts_agent_session_id_idx";

-- 7. Rename FK column and related objects on implementation_hints
ALTER TABLE "implementation_hints" RENAME COLUMN "coding_session_id" TO "agent_session_id";
ALTER TABLE "implementation_hints" RENAME CONSTRAINT "implementation_hints_coding_session_id_fkey" TO "implementation_hints_agent_session_id_fkey";
ALTER INDEX "implementation_hints_coding_session_id_idx" RENAME TO "implementation_hints_agent_session_id_idx";

-- 8. Rename service_coding_sessions table, columns, and related objects
ALTER TABLE "service_coding_sessions" RENAME COLUMN "coding_session_id" TO "agent_session_id";
ALTER TABLE "service_coding_sessions" RENAME TO "service_agent_sessions";
ALTER TABLE "service_agent_sessions" RENAME CONSTRAINT "service_coding_sessions_pkey" TO "service_agent_sessions_pkey";
ALTER TABLE "service_agent_sessions" RENAME CONSTRAINT "service_coding_sessions_service_id_fkey" TO "service_agent_sessions_service_id_fkey";
ALTER TABLE "service_agent_sessions" RENAME CONSTRAINT "service_coding_sessions_coding_session_id_fkey" TO "service_agent_sessions_agent_session_id_fkey";
ALTER INDEX "service_coding_sessions_service_id_idx" RENAME TO "service_agent_sessions_service_id_idx";
ALTER INDEX "service_coding_sessions_coding_session_id_idx" RENAME TO "service_agent_sessions_agent_session_id_idx";
ALTER INDEX "service_coding_sessions_service_id_coding_session_id_key" RENAME TO "service_agent_sessions_service_id_agent_session_id_key";

-- 9. Rename CodingSessionStatus enum → AgentSessionStatus
ALTER TYPE "CodingSessionStatus" RENAME TO "AgentSessionStatus";

-- 10. Rename CODING_SESSION → AGENT_SESSION in EntityType enum
ALTER TYPE "EntityType" RENAME VALUE 'CODING_SESSION' TO 'AGENT_SESSION';

-- 11. Create AgentSessionType enum and add type column
CREATE TYPE "AgentSessionType" AS ENUM ('CODING');

ALTER TABLE "agent_sessions"
ADD COLUMN "type" "AgentSessionType" NOT NULL DEFAULT 'CODING';
