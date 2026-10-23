-- Enable cascading deletes from organizations to all child tables.
-- Previously these used ON DELETE RESTRICT which blocks organization removal.
-- conversation_history_configs keeps SET NULL (nullable org FK).

-- api_keys
ALTER TABLE "api_keys" DROP CONSTRAINT "api_keys_organization_id_fkey";
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- organization_members
ALTER TABLE "organization_members" DROP CONSTRAINT "organization_members_organization_id_fkey";
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- feature_flags
ALTER TABLE "feature_flags" DROP CONSTRAINT "feature_flags_organization_id_fkey";
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- conversations
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_organization_id_fkey";
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- projects
ALTER TABLE "projects" DROP CONSTRAINT "projects_organization_id_fkey";
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- plans
ALTER TABLE "plans" DROP CONSTRAINT "plans_organization_id_fkey";
ALTER TABLE "plans" ADD CONSTRAINT "plans_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- initiatives
ALTER TABLE "initiatives" DROP CONSTRAINT "initiatives_organization_id_fkey";
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tasks
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_organization_id_fkey";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- artifacts
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_organization_id_fkey";
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- reports
ALTER TABLE "reports" DROP CONSTRAINT "reports_organization_id_fkey";
ALTER TABLE "reports" ADD CONSTRAINT "reports_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- influences
ALTER TABLE "influences" DROP CONSTRAINT "influences_organization_id_fkey";
ALTER TABLE "influences" ADD CONSTRAINT "influences_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- tags
ALTER TABLE "tags" DROP CONSTRAINT "tags_organization_id_fkey";
ALTER TABLE "tags" ADD CONSTRAINT "tags_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- entity_stars
ALTER TABLE "entity_stars" DROP CONSTRAINT "entity_stars_organization_id_fkey";
ALTER TABLE "entity_stars" ADD CONSTRAINT "entity_stars_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- integrations
ALTER TABLE "integrations" DROP CONSTRAINT "integrations_organization_id_fkey";
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_organizations
ALTER TABLE "user_organizations" DROP CONSTRAINT "user_organizations_organization_id_fkey";
ALTER TABLE "user_organizations" ADD CONSTRAINT "user_organizations_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- organization_flow_permissions
ALTER TABLE "organization_flow_permissions" DROP CONSTRAINT "organization_flow_permissions_organization_id_fkey";
ALTER TABLE "organization_flow_permissions" ADD CONSTRAINT "organization_flow_permissions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- flow_executions
ALTER TABLE "flow_executions" DROP CONSTRAINT "flow_executions_organization_id_fkey";
ALTER TABLE "flow_executions" ADD CONSTRAINT "flow_executions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- user_suggestions
ALTER TABLE "user_suggestions" DROP CONSTRAINT "user_suggestions_organization_id_fkey";
ALTER TABLE "user_suggestions" ADD CONSTRAINT "user_suggestions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- suggestion_decisions
ALTER TABLE "suggestion_decisions" DROP CONSTRAINT "suggestion_decisions_organization_id_fkey";
ALTER TABLE "suggestion_decisions" ADD CONSTRAINT "suggestion_decisions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- llm_prompt_responses
ALTER TABLE "llm_prompt_responses" DROP CONSTRAINT "llm_prompt_responses_organization_id_fkey";
ALTER TABLE "llm_prompt_responses" ADD CONSTRAINT "llm_prompt_responses_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- unified_search_logs
ALTER TABLE "unified_search_logs" DROP CONSTRAINT "unified_search_logs_organization_id_fkey";
ALTER TABLE "unified_search_logs" ADD CONSTRAINT "unified_search_logs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- entity_registry
ALTER TABLE "entity_registry" DROP CONSTRAINT "entity_registry_organization_id_fkey";
ALTER TABLE "entity_registry" ADD CONSTRAINT "entity_registry_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- design_docs
ALTER TABLE "design_docs" DROP CONSTRAINT "design_docs_organization_id_fkey";
ALTER TABLE "design_docs" ADD CONSTRAINT "design_docs_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- services
ALTER TABLE "services" DROP CONSTRAINT "services_organization_id_fkey";
ALTER TABLE "services" ADD CONSTRAINT "services_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
