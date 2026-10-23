-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "api_key_type" AS ENUM ('INTERNAL', 'MASTRA_AI');

-- CreateEnum
CREATE TYPE "LLMPromptResponseStatus" AS ENUM ('STARTED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('STARTED', 'IN_PROGRESS', 'GENERATING_RESPONSE', 'COMPLETED', 'FAILED', 'RECOVERABLE', 'DELETED');

-- CreateEnum
CREATE TYPE "FlowExecutionStatus" AS ENUM ('STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "InitiationType" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WorkStatus" AS ENUM ('GENERATED', 'BACKLOG', 'REFINING_DESCRIPTION', 'REFINING_DETAILS', 'REFINING_ACCEPTANCE_CRITERIA', 'GENERATING_DESCRIPTION', 'GENERATING_DETAILS', 'GENERATING_DESCRIPTION_AND_DETAILS', 'GENERATING_ACCEPTANCE_CRITERIA', 'GENERATING_ALL', 'ACTIVE', 'ON_HOLD', 'VERIFYING', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InitiativeCreatorType" AS ENUM ('SYSTEM', 'USER');

-- CreateEnum
CREATE TYPE "InitiativeSourceType" AS ENUM ('PLAN');

-- CreateEnum
CREATE TYPE "ArtifactType" AS ENUM ('QA_PAIR', 'DOCUMENT', 'DOCUMENT_SECTION', 'COMMENT', 'WORKSTREAM', 'INSIGHT', 'REFERENCE', 'NOTE', 'DECISION', 'REQUIREMENT', 'INITIATIVE_ORIGINAL', 'TASK_ORIGINAL');

-- CreateEnum
CREATE TYPE "ArtifactStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'DRAFT', 'DEPRECATED', 'DELETED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskDependencyRelationType" AS ENUM ('DEPENDS_ON', 'BLOCKS');

-- CreateEnum
CREATE TYPE "TaskDependencySourceType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ArtifactRelationType" AS ENUM ('REFERENCES', 'DEPENDS_ON', 'CONTAINS', 'SIMILAR_TO', 'CONTRADICTS', 'UPDATES', 'IMPLEMENTS', 'BLOCKS', 'RELATES_TO', 'DERIVED_FROM', 'MENTIONED_IN');

-- CreateEnum
CREATE TYPE "DesignDocTaskRelationType" AS ENUM ('DOC_CREATED_FROM_TASK', 'TASK_CREATED_FROM_DOC', 'MENTIONED_IN');

-- CreateEnum
CREATE TYPE "TagSource" AS ENUM ('USER', 'SYSTEM_FAST', 'SYSTEM_DEEP');

-- CreateEnum
CREATE TYPE "ImplementationHintSourceType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ImplementationHintExtractedFrom" AS ENUM ('AGENT', 'USER');

-- CreateEnum
CREATE TYPE "SummaryCategory" AS ENUM ('technology', 'product', 'process', 'people');

-- CreateEnum
CREATE TYPE "SubfacetStatus" AS ENUM ('ACTIVE', 'PROVISIONAL', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('ARTIFACT', 'INITIATIVE', 'PROJECT', 'TASK', 'MESSAGE', 'CONVERSATION', 'DESIGN_DOC', 'CODING_SESSION', 'CODING_PROMPT', 'SERVICE', 'PLAN');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('CODING_RESEARCH', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "ReportEntityRelation" AS ENUM ('PRIMARY', 'CONTEXT');

-- CreateEnum
CREATE TYPE "plan_relationship_type" AS ENUM ('CREATED', 'LINKED');

-- CreateEnum
CREATE TYPE "plan_status" AS ENUM ('INTAKE', 'BRAINSTORMING', 'DRAFT', 'ACTIVE', 'BLOCKED', 'COMPLETE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "plan_stage_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "plan_execution_guidance_status" AS ENUM ('REQUESTED', 'GENERATING', 'READY');

-- CreateEnum
CREATE TYPE "plan_step_status" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'SKIPPED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "plan_step_relation_type" AS ENUM ('BLOCKER');

-- CreateEnum
CREATE TYPE "plan_step_type" AS ENUM ('TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER');

-- CreateEnum
CREATE TYPE "plan_effort_unit" AS ENUM ('HOURS', 'DAYS', 'POINTS');

-- CreateEnum
CREATE TYPE "plan_duration_unit" AS ENUM ('HOURS', 'DAYS', 'WEEKS');

-- CreateEnum
CREATE TYPE "plan_sign_off_status" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'SCHEDULED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SagaStatus" AS ENUM ('STARTED', 'RUNNING', 'COMPLETED', 'FAILED', 'COMPENSATING', 'COMPENSATED');

-- CreateEnum
CREATE TYPE "IntegrationState" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IntegrationConnectionStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR', 'PENDING', 'CONFIGURING');

-- CreateEnum
CREATE TYPE "IntegrationTargetType" AS ENUM ('USER', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "IntegrationType" AS ENUM ('GITHUB', 'JIRA');

-- CreateEnum
CREATE TYPE "TopologyConsolidationScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "TopologyConsolidationRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED');

-- CreateEnum
CREATE TYPE "TopologyConsolidationEntityStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- CreateEnum
CREATE TYPE "ArtifactSourceType" AS ENUM ('CONVERSATION', 'INTEGRATION', 'GITHUB_README', 'GITHUB_DOCS', 'GITHUB_ISSUE', 'GITHUB_PULL_REQUEST', 'INITIATIVE', 'SYSTEM', 'TASK', 'ADR', 'RFC', 'MESSAGE');

-- CreateEnum
CREATE TYPE "FeatureFlagType" AS ENUM ('BOOLEAN', 'STRING', 'NUMBER', 'JSON');

-- CreateEnum
CREATE TYPE "FeatureFlagScope" AS ENUM ('ORGANIZATION', 'PROJECT', 'USER', 'GLOBAL');

-- CreateEnum
CREATE TYPE "DesignDocTemplate" AS ENUM ('CLASSIC', 'ADR', 'RFC', 'DECISION', 'BRAINSTORM');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "dev_admin_mode" BOOLEAN NOT NULL DEFAULT false,
    "is_dev_admin" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "key_type" "api_key_type" NOT NULL DEFAULT 'INTERNAL',
    "service_type" TEXT,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'MEMBER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "invited_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "flag_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "FeatureFlagType" NOT NULL,
    "scope" "FeatureFlagScope" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "organization_id" TEXT NOT NULL,
    "workflow_id" TEXT,
    "workflow_about_type" TEXT,
    "initiated_by" "InitiationType" NOT NULL,
    "trigger_event" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'STARTED',
    "title" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "last_modified_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workflow_name" TEXT,
    "design_doc_id" TEXT,
    "workflow_about_id" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "workflow_id" TEXT NOT NULL,
    "type" "MessageType" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "user_id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parent_message_id" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_mentions" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_mentions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by" TEXT,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "originating_project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "description" TEXT,
    "owner_id" TEXT NOT NULL,
    "status" "plan_status" NOT NULL DEFAULT 'INTAKE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_stages" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sequence_order" INTEGER NOT NULL,
    "status" "plan_stage_status" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_execution_guidance" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "plan_execution_guidance_status" NOT NULL DEFAULT 'READY',
    "request_seq" INTEGER NOT NULL DEFAULT 0,
    "last_request_id" TEXT,
    "last_workflow_id" TEXT,
    "last_completed_seq" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_execution_guidance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_steps" (
    "id" TEXT NOT NULL,
    "stage_id" TEXT NOT NULL,
    "type" "plan_step_type" NOT NULL,
    "entity_type" "plan_step_type" NOT NULL,
    "entity_id" TEXT,
    "title" TEXT NOT NULL,
    "owner_id" TEXT,
    "effort_estimate_value" DOUBLE PRECISION NOT NULL,
    "effort_estimate_unit" "plan_effort_unit" NOT NULL,
    "start_at" TIMESTAMP(3),
    "end_at" TIMESTAMP(3),
    "duration_value" DOUBLE PRECISION,
    "duration_unit" "plan_duration_unit",
    "rationale" TEXT NOT NULL,
    "status" "plan_step_status" NOT NULL DEFAULT 'NOT_STARTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plan_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_step_relations" (
    "id" TEXT NOT NULL,
    "step_id" TEXT NOT NULL,
    "related_step_id" TEXT NOT NULL,
    "type" "plan_step_relation_type" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_step_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_relationships" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "plan_stage_id" TEXT,
    "plan_step_id" TEXT,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "relation_type" "plan_relationship_type" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_versions" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "author_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_sign_offs" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "signer_id" TEXT NOT NULL,
    "status" "plan_sign_off_status" NOT NULL,
    "note" TEXT,
    "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_sign_offs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiatives" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assignee_id" TEXT,
    "reasoning" TEXT,
    "organization_id" TEXT NOT NULL,
    "status" "WorkStatus" NOT NULL DEFAULT 'REFINING_DESCRIPTION',
    "priority" "Priority" DEFAULT 'MEDIUM',
    "creator_type" "InitiativeCreatorType" NOT NULL DEFAULT 'SYSTEM',
    "due_date" TIMESTAMP(3),
    "tags" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "source_conversation_id" TEXT,
    "source_type" "InitiativeSourceType",
    "source_id" TEXT,
    "last_modified_by" TEXT,
    "last_modified_at" TIMESTAMP(3),
    "originating_project_id" TEXT NOT NULL,

    CONSTRAINT "initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiative_sections" (
    "id" TEXT NOT NULL,
    "initiative_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "crdt_snapshot_bytes" BYTEA,
    "crdt_snapshot_seq" INTEGER,
    "materialized_markdown" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "initiative_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "initiative_section_updates" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "update_bytes" BYTEA NOT NULL,
    "update_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "initiative_section_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_initiatives" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "initiative_id" TEXT NOT NULL,
    "role" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "initiative_id" TEXT NOT NULL,
    "status" "WorkStatus" NOT NULL DEFAULT 'BACKLOG',
    "priority" "Priority" DEFAULT 'MEDIUM',
    "due_date" TIMESTAMP(3),
    "assignee_id" TEXT,
    "creator_id" TEXT,
    "parent_task_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "reasoning" TEXT,
    "generation_metadata" JSONB,
    "source_conversation_id" TEXT,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_sections" (
    "id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "crdt_snapshot_bytes" BYTEA,
    "crdt_snapshot_seq" INTEGER,
    "materialized_markdown" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_section_updates" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "update_bytes" BYTEA NOT NULL,
    "update_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_section_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "id" TEXT NOT NULL,
    "dependent_task_id" TEXT NOT NULL,
    "dependency_task_id" TEXT NOT NULL,
    "relation_type" "TaskDependencyRelationType" NOT NULL DEFAULT 'DEPENDS_ON',
    "source_type" "TaskDependencySourceType" NOT NULL DEFAULT 'USER',
    "created_by_id" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_tasks" (
    "id" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "type" "ArtifactType" NOT NULL,
    "title" TEXT,
    "data" JSONB NOT NULL,
    "vector_id" TEXT,
    "embedding_model" TEXT,
    "has_embedding" BOOLEAN NOT NULL DEFAULT false,
    "parent_id" TEXT,
    "root_id" TEXT,
    "source_type" "ArtifactSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "content_hash" TEXT,
    "language" TEXT,
    "tags" TEXT[],
    "category" TEXT,
    "priority" "Priority",
    "status" "ArtifactStatus" NOT NULL DEFAULT 'ACTIVE',
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),
    "organization_id" TEXT NOT NULL,
    "initiative_id" TEXT,
    "design_doc_id" TEXT,
    "service_id" TEXT,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifact_relations" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "relation_type" "ArtifactRelationType" NOT NULL,
    "strength" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "report_type" "ReportType" NOT NULL,
    "payload" JSONB NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "source_execution_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_entities" (
    "id" TEXT NOT NULL,
    "report_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "relation" "ReportEntityRelation" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "influences" (
    "id" TEXT NOT NULL,
    "influenced_type" TEXT NOT NULL,
    "influenced_id" TEXT NOT NULL,
    "influencing_type" TEXT NOT NULL,
    "influencing_id" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "reason_type" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organization_id" TEXT NOT NULL,

    CONSTRAINT "influences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" "TagSource" NOT NULL DEFAULT 'USER',
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_stars" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_stars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "saga_id" TEXT,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "headers" JSONB NOT NULL DEFAULT '{}',
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "next_retry_at" TIMESTAMP(3),
    "scheduled_for" TIMESTAMP(3),
    "last_error" TEXT,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "partition_key" TEXT NOT NULL,
    "sequence_number" BIGINT NOT NULL DEFAULT 0,
    "source_service" TEXT NOT NULL,
    "source_method" TEXT NOT NULL,
    "source_version" TEXT,
    "user_id" TEXT,
    "organization_id" TEXT,
    "project_id" TEXT,
    "conversation_id" TEXT,
    "workflow_id" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_agg_seq" (
    "aggregate_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "last_seq" BIGINT NOT NULL,

    CONSTRAINT "outbox_agg_seq_pkey" PRIMARY KEY ("aggregate_id","aggregate_type","event_type")
);

-- CreateTable
CREATE TABLE "event_log" (
    "id" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT,
    "saga_id" TEXT,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "event_version" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processing_time" INTEGER,
    "source_service" TEXT NOT NULL,
    "source_method" TEXT NOT NULL,
    "source_version" TEXT,
    "user_id" TEXT,
    "organization_id" TEXT,
    "project_id" TEXT,
    "conversation_id" TEXT,
    "workflow_id" TEXT,
    "published_to" TEXT[],
    "published_at" TIMESTAMP(3),
    "publish_latency" INTEGER,

    CONSTRAINT "event_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saga_states" (
    "id" TEXT NOT NULL,
    "saga_id" TEXT NOT NULL,
    "saga_type" TEXT NOT NULL,
    "current_step" TEXT NOT NULL,
    "status" "SagaStatus" NOT NULL DEFAULT 'STARTED',
    "payload" JSONB NOT NULL,
    "organization_id" TEXT,
    "project_id" TEXT,
    "conversation_id" TEXT,
    "workflow_id" TEXT,
    "user_id" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),
    "compensation_data" JSONB,
    "last_error" TEXT,

    CONSTRAINT "saga_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "config" JSONB NOT NULL,
    "state" "IntegrationState" NOT NULL DEFAULT 'ACTIVE',
    "connection_status" "IntegrationConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "last_connection_check" TIMESTAMP(3),
    "last_successful_sync" TIMESTAMP(3),
    "error_message" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "type" TEXT NOT NULL,
    "target_type" "IntegrationTargetType" NOT NULL DEFAULT 'ORGANIZATION',

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhooks" (
    "id" TEXT NOT NULL,
    "integration_id" TEXT NOT NULL,
    "webhook_type" TEXT NOT NULL,
    "external_webhook_id" TEXT,
    "webhook_url" TEXT NOT NULL,
    "events" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered" TIMESTAMP(3),
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_organizations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "user_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_flow_permissions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_flow_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_executions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flow_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "status" "FlowExecutionStatus" NOT NULL DEFAULT 'STARTED',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "flow_state" JSONB,
    "resumable" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "error_code" TEXT,
    "current_node" TEXT,
    "total_nodes" INTEGER,
    "completed_nodes" INTEGER NOT NULL DEFAULT 0,
    "execution_time_ms" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "flow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cleanup_metrics" (
    "id" TEXT NOT NULL,
    "messages_removed" INTEGER,
    "duration_ms" INTEGER,
    "batch_size" INTEGER,
    "cleanup_type" TEXT NOT NULL DEFAULT 'conversation_history',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cleanup_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_history_configs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "flow_type" TEXT,
    "max_messages" INTEGER NOT NULL DEFAULT 50,
    "max_age_ms" INTEGER NOT NULL DEFAULT 86400000,
    "max_tokens" INTEGER NOT NULL DEFAULT 50000,
    "prune_threshold" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_history_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_suggestions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "sources" TEXT[],
    "confidence" DECIMAL(3,2) NOT NULL,
    "last_seen" TIMESTAMP(3) NOT NULL,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "integration_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suggestion_decisions" (
    "organization_id" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "decided_by" TEXT,
    "source_conversation_id" TEXT,
    "source_message_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suggestion_decisions_pkey" PRIMARY KEY ("organization_id","type","id")
);

-- CreateTable
CREATE TABLE "llm_prompt_responses" (
    "id" TEXT NOT NULL,
    "request_id" TEXT,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "conversation_id" TEXT,
    "workflow_id" TEXT,
    "flow_id" TEXT,
    "user_id" TEXT,
    "node_id" TEXT,
    "node_type" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "task_type" TEXT,
    "tool_name" TEXT,
    "temperature" DOUBLE PRECISION,
    "max_tokens" INTEGER,
    "stream" BOOLEAN NOT NULL DEFAULT false,
    "prompt" TEXT NOT NULL,
    "response_content" TEXT,
    "response_schema" JSONB,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "total_tokens" INTEGER,
    "input_cost" DECIMAL(10,6),
    "output_cost" DECIMAL(10,6),
    "total_cost" DECIMAL(10,6),
    "duration_ms" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "error_message" TEXT,
    "error_type" TEXT,
    "status" "LLMPromptResponseStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_prompt_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unified_search_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "message_id" TEXT,
    "request_id" TEXT,
    "intent" TEXT NOT NULL,
    "query" TEXT,
    "request_payload" JSONB NOT NULL,
    "graph_response" JSONB,
    "embeddings_response" JSONB,
    "unified_response" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unified_search_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_event_batches" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "device_info" JSONB NOT NULL,
    "events_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_event_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "batch_internal_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "user_agent" TEXT NOT NULL,
    "viewport" JSONB NOT NULL,
    "context" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_registry" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_name" TEXT,
    "name_search_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "entity_registry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_graph_embedding_mappings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "graph_node_id" TEXT,
    "embedding_id" TEXT,
    "mapping_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_graph_embedding_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_docs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "template" "DesignDocTemplate" NOT NULL DEFAULT 'ADR',
    "status" TEXT NOT NULL DEFAULT 'ADR_CONTEXT',
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "tags" TEXT[],
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "design_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_doc_sections" (
    "id" TEXT NOT NULL,
    "design_doc_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "crdt_snapshot_bytes" BYTEA,
    "crdt_snapshot_seq" INTEGER,
    "materialized_markdown" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_doc_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_doc_section_updates" (
    "id" TEXT NOT NULL,
    "section_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "update_bytes" BYTEA NOT NULL,
    "update_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_doc_section_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_doc_task_relations" (
    "id" TEXT NOT NULL,
    "design_doc_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "relation_type" "DesignDocTaskRelationType" NOT NULL DEFAULT 'TASK_CREATED_FROM_DOC',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_doc_task_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_doc_initiative_relations" (
    "id" TEXT NOT NULL,
    "design_doc_id" TEXT NOT NULL,
    "initiative_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_doc_initiative_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_doc_design_doc_relations" (
    "id" TEXT NOT NULL,
    "parent_design_doc_id" TEXT NOT NULL,
    "child_design_doc_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_doc_design_doc_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subfacets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" "SummaryCategory" NOT NULL,
    "status" "SubfacetStatus" NOT NULL DEFAULT 'ACTIVE',
    "survival_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_in_consolidation_at" TIMESTAMP(3),
    "deprecated_at" TIMESTAMP(3),
    "summary" TEXT,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "last_summarized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subfacets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_summaries" (
    "id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "category" "SummaryCategory" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_current" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entity_subfacets" (
    "id" TEXT NOT NULL,
    "summary_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "subfacet_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_subfacets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_category_summaries" (
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" "SummaryCategory" NOT NULL,
    "summary" TEXT NOT NULL,
    "brief_summary" TEXT,
    "last_updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_category_summaries_pkey" PRIMARY KEY ("organization_id","project_id","category")
);

-- CreateTable
CREATE TABLE "subfacet_consolidation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "topology_consolidation_run_id" TEXT,
    "temporal_workflow_id" TEXT,
    "request_id" TEXT,
    "node_name" TEXT,
    "prompt_version" TEXT,
    "parser_version" TEXT,
    "category" "SummaryCategory" NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "threshold_applied" INTEGER NOT NULL,
    "accumulated_snapshot" JSONB NOT NULL,
    "consolidated_before" JSONB,
    "consolidation_result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subfacet_consolidation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_consolidation_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "topology_consolidation_run_id" TEXT,
    "temporal_workflow_id" TEXT,
    "request_id" TEXT,
    "node_name" TEXT,
    "prompt_version" TEXT,
    "parser_version" TEXT,
    "category" "SummaryCategory" NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "threshold_applied" INTEGER NOT NULL,
    "accumulated_snapshot" JSONB NOT NULL,
    "consolidated_before" JSONB,
    "consolidation_result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_consolidation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subfacet_summarization_runs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "topology_consolidation_run_id" TEXT,
    "temporal_workflow_id" TEXT,
    "request_id" TEXT,
    "node_name" TEXT,
    "prompt_version" TEXT,
    "parser_version" TEXT,
    "category" "SummaryCategory" NOT NULL,
    "subfacet_id" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "threshold_applied" INTEGER NOT NULL,
    "accumulated_snapshot" JSONB NOT NULL,
    "consolidated_before" JSONB,
    "consolidation_result" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subfacet_summarization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_consolidation_schedule" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" "TopologyConsolidationScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "cadence_hours" INTEGER NOT NULL DEFAULT 24,
    "max_entities_per_run" INTEGER,
    "max_entities_per_subfacet" INTEGER,
    "max_entities_per_subfacet_summary" INTEGER,
    "max_per_category" INTEGER,
    "max_per_subfacet" INTEGER,
    "threshold" INTEGER,
    "max_iterations" INTEGER,
    "retry_max_attempts" INTEGER NOT NULL DEFAULT 3,
    "retry_backoff_seconds" INTEGER NOT NULL DEFAULT 5,
    "lock_token" TEXT,
    "lease_expires_at" TIMESTAMP(3),
    "running_since" TIMESTAMP(3),
    "current_run_id" TEXT,
    "next_run_at" TIMESTAMP(3),
    "last_run_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_consolidation_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_consolidation_run" (
    "id" TEXT NOT NULL,
    "schedule_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" "TopologyConsolidationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "since" TIMESTAMP(3) NOT NULL,
    "until" TIMESTAMP(3) NOT NULL,
    "temporal_workflow_id" TEXT,
    "entities_discovered" INTEGER NOT NULL DEFAULT 0,
    "entities_processed" INTEGER NOT NULL DEFAULT 0,
    "categories_processed" INTEGER NOT NULL DEFAULT 0,
    "subfacets_processed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "details" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_consolidation_run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_consolidation_entity_state" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "entity_id" TEXT NOT NULL,
    "latest_summary_id" TEXT,
    "latest_summary_updated_at" TIMESTAMP(3),
    "status" "TopologyConsolidationEntityStatus" NOT NULL DEFAULT 'PENDING',
    "last_processed_run_id" TEXT,
    "last_processed_at" TIMESTAMP(3),
    "last_attempt_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_consolidation_entity_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "topology_subfacet_candidate" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "category" "SummaryCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_slug" TEXT NOT NULL,
    "proposal_count" INTEGER NOT NULL DEFAULT 1,
    "latest_confidence" DOUBLE PRECISION,
    "latest_rationale" TEXT,
    "last_source_entity_type" "EntityType",
    "last_source_entity_id" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "promoted_at" TIMESTAMP(3),
    "promoted_subfacet_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "topology_subfacet_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_date" TIMESTAMP(3) NOT NULL,
    "conversation_id" TEXT,
    "initiative_id" TEXT,
    "task_id" TEXT,
    "design_doc_id" TEXT,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coding_prompts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "coding_session_id" TEXT NOT NULL,
    "name" TEXT,
    "text" TEXT NOT NULL,
    "product_goal" TEXT,
    "product_outcome" TEXT,
    "accepted_date" TIMESTAMP(3) NOT NULL,
    "accepted_by" TEXT NOT NULL,
    "feedback" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coding_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attention_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "tab" TEXT,
    "focus_start" TIMESTAMP(3) NOT NULL,
    "focus_end" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attention_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT,
    "repository_url" TEXT,
    "repository_type" TEXT,
    "repository_id" TEXT,
    "service_type" TEXT,
    "language" TEXT,
    "framework" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "archived_at" TIMESTAMP(3),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_hints" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "feature_name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source_type" "ImplementationHintSourceType" NOT NULL,
    "hint" TEXT,
    "context" JSONB,
    "extracted_from" "ImplementationHintExtractedFrom",
    "confidence" DOUBLE PRECISION,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "implementation_hints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_hint_versions" (
    "id" TEXT NOT NULL,
    "hint_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hint" TEXT NOT NULL,
    "context" JSONB,
    "extracted_from" "ImplementationHintExtractedFrom" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "implementation_hint_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_hint_file_references" (
    "id" TEXT NOT NULL,
    "hint_id" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "start_line" INTEGER,
    "end_line" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "implementation_hint_file_references_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_hint_coding_sessions" (
    "id" TEXT NOT NULL,
    "implementation_hint_id" TEXT NOT NULL,
    "coding_session_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "implementation_hint_coding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_hint_coding_prompts" (
    "id" TEXT NOT NULL,
    "implementation_hint_id" TEXT NOT NULL,
    "coding_prompt_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "implementation_hint_coding_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_tasks" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_initiatives" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "initiative_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_initiatives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_design_docs" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "design_doc_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_design_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_coding_sessions" (
    "id" TEXT NOT NULL,
    "service_id" TEXT NOT NULL,
    "coding_session_id" TEXT NOT NULL,
    "relation_type" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_coding_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_organization_id_is_active_idx" ON "api_keys"("organization_id", "is_active");

-- CreateIndex
CREATE INDEX "api_keys_key_hash_idx" ON "api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "api_keys_prefix_idx" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_organization_id_key_type_service_type_idx" ON "api_keys"("organization_id", "key_type", "service_type");

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_organization_id_key_type_service_type_key" ON "api_keys"("organization_id", "key_type", "service_type");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_organization_id_role_idx" ON "organization_members"("organization_id", "role");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_user_id_organization_id_key" ON "organization_members"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "feature_flags_organization_id_enabled_idx" ON "feature_flags"("organization_id", "enabled");

-- CreateIndex
CREATE INDEX "feature_flags_flag_key_idx" ON "feature_flags"("flag_key");

-- CreateIndex
CREATE INDEX "feature_flags_type_idx" ON "feature_flags"("type");

-- CreateIndex
CREATE INDEX "feature_flags_scope_idx" ON "feature_flags"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_organization_id_flag_key_key" ON "feature_flags"("organization_id", "flag_key");

-- CreateIndex
CREATE INDEX "conversations_workflow_id_idx" ON "conversations"("workflow_id");

-- CreateIndex
CREATE INDEX "conversations_project_id_idx" ON "conversations"("project_id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_idx" ON "conversations"("organization_id");

-- CreateIndex
CREATE INDEX "conversations_organization_id_status_idx" ON "conversations"("organization_id", "status");

-- CreateIndex
CREATE INDEX "conversations_design_doc_id_idx" ON "conversations"("design_doc_id");

-- CreateIndex
CREATE INDEX "conversations_id_version_idx" ON "conversations"("id", "version");

-- CreateIndex
CREATE INDEX "conversations_workflow_about_type_idx" ON "conversations"("workflow_about_type");

-- CreateIndex
CREATE INDEX "conversations_project_id_workflow_about_type_idx" ON "conversations"("project_id", "workflow_about_type");

-- CreateIndex
CREATE INDEX "conversations_workflow_about_id_idx" ON "conversations"("workflow_about_id");

-- CreateIndex
CREATE INDEX "conversations_workflow_about_id_workflow_about_type_idx" ON "conversations"("workflow_about_id", "workflow_about_type");

-- CreateIndex
CREATE INDEX "conversations_workflow_name_idx" ON "conversations"("workflow_name");

-- CreateIndex
CREATE INDEX "messages_project_id_created_at_idx" ON "messages"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_workflow_id_created_at_idx" ON "messages"("workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "messages_user_id_created_at_idx" ON "messages"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "message_mentions_message_id_entity_id_idx" ON "message_mentions"("message_id", "entity_id");

-- CreateIndex
CREATE INDEX "message_mentions_conversation_id_entity_id_idx" ON "message_mentions"("conversation_id", "entity_id");

-- CreateIndex
CREATE INDEX "message_mentions_entity_id_entity_type_idx" ON "message_mentions"("entity_id", "entity_type");

-- CreateIndex
CREATE INDEX "projects_organization_id_idx" ON "projects"("organization_id");

-- CreateIndex
CREATE INDEX "projects_created_by_idx" ON "projects"("created_by");

-- CreateIndex
CREATE INDEX "plans_organization_id_idx" ON "plans"("organization_id");

-- CreateIndex
CREATE INDEX "plans_originating_project_id_idx" ON "plans"("originating_project_id");

-- CreateIndex
CREATE INDEX "plans_owner_id_idx" ON "plans"("owner_id");

-- CreateIndex
CREATE INDEX "plans_status_idx" ON "plans"("status");

-- CreateIndex
CREATE INDEX "plan_stages_plan_id_idx" ON "plan_stages"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_stages_plan_id_sequence_order_key" ON "plan_stages"("plan_id", "sequence_order");

-- CreateIndex
CREATE UNIQUE INDEX "plan_execution_guidance_stage_id_key" ON "plan_execution_guidance"("stage_id");

-- CreateIndex
CREATE INDEX "plan_execution_guidance_plan_id_idx" ON "plan_execution_guidance"("plan_id");

-- CreateIndex
CREATE INDEX "plan_steps_stage_id_idx" ON "plan_steps"("stage_id");

-- CreateIndex
CREATE INDEX "plan_steps_owner_id_idx" ON "plan_steps"("owner_id");

-- CreateIndex
CREATE INDEX "plan_steps_entity_type_entity_id_idx" ON "plan_steps"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "plan_step_relations_step_id_idx" ON "plan_step_relations"("step_id");

-- CreateIndex
CREATE INDEX "plan_step_relations_related_step_id_idx" ON "plan_step_relations"("related_step_id");

-- CreateIndex
CREATE INDEX "plan_step_relations_type_idx" ON "plan_step_relations"("type");

-- CreateIndex
CREATE UNIQUE INDEX "plan_step_relations_step_id_related_step_id_type_key" ON "plan_step_relations"("step_id", "related_step_id", "type");

-- CreateIndex
CREATE INDEX "plan_relationships_plan_id_idx" ON "plan_relationships"("plan_id");

-- CreateIndex
CREATE INDEX "plan_relationships_plan_stage_id_idx" ON "plan_relationships"("plan_stage_id");

-- CreateIndex
CREATE INDEX "plan_relationships_plan_step_id_idx" ON "plan_relationships"("plan_step_id");

-- CreateIndex
CREATE INDEX "plan_relationships_entity_type_entity_id_idx" ON "plan_relationships"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "plan_relationships_relation_type_idx" ON "plan_relationships"("relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "plan_relationships_plan_id_plan_stage_id_plan_step_id_entit_key" ON "plan_relationships"("plan_id", "plan_stage_id", "plan_step_id", "entity_type", "entity_id", "relation_type");

-- CreateIndex
CREATE INDEX "plan_versions_plan_id_idx" ON "plan_versions"("plan_id");

-- CreateIndex
CREATE INDEX "plan_versions_author_id_idx" ON "plan_versions"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_versions_plan_id_version_number_key" ON "plan_versions"("plan_id", "version_number");

-- CreateIndex
CREATE INDEX "plan_sign_offs_plan_id_idx" ON "plan_sign_offs"("plan_id");

-- CreateIndex
CREATE INDEX "plan_sign_offs_version_id_idx" ON "plan_sign_offs"("version_id");

-- CreateIndex
CREATE INDEX "plan_sign_offs_signer_id_idx" ON "plan_sign_offs"("signer_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_sign_offs_plan_id_version_id_signer_id_key" ON "plan_sign_offs"("plan_id", "version_id", "signer_id");

-- CreateIndex
CREATE INDEX "initiatives_organization_id_idx" ON "initiatives"("organization_id");

-- CreateIndex
CREATE INDEX "initiatives_status_idx" ON "initiatives"("status");

-- CreateIndex
CREATE INDEX "initiatives_due_date_idx" ON "initiatives"("due_date");

-- CreateIndex
CREATE INDEX "initiatives_tags_idx" ON "initiatives"("tags");

-- CreateIndex
CREATE INDEX "initiatives_source_conversation_id_idx" ON "initiatives"("source_conversation_id");

-- CreateIndex
CREATE INDEX "initiatives_source_type_idx" ON "initiatives"("source_type");

-- CreateIndex
CREATE INDEX "initiatives_assignee_id_idx" ON "initiatives"("assignee_id");

-- CreateIndex
CREATE INDEX "initiatives_last_modified_by_idx" ON "initiatives"("last_modified_by");

-- CreateIndex
CREATE INDEX "initiatives_last_modified_at_idx" ON "initiatives"("last_modified_at");

-- CreateIndex
CREATE INDEX "initiatives_originating_project_id_idx" ON "initiatives"("originating_project_id");

-- CreateIndex
CREATE UNIQUE INDEX "initiative_sections_initiative_id_key_key" ON "initiative_sections"("initiative_id", "key");

-- CreateIndex
CREATE INDEX "initiative_section_updates_section_id_seq_idx" ON "initiative_section_updates"("section_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "initiative_section_updates_section_id_update_hash_key" ON "initiative_section_updates"("section_id", "update_hash");

-- CreateIndex
CREATE INDEX "project_initiatives_project_id_idx" ON "project_initiatives"("project_id");

-- CreateIndex
CREATE INDEX "project_initiatives_initiative_id_idx" ON "project_initiatives"("initiative_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_initiatives_project_id_initiative_id_key" ON "project_initiatives"("project_id", "initiative_id");

-- CreateIndex
CREATE INDEX "tasks_organization_id_status_idx" ON "tasks"("organization_id", "status");

-- CreateIndex
CREATE INDEX "tasks_initiative_id_status_idx" ON "tasks"("initiative_id", "status");

-- CreateIndex
CREATE INDEX "tasks_assignee_id_idx" ON "tasks"("assignee_id");

-- CreateIndex
CREATE INDEX "tasks_creator_id_idx" ON "tasks"("creator_id");

-- CreateIndex
CREATE INDEX "tasks_parent_task_id_idx" ON "tasks"("parent_task_id");

-- CreateIndex
CREATE INDEX "tasks_initiative_id_parent_task_id_idx" ON "tasks"("initiative_id", "parent_task_id");

-- CreateIndex
CREATE INDEX "tasks_source_conversation_id_idx" ON "tasks"("source_conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_sections_task_id_key_key" ON "task_sections"("task_id", "key");

-- CreateIndex
CREATE INDEX "task_section_updates_section_id_seq_idx" ON "task_section_updates"("section_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "task_section_updates_section_id_update_hash_key" ON "task_section_updates"("section_id", "update_hash");

-- CreateIndex
CREATE INDEX "task_dependencies_dependent_task_id_idx" ON "task_dependencies"("dependent_task_id");

-- CreateIndex
CREATE INDEX "task_dependencies_dependency_task_id_idx" ON "task_dependencies"("dependency_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "task_dependencies_dependent_task_id_dependency_task_id_key" ON "task_dependencies"("dependent_task_id", "dependency_task_id");

-- CreateIndex
CREATE INDEX "project_tasks_project_id_idx" ON "project_tasks"("project_id");

-- CreateIndex
CREATE INDEX "project_tasks_task_id_idx" ON "project_tasks"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_tasks_project_id_task_id_key" ON "project_tasks"("project_id", "task_id");

-- CreateIndex
CREATE INDEX "artifact_tasks_artifact_id_idx" ON "artifact_tasks"("artifact_id");

-- CreateIndex
CREATE INDEX "artifact_tasks_task_id_idx" ON "artifact_tasks"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_tasks_artifact_id_task_id_key" ON "artifact_tasks"("artifact_id", "task_id");

-- CreateIndex
CREATE INDEX "artifacts_project_id_type_status_idx" ON "artifacts"("project_id", "type", "status");

-- CreateIndex
CREATE INDEX "artifacts_project_id_created_at_idx" ON "artifacts"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_initiative_id_type_status_idx" ON "artifacts"("initiative_id", "type", "status");

-- CreateIndex
CREATE INDEX "artifacts_initiative_id_created_at_idx" ON "artifacts"("initiative_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_design_doc_id_type_status_idx" ON "artifacts"("design_doc_id", "type", "status");

-- CreateIndex
CREATE INDEX "artifacts_design_doc_id_created_at_idx" ON "artifacts"("design_doc_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_service_id_type_status_idx" ON "artifacts"("service_id", "type", "status");

-- CreateIndex
CREATE INDEX "artifacts_service_id_created_at_idx" ON "artifacts"("service_id", "created_at");

-- CreateIndex
CREATE INDEX "artifacts_organization_id_idx" ON "artifacts"("organization_id");

-- CreateIndex
CREATE INDEX "artifacts_source_type_source_id_idx" ON "artifacts"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "artifacts_content_hash_idx" ON "artifacts"("content_hash");

-- CreateIndex
CREATE INDEX "artifacts_root_id_idx" ON "artifacts"("root_id");

-- CreateIndex
CREATE INDEX "artifacts_tags_idx" ON "artifacts"("tags");

-- CreateIndex
CREATE INDEX "artifacts_vector_id_idx" ON "artifacts"("vector_id");

-- CreateIndex
CREATE INDEX "artifacts_has_embedding_idx" ON "artifacts"("has_embedding");

-- CreateIndex
CREATE INDEX "artifact_relations_source_id_idx" ON "artifact_relations"("source_id");

-- CreateIndex
CREATE INDEX "artifact_relations_target_id_idx" ON "artifact_relations"("target_id");

-- CreateIndex
CREATE INDEX "artifact_relations_relation_type_idx" ON "artifact_relations"("relation_type");

-- CreateIndex
CREATE UNIQUE INDEX "artifact_relations_source_id_target_id_relation_type_key" ON "artifact_relations"("source_id", "target_id", "relation_type");

-- CreateIndex
CREATE INDEX "reports_org_created_idx" ON "reports"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_org_expires_idx" ON "reports"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "reports_org_type_created_idx" ON "reports"("organization_id", "report_type", "created_at");

-- CreateIndex
CREATE INDEX "reports_project_created_idx" ON "reports"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "reports_source_execution_idx" ON "reports"("source_execution_id");

-- CreateIndex
CREATE INDEX "report_entities_report_idx" ON "report_entities"("report_id");

-- CreateIndex
CREATE INDEX "report_entities_entity_idx" ON "report_entities"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "report_entities_entity_relation_idx" ON "report_entities"("entity_type", "entity_id", "relation");

-- CreateIndex
CREATE UNIQUE INDEX "report_entities_unique_link" ON "report_entities"("report_id", "entity_type", "entity_id", "relation");

-- CreateIndex
CREATE INDEX "influences_influenced_type_influenced_id_idx" ON "influences"("influenced_type", "influenced_id");

-- CreateIndex
CREATE INDEX "influences_influencing_type_influencing_id_idx" ON "influences"("influencing_type", "influencing_id");

-- CreateIndex
CREATE INDEX "influences_reason_type_idx" ON "influences"("reason_type");

-- CreateIndex
CREATE INDEX "influences_organization_id_idx" ON "influences"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "influences_influenced_type_influenced_id_influencing_type_i_key" ON "influences"("influenced_type", "influenced_id", "influencing_type", "influencing_id", "reason_type");

-- CreateIndex
CREATE INDEX "tags_organization_id_entity_type_entity_id_idx" ON "tags"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "tags_organization_id_name_idx" ON "tags"("organization_id", "name");

-- CreateIndex
CREATE INDEX "tags_organization_id_source_idx" ON "tags"("organization_id", "source");

-- CreateIndex
CREATE UNIQUE INDEX "tags_organization_id_entity_type_entity_id_name_key" ON "tags"("organization_id", "entity_type", "entity_id", "name");

-- CreateIndex
CREATE INDEX "entity_stars_organization_id_user_id_idx" ON "entity_stars"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "entity_stars_organization_id_entity_type_entity_id_idx" ON "entity_stars"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_stars_organization_id_user_id_entity_type_entity_id_key" ON "entity_stars"("organization_id", "user_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "outbox_events_status_next_retry_at_partition_key_idx" ON "outbox_events"("status", "next_retry_at", "partition_key");

-- CreateIndex
CREATE INDEX "outbox_events_correlation_id_idx" ON "outbox_events"("correlation_id");

-- CreateIndex
CREATE INDEX "outbox_events_causation_id_idx" ON "outbox_events"("causation_id");

-- CreateIndex
CREATE INDEX "outbox_events_saga_id_idx" ON "outbox_events"("saga_id");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_events_partition_key_sequence_number_idx" ON "outbox_events"("partition_key", "sequence_number");

-- CreateIndex
CREATE INDEX "outbox_events_organization_id_created_at_idx" ON "outbox_events"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_project_id_created_at_idx" ON "outbox_events"("project_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_conversation_id_created_at_idx" ON "outbox_events"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_workflow_id_created_at_idx" ON "outbox_events"("workflow_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_event_type_created_at_idx" ON "outbox_events"("event_type", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_id_event_type_created_at_idx" ON "outbox_events"("aggregate_id", "event_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ux_outbox_agg_seq" ON "outbox_events"("aggregate_type", "aggregate_id", "event_type", "sequence_number");

-- CreateIndex
CREATE INDEX "event_log_correlation_id_processed_at_idx" ON "event_log"("correlation_id", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_causation_id_idx" ON "event_log"("causation_id");

-- CreateIndex
CREATE INDEX "event_log_aggregate_type_aggregate_id_processed_at_idx" ON "event_log"("aggregate_type", "aggregate_id", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_event_type_processed_at_idx" ON "event_log"("event_type", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_organization_id_processed_at_idx" ON "event_log"("organization_id", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_project_id_processed_at_idx" ON "event_log"("project_id", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_conversation_id_processed_at_idx" ON "event_log"("conversation_id", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_workflow_id_processed_at_idx" ON "event_log"("workflow_id", "processed_at");

-- CreateIndex
CREATE INDEX "event_log_saga_id_processed_at_idx" ON "event_log"("saga_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "saga_states_saga_id_key" ON "saga_states"("saga_id");

-- CreateIndex
CREATE INDEX "saga_states_saga_type_status_idx" ON "saga_states"("saga_type", "status");

-- CreateIndex
CREATE INDEX "saga_states_organization_id_saga_type_idx" ON "saga_states"("organization_id", "saga_type");

-- CreateIndex
CREATE INDEX "saga_states_project_id_saga_type_idx" ON "saga_states"("project_id", "saga_type");

-- CreateIndex
CREATE INDEX "integrations_project_id_idx" ON "integrations"("project_id");

-- CreateIndex
CREATE INDEX "integrations_organization_id_idx" ON "integrations"("organization_id");

-- CreateIndex
CREATE INDEX "integrations_type_idx" ON "integrations"("type");

-- CreateIndex
CREATE INDEX "integrations_state_idx" ON "integrations"("state");

-- CreateIndex
CREATE INDEX "integrations_connection_status_idx" ON "integrations"("connection_status");

-- CreateIndex
CREATE INDEX "integrations_created_at_idx" ON "integrations"("created_at");

-- CreateIndex
CREATE INDEX "integration_webhooks_integration_id_idx" ON "integration_webhooks"("integration_id");

-- CreateIndex
CREATE INDEX "integration_webhooks_webhook_type_idx" ON "integration_webhooks"("webhook_type");

-- CreateIndex
CREATE INDEX "integration_webhooks_is_active_idx" ON "integration_webhooks"("is_active");

-- CreateIndex
CREATE INDEX "integration_webhooks_last_triggered_idx" ON "integration_webhooks"("last_triggered");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhooks_integration_id_webhook_type_key" ON "integration_webhooks"("integration_id", "webhook_type");

-- CreateIndex
CREATE INDEX "user_organizations_organization_id_idx" ON "user_organizations"("organization_id");

-- CreateIndex
CREATE INDEX "user_organizations_user_id_idx" ON "user_organizations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_organizations_user_id_organization_id_key" ON "user_organizations"("user_id", "organization_id");

-- CreateIndex
CREATE INDEX "organization_flow_permissions_flow_id_idx" ON "organization_flow_permissions"("flow_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_flow_permissions_organization_id_flow_id_key" ON "organization_flow_permissions"("organization_id", "flow_id");

-- CreateIndex
CREATE INDEX "flow_executions_user_id_flow_id_started_at_idx" ON "flow_executions"("user_id", "flow_id", "started_at");

-- CreateIndex
CREATE INDEX "flow_executions_organization_id_status_idx" ON "flow_executions"("organization_id", "status");

-- CreateIndex
CREATE INDEX "flow_executions_project_id_idx" ON "flow_executions"("project_id");

-- CreateIndex
CREATE INDEX "flow_executions_flow_id_status_completed_at_idx" ON "flow_executions"("flow_id", "status", "completed_at");

-- CreateIndex
CREATE INDEX "flow_executions_conversation_id_idx" ON "flow_executions"("conversation_id");

-- CreateIndex
CREATE INDEX "flow_executions_entity_type_entity_id_status_idx" ON "flow_executions"("entity_type", "entity_id", "status");

-- CreateIndex
CREATE INDEX "flow_executions_organization_id_entity_type_entity_id_idx" ON "flow_executions"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "flow_executions_resumable_status_idx" ON "flow_executions"("resumable", "status");

-- CreateIndex
CREATE INDEX "cleanup_metrics_created_at_idx" ON "cleanup_metrics"("created_at");

-- CreateIndex
CREATE INDEX "cleanup_metrics_cleanup_type_created_at_idx" ON "cleanup_metrics"("cleanup_type", "created_at");

-- CreateIndex
CREATE INDEX "conversation_history_configs_organization_id_idx" ON "conversation_history_configs"("organization_id");

-- CreateIndex
CREATE INDEX "conversation_history_configs_flow_type_idx" ON "conversation_history_configs"("flow_type");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_history_configs_organization_id_flow_type_key" ON "conversation_history_configs"("organization_id", "flow_type");

-- CreateIndex
CREATE INDEX "user_suggestions_organization_id_project_id_idx" ON "user_suggestions"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "user_suggestions_email_idx" ON "user_suggestions"("email");

-- CreateIndex
CREATE INDEX "user_suggestions_last_seen_idx" ON "user_suggestions"("last_seen");

-- CreateIndex
CREATE INDEX "user_suggestions_sources_idx" ON "user_suggestions"("sources");

-- CreateIndex
CREATE UNIQUE INDEX "user_suggestions_organization_id_project_id_email_key" ON "user_suggestions"("organization_id", "project_id", "email");

-- CreateIndex
CREATE INDEX "suggestion_decisions_organization_id_type_idx" ON "suggestion_decisions"("organization_id", "type");

-- CreateIndex
CREATE INDEX "suggestion_decisions_organization_id_source_conversation_id_idx" ON "suggestion_decisions"("organization_id", "source_conversation_id");

-- CreateIndex
CREATE INDEX "suggestion_decisions_organization_id_source_message_id_idx" ON "suggestion_decisions"("organization_id", "source_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "llm_prompt_responses_request_id_key" ON "llm_prompt_responses"("request_id");

-- CreateIndex
CREATE INDEX "llm_prompt_responses_organization_id_created_at_idx" ON "llm_prompt_responses"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "llm_prompt_responses_workflow_id_created_at_idx" ON "llm_prompt_responses"("workflow_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "llm_prompt_responses_node_id_node_type_idx" ON "llm_prompt_responses"("node_id", "node_type");

-- CreateIndex
CREATE INDEX "llm_prompt_responses_provider_model_idx" ON "llm_prompt_responses"("provider", "model");

-- CreateIndex
CREATE INDEX "llm_prompt_responses_success_idx" ON "llm_prompt_responses"("success");

-- CreateIndex
CREATE INDEX "unified_search_logs_organization_id_created_at_idx" ON "unified_search_logs"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "unified_search_logs_project_id_created_at_idx" ON "unified_search_logs"("project_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "unified_search_logs_conversation_id_created_at_idx" ON "unified_search_logs"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "unified_search_logs_message_id_created_at_idx" ON "unified_search_logs"("message_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "unified_search_logs_request_id_created_at_idx" ON "unified_search_logs"("request_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "analytics_event_batches_batch_id_key" ON "analytics_event_batches"("batch_id");

-- CreateIndex
CREATE INDEX "analytics_event_batches_organization_id_created_at_idx" ON "analytics_event_batches"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_events_event_id_key" ON "analytics_events"("event_id");

-- CreateIndex
CREATE INDEX "analytics_events_batch_id_idx" ON "analytics_events"("batch_id");

-- CreateIndex
CREATE INDEX "analytics_events_organization_id_timestamp_idx" ON "analytics_events"("organization_id", "timestamp");

-- CreateIndex
CREATE INDEX "analytics_events_category_action_idx" ON "analytics_events"("category", "action");

-- CreateIndex
CREATE INDEX "entity_registry_entity_id_idx" ON "entity_registry"("entity_id");

-- CreateIndex
CREATE INDEX "entity_registry_organization_id_idx" ON "entity_registry"("organization_id");

-- CreateIndex
CREATE INDEX "entity_registry_name_search_text_trgm_idx" ON "entity_registry" USING GIN ("name_search_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "entity_registry_organization_id_entity_type_deleted_at_idx" ON "entity_registry"("organization_id", "entity_type", "deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "entity_registry_org_entity_id_type_key" ON "entity_registry"("organization_id", "entity_id", "entity_type");

-- CreateIndex
CREATE INDEX "entity_graph_embedding_map_graph_node_id_idx" ON "entity_graph_embedding_mappings"("graph_node_id");

-- CreateIndex
CREATE INDEX "entity_graph_embedding_map_embedding_id_idx" ON "entity_graph_embedding_mappings"("embedding_id");

-- CreateIndex
CREATE INDEX "entity_graph_embedding_map_org_graph_node_id_idx" ON "entity_graph_embedding_mappings"("organization_id", "graph_node_id");

-- CreateIndex
CREATE INDEX "entity_graph_embedding_map_org_embedding_id_idx" ON "entity_graph_embedding_mappings"("organization_id", "embedding_id");

-- CreateIndex
CREATE INDEX "entity_graph_embedding_map_org_type_idx" ON "entity_graph_embedding_mappings"("organization_id", "entity_type");

-- CreateIndex
CREATE UNIQUE INDEX "entity_graph_embedding_map_org_entity_key" ON "entity_graph_embedding_mappings"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_doc_sections_design_doc_id_key_key" ON "design_doc_sections"("design_doc_id", "key");

-- CreateIndex
CREATE INDEX "design_doc_section_updates_section_id_seq_idx" ON "design_doc_section_updates"("section_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "design_doc_section_updates_section_id_update_hash_key" ON "design_doc_section_updates"("section_id", "update_hash");

-- CreateIndex
CREATE INDEX "design_doc_task_relations_task_id_idx" ON "design_doc_task_relations"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_doc_task_relations_design_doc_id_task_id_key" ON "design_doc_task_relations"("design_doc_id", "task_id");

-- CreateIndex
CREATE INDEX "design_doc_initiative_relations_initiative_id_idx" ON "design_doc_initiative_relations"("initiative_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_doc_initiative_relations_design_doc_id_initiative_id_key" ON "design_doc_initiative_relations"("design_doc_id", "initiative_id");

-- CreateIndex
CREATE INDEX "design_doc_design_doc_relations_child_design_doc_id_idx" ON "design_doc_design_doc_relations"("child_design_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "design_doc_design_doc_relations_parent_design_doc_id_child__key" ON "design_doc_design_doc_relations"("parent_design_doc_id", "child_design_doc_id");

-- CreateIndex
CREATE INDEX "subfacets_organization_id_project_id_category_idx" ON "subfacets"("organization_id", "project_id", "category");

-- CreateIndex
CREATE UNIQUE INDEX "subfacets_organization_id_project_id_category_slug_key" ON "subfacets"("organization_id", "project_id", "category", "slug");

-- CreateIndex
CREATE INDEX "entity_summaries_organization_id_project_id_entity_type_ent_idx" ON "entity_summaries"("organization_id", "project_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "entity_summary_org_project_current_updated_idx" ON "entity_summaries"("organization_id", "project_id", "is_current", "updated_at");

-- CreateIndex
CREATE INDEX "entity_summary_entity_lookup_idx" ON "entity_summaries"("entity_type", "entity_id", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_summaries_entity_type_entity_id_version_project_id_key" ON "entity_summaries"("entity_type", "entity_id", "version", "project_id");

-- CreateIndex
CREATE INDEX "entity_subfacets_entity_type_entity_id_project_id_idx" ON "entity_subfacets"("entity_type", "entity_id", "project_id");

-- CreateIndex
CREATE INDEX "entity_subfacets_organization_id_project_id_idx" ON "entity_subfacets"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "entity_subfacets_org_project_subfacet_summary_idx" ON "entity_subfacets"("organization_id", "project_id", "subfacet_id", "summary_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_subfacets_summary_id_subfacet_id_key" ON "entity_subfacets"("summary_id", "subfacet_id");

-- CreateIndex
CREATE UNIQUE INDEX "entity_subfacets_summary_id_rank_key" ON "entity_subfacets"("summary_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "entity_subfacets_entity_type_entity_id_subfacet_id_summary__key" ON "entity_subfacets"("entity_type", "entity_id", "subfacet_id", "summary_id", "organization_id", "project_id");

-- CreateIndex
CREATE INDEX "subfacet_consolidation_runs_org_proj_cat_created_idx" ON "subfacet_consolidation_runs"("organization_id", "project_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "subfacet_consolidation_runs_run_created_idx" ON "subfacet_consolidation_runs"("topology_consolidation_run_id", "created_at");

-- CreateIndex
CREATE INDEX "category_consolidation_runs_org_proj_cat_created_idx" ON "category_consolidation_runs"("organization_id", "project_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "category_consolidation_runs_run_created_idx" ON "category_consolidation_runs"("topology_consolidation_run_id", "created_at");

-- CreateIndex
CREATE INDEX "subfacet_summarization_runs_org_proj_cat_created_idx" ON "subfacet_summarization_runs"("organization_id", "project_id", "category", "created_at");

-- CreateIndex
CREATE INDEX "subfacet_summarization_runs_run_created_idx" ON "subfacet_summarization_runs"("topology_consolidation_run_id", "created_at");

-- CreateIndex
CREATE INDEX "topology_consolidation_schedule_status_next_run_idx" ON "topology_consolidation_schedule"("status", "next_run_at");

-- CreateIndex
CREATE UNIQUE INDEX "topology_consolidation_schedule_org_project_key" ON "topology_consolidation_schedule"("organization_id", "project_id");

-- CreateIndex
CREATE INDEX "topology_consolidation_run_org_project_created_idx" ON "topology_consolidation_run"("organization_id", "project_id", "created_at");

-- CreateIndex
CREATE INDEX "topology_consolidation_run_schedule_status_created_idx" ON "topology_consolidation_run"("schedule_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "topology_consolidation_run_temporal_workflow_id_key" ON "topology_consolidation_run"("temporal_workflow_id");

-- CreateIndex
CREATE INDEX "topology_consolidation_entity_state_org_project_status_idx" ON "topology_consolidation_entity_state"("organization_id", "project_id", "status");

-- CreateIndex
CREATE INDEX "topology_consolidation_entity_state_run_id_idx" ON "topology_consolidation_entity_state"("last_processed_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "topology_consolidation_entity_state_org_project_entity_key" ON "topology_consolidation_entity_state"("organization_id", "project_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "topology_subfacet_candidate_org_project_category_last_seen_idx" ON "topology_subfacet_candidate"("organization_id", "project_id", "category", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "topology_subfacet_candidate_org_project_category_slug_key" ON "topology_subfacet_candidate"("organization_id", "project_id", "category", "normalized_slug");

-- CreateIndex
CREATE INDEX "coding_sessions_organization_id_session_date_idx" ON "coding_sessions"("organization_id", "session_date");

-- CreateIndex
CREATE INDEX "coding_sessions_user_id_session_date_idx" ON "coding_sessions"("user_id", "session_date");

-- CreateIndex
CREATE INDEX "coding_sessions_conversation_id_idx" ON "coding_sessions"("conversation_id");

-- CreateIndex
CREATE INDEX "coding_sessions_initiative_id_idx" ON "coding_sessions"("initiative_id");

-- CreateIndex
CREATE INDEX "coding_sessions_task_id_idx" ON "coding_sessions"("task_id");

-- CreateIndex
CREATE INDEX "coding_sessions_design_doc_id_idx" ON "coding_sessions"("design_doc_id");

-- CreateIndex
CREATE INDEX "coding_prompts_organization_id_coding_session_id_idx" ON "coding_prompts"("organization_id", "coding_session_id");

-- CreateIndex
CREATE INDEX "coding_prompts_coding_session_id_idx" ON "coding_prompts"("coding_session_id");

-- CreateIndex
CREATE INDEX "coding_prompts_accepted_by_idx" ON "coding_prompts"("accepted_by");

-- CreateIndex
CREATE INDEX "attention_events_organization_id_user_id_created_at_idx" ON "attention_events"("organization_id", "user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "attention_events_organization_id_user_id_entity_id_created__idx" ON "attention_events"("organization_id", "user_id", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "attention_events_organization_id_created_at_idx" ON "attention_events"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "attention_events_organization_id_user_id_entity_type_entity_key" ON "attention_events"("organization_id", "user_id", "entity_type", "entity_id", "focus_start");

-- CreateIndex
CREATE INDEX "services_organization_id_idx" ON "services"("organization_id");

-- CreateIndex
CREATE INDEX "services_project_id_idx" ON "services"("project_id");

-- CreateIndex
CREATE INDEX "services_repository_url_idx" ON "services"("repository_url");

-- CreateIndex
CREATE INDEX "services_service_type_idx" ON "services"("service_type");

-- CreateIndex
CREATE INDEX "services_organization_id_status_idx" ON "services"("organization_id", "status");

-- CreateIndex
CREATE INDEX "implementation_hints_service_id_idx" ON "implementation_hints"("service_id");

-- CreateIndex
CREATE INDEX "implementation_hints_created_at_idx" ON "implementation_hints"("created_at");

-- CreateIndex
CREATE INDEX "implementation_hints_extracted_from_idx" ON "implementation_hints"("extracted_from");

-- CreateIndex
CREATE INDEX "implementation_hints_confidence_idx" ON "implementation_hints"("confidence");

-- CreateIndex
CREATE INDEX "implementation_hint_versions_hint_id_idx" ON "implementation_hint_versions"("hint_id");

-- CreateIndex
CREATE INDEX "implementation_hint_versions_created_at_idx" ON "implementation_hint_versions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "implementation_hint_versions_hint_id_version_key" ON "implementation_hint_versions"("hint_id", "version");

-- CreateIndex
CREATE INDEX "implementation_hint_file_references_hint_id_idx" ON "implementation_hint_file_references"("hint_id");

-- CreateIndex
CREATE INDEX "implementation_hint_file_references_file_path_idx" ON "implementation_hint_file_references"("file_path");

-- CreateIndex
CREATE INDEX "implementation_hint_file_references_hint_id_file_path_idx" ON "implementation_hint_file_references"("hint_id", "file_path");

-- CreateIndex
CREATE INDEX "implementation_hint_coding_sessions_implementation_hint_id_idx" ON "implementation_hint_coding_sessions"("implementation_hint_id");

-- CreateIndex
CREATE INDEX "implementation_hint_coding_sessions_coding_session_id_idx" ON "implementation_hint_coding_sessions"("coding_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "implementation_hint_coding_sessions_implementation_hint_id__key" ON "implementation_hint_coding_sessions"("implementation_hint_id", "coding_session_id");

-- CreateIndex
CREATE INDEX "implementation_hint_coding_prompts_implementation_hint_id_idx" ON "implementation_hint_coding_prompts"("implementation_hint_id");

-- CreateIndex
CREATE INDEX "implementation_hint_coding_prompts_coding_prompt_id_idx" ON "implementation_hint_coding_prompts"("coding_prompt_id");

-- CreateIndex
CREATE UNIQUE INDEX "implementation_hint_coding_prompts_implementation_hint_id_c_key" ON "implementation_hint_coding_prompts"("implementation_hint_id", "coding_prompt_id");

-- CreateIndex
CREATE INDEX "service_tasks_service_id_idx" ON "service_tasks"("service_id");

-- CreateIndex
CREATE INDEX "service_tasks_task_id_idx" ON "service_tasks"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_tasks_service_id_task_id_key" ON "service_tasks"("service_id", "task_id");

-- CreateIndex
CREATE INDEX "service_initiatives_service_id_idx" ON "service_initiatives"("service_id");

-- CreateIndex
CREATE INDEX "service_initiatives_initiative_id_idx" ON "service_initiatives"("initiative_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_initiatives_service_id_initiative_id_key" ON "service_initiatives"("service_id", "initiative_id");

-- CreateIndex
CREATE INDEX "service_design_docs_service_id_idx" ON "service_design_docs"("service_id");

-- CreateIndex
CREATE INDEX "service_design_docs_design_doc_id_idx" ON "service_design_docs"("design_doc_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_design_docs_service_id_design_doc_id_key" ON "service_design_docs"("service_id", "design_doc_id");

-- CreateIndex
CREATE INDEX "service_coding_sessions_service_id_idx" ON "service_coding_sessions"("service_id");

-- CreateIndex
CREATE INDEX "service_coding_sessions_coding_session_id_idx" ON "service_coding_sessions"("coding_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_coding_sessions_service_id_coding_session_id_key" ON "service_coding_sessions"("service_id", "coding_session_id");

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_mentions" ADD CONSTRAINT "message_mentions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_originating_project_id_fkey" FOREIGN KEY ("originating_project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plans" ADD CONSTRAINT "plans_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_stages" ADD CONSTRAINT "plan_stages_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_execution_guidance" ADD CONSTRAINT "plan_execution_guidance_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_execution_guidance" ADD CONSTRAINT "plan_execution_guidance_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "plan_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "plan_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_steps" ADD CONSTRAINT "plan_steps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_step_relations" ADD CONSTRAINT "plan_step_relations_step_id_fkey" FOREIGN KEY ("step_id") REFERENCES "plan_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_step_relations" ADD CONSTRAINT "plan_step_relations_related_step_id_fkey" FOREIGN KEY ("related_step_id") REFERENCES "plan_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_relationships" ADD CONSTRAINT "plan_relationships_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_relationships" ADD CONSTRAINT "plan_relationships_plan_stage_id_fkey" FOREIGN KEY ("plan_stage_id") REFERENCES "plan_stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_relationships" ADD CONSTRAINT "plan_relationships_plan_step_id_fkey" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sign_offs" ADD CONSTRAINT "plan_sign_offs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sign_offs" ADD CONSTRAINT "plan_sign_offs_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_sign_offs" ADD CONSTRAINT "plan_sign_offs_signer_id_fkey" FOREIGN KEY ("signer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_last_modified_by_fkey" FOREIGN KEY ("last_modified_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_originating_project_id_fkey" FOREIGN KEY ("originating_project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_sections" ADD CONSTRAINT "initiative_sections_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "initiative_section_updates" ADD CONSTRAINT "initiative_section_updates_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "initiative_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_initiatives" ADD CONSTRAINT "project_initiatives_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_initiatives" ADD CONSTRAINT "project_initiatives_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_fkey" FOREIGN KEY ("parent_task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_sections" ADD CONSTRAINT "task_sections_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_section_updates" ADD CONSTRAINT "task_section_updates_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "task_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependent_task_id_fkey" FOREIGN KEY ("dependent_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_dependency_task_id_fkey" FOREIGN KEY ("dependency_task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_tasks" ADD CONSTRAINT "artifact_tasks_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_tasks" ADD CONSTRAINT "artifact_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_relations" ADD CONSTRAINT "artifact_relations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_relations" ADD CONSTRAINT "artifact_relations_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "artifacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_entities" ADD CONSTRAINT "report_entities_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "influences" ADD CONSTRAINT "influences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_stars" ADD CONSTRAINT "entity_stars_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_stars" ADD CONSTRAINT "entity_stars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhooks" ADD CONSTRAINT "integration_webhooks_integration_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_flow_permissions" ADD CONSTRAINT "organization_flow_permissions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_history_configs" ADD CONSTRAINT "conversation_history_configs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_suggestions" ADD CONSTRAINT "user_suggestions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_suggestions" ADD CONSTRAINT "user_suggestions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_decisions" ADD CONSTRAINT "suggestion_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suggestion_decisions" ADD CONSTRAINT "suggestion_decisions_source_conversation_id_fkey" FOREIGN KEY ("source_conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_prompt_responses" ADD CONSTRAINT "llm_prompt_responses_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_prompt_responses" ADD CONSTRAINT "llm_prompt_responses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_prompt_responses" ADD CONSTRAINT "llm_prompt_responses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_prompt_responses" ADD CONSTRAINT "llm_prompt_responses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unified_search_logs" ADD CONSTRAINT "unified_search_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unified_search_logs" ADD CONSTRAINT "unified_search_logs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unified_search_logs" ADD CONSTRAINT "unified_search_logs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unified_search_logs" ADD CONSTRAINT "unified_search_logs_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_batch_internal_id_fkey" FOREIGN KEY ("batch_internal_id") REFERENCES "analytics_event_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_registry" ADD CONSTRAINT "entity_registry_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_docs" ADD CONSTRAINT "design_docs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_docs" ADD CONSTRAINT "design_docs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_sections" ADD CONSTRAINT "design_doc_sections_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_section_updates" ADD CONSTRAINT "design_doc_section_updates_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "design_doc_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_task_relations" ADD CONSTRAINT "design_doc_task_relations_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_task_relations" ADD CONSTRAINT "design_doc_task_relations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_initiative_relations" ADD CONSTRAINT "design_doc_initiative_relations_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_initiative_relations" ADD CONSTRAINT "design_doc_initiative_relations_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_design_doc_relations" ADD CONSTRAINT "design_doc_design_doc_relations_parent_design_doc_id_fkey" FOREIGN KEY ("parent_design_doc_id") REFERENCES "design_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_doc_design_doc_relations" ADD CONSTRAINT "design_doc_design_doc_relations_child_design_doc_id_fkey" FOREIGN KEY ("child_design_doc_id") REFERENCES "design_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacets" ADD CONSTRAINT "subfacets_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacets" ADD CONSTRAINT "subfacets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_summaries" ADD CONSTRAINT "entity_summaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_summaries" ADD CONSTRAINT "entity_summaries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_subfacets" ADD CONSTRAINT "entity_subfacets_summary_id_fkey" FOREIGN KEY ("summary_id") REFERENCES "entity_summaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entity_subfacets" ADD CONSTRAINT "entity_subfacets_subfacet_id_fkey" FOREIGN KEY ("subfacet_id") REFERENCES "subfacets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_category_summaries" ADD CONSTRAINT "topology_category_summaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_category_summaries" ADD CONSTRAINT "topology_category_summaries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_consolidation_runs" ADD CONSTRAINT "subfacet_consolidation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_consolidation_runs" ADD CONSTRAINT "subfacet_consolidation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_consolidation_runs" ADD CONSTRAINT "subfacet_consolidation_runs_topology_consolidation_run_id_fkey" FOREIGN KEY ("topology_consolidation_run_id") REFERENCES "topology_consolidation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_consolidation_runs" ADD CONSTRAINT "category_consolidation_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_consolidation_runs" ADD CONSTRAINT "category_consolidation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_consolidation_runs" ADD CONSTRAINT "category_consolidation_runs_topology_consolidation_run_id_fkey" FOREIGN KEY ("topology_consolidation_run_id") REFERENCES "topology_consolidation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_summarization_runs" ADD CONSTRAINT "subfacet_summarization_runs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_summarization_runs" ADD CONSTRAINT "subfacet_summarization_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_summarization_runs" ADD CONSTRAINT "subfacet_summarization_runs_subfacet_id_fkey" FOREIGN KEY ("subfacet_id") REFERENCES "subfacets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subfacet_summarization_runs" ADD CONSTRAINT "subfacet_summarization_runs_topology_consolidation_run_id_fkey" FOREIGN KEY ("topology_consolidation_run_id") REFERENCES "topology_consolidation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_schedule" ADD CONSTRAINT "topology_consolidation_schedule_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_schedule" ADD CONSTRAINT "topology_consolidation_schedule_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_run" ADD CONSTRAINT "topology_consolidation_run_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "topology_consolidation_schedule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_run" ADD CONSTRAINT "topology_consolidation_run_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_run" ADD CONSTRAINT "topology_consolidation_run_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_entity_state" ADD CONSTRAINT "topology_consolidation_entity_state_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_entity_state" ADD CONSTRAINT "topology_consolidation_entity_state_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_consolidation_entity_state" ADD CONSTRAINT "topology_consolidation_entity_state_last_processed_run_id_fkey" FOREIGN KEY ("last_processed_run_id") REFERENCES "topology_consolidation_run"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_subfacet_candidate" ADD CONSTRAINT "topology_subfacet_candidate_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "topology_subfacet_candidate" ADD CONSTRAINT "topology_subfacet_candidate_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_sessions" ADD CONSTRAINT "coding_sessions_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_prompts" ADD CONSTRAINT "coding_prompts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_prompts" ADD CONSTRAINT "coding_prompts_coding_session_id_fkey" FOREIGN KEY ("coding_session_id") REFERENCES "coding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coding_prompts" ADD CONSTRAINT "coding_prompts_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hints" ADD CONSTRAINT "implementation_hints_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hint_versions" ADD CONSTRAINT "implementation_hint_versions_hint_id_fkey" FOREIGN KEY ("hint_id") REFERENCES "implementation_hints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hint_file_references" ADD CONSTRAINT "implementation_hint_file_references_hint_id_fkey" FOREIGN KEY ("hint_id") REFERENCES "implementation_hints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hint_coding_sessions" ADD CONSTRAINT "implementation_hint_coding_sessions_implementation_hint_id_fkey" FOREIGN KEY ("implementation_hint_id") REFERENCES "implementation_hints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hint_coding_sessions" ADD CONSTRAINT "implementation_hint_coding_sessions_coding_session_id_fkey" FOREIGN KEY ("coding_session_id") REFERENCES "coding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hint_coding_prompts" ADD CONSTRAINT "implementation_hint_coding_prompts_implementation_hint_id_fkey" FOREIGN KEY ("implementation_hint_id") REFERENCES "implementation_hints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_hint_coding_prompts" ADD CONSTRAINT "implementation_hint_coding_prompts_coding_prompt_id_fkey" FOREIGN KEY ("coding_prompt_id") REFERENCES "coding_prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_tasks" ADD CONSTRAINT "service_tasks_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_tasks" ADD CONSTRAINT "service_tasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_initiatives" ADD CONSTRAINT "service_initiatives_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_initiatives" ADD CONSTRAINT "service_initiatives_initiative_id_fkey" FOREIGN KEY ("initiative_id") REFERENCES "initiatives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_design_docs" ADD CONSTRAINT "service_design_docs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_design_docs" ADD CONSTRAINT "service_design_docs_design_doc_id_fkey" FOREIGN KEY ("design_doc_id") REFERENCES "design_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_coding_sessions" ADD CONSTRAINT "service_coding_sessions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_coding_sessions" ADD CONSTRAINT "service_coding_sessions_coding_session_id_fkey" FOREIGN KEY ("coding_session_id") REFERENCES "coding_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

