ALTER TYPE "target_entity_type" ADD VALUE IF NOT EXISTS 'ENTITY_PROMPT_TEMPLATE';

CREATE TYPE entity_prompt_template_ownership_scope AS ENUM (
  'CANONICAL',
  'PROJECT'
);

CREATE TYPE entity_prompt_template_lifecycle_state AS ENUM (
  'DRAFT',
  'UNPUBLISHED',
  'PUBLISHED',
  'RETIRED'
);

CREATE TYPE entity_prompt_template_validation_status AS ENUM (
  'UNVALIDATED',
  'VALID',
  'INVALID'
);

CREATE TABLE entity_prompt_template_revisions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  template_key TEXT NOT NULL,
  selector JSONB NOT NULL,
  syntax_version TEXT NOT NULL,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  content TEXT NOT NULL CHECK (length(content) > 0),
  ownership_scope entity_prompt_template_ownership_scope NOT NULL,
  project_id TEXT,
  lifecycle_state entity_prompt_template_lifecycle_state NOT NULL,
  validation_status entity_prompt_template_validation_status NOT NULL,
  validation_issues JSONB NOT NULL,
  validated_at TIMESTAMPTZ,
  validator_version TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  CONSTRAINT entity_prompt_template_revisions_scope_owner_check CHECK (
    (ownership_scope = 'CANONICAL' AND project_id IS NULL)
    OR (ownership_scope = 'PROJECT' AND project_id IS NOT NULL)
  ),
  CONSTRAINT entity_prompt_template_revisions_validation_issues_check CHECK (
    jsonb_typeof(validation_issues) = 'array'
  ),
  CONSTRAINT entity_prompt_template_revisions_selector_check CHECK (
    jsonb_typeof(selector) = 'object'
  ),
  CONSTRAINT entity_prompt_template_revisions_syntax_version_check CHECK (
    syntax_version = 'V1'
  ),
  CONSTRAINT entity_prompt_template_revisions_project_fkey
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX entity_prompt_template_revisions_canonical_revision_key
  ON entity_prompt_template_revisions (template_key, revision_number)
  WHERE ownership_scope = 'CANONICAL';

CREATE UNIQUE INDEX entity_prompt_template_revisions_project_revision_key
  ON entity_prompt_template_revisions (project_id, template_key, revision_number)
  WHERE ownership_scope = 'PROJECT';

CREATE UNIQUE INDEX entity_prompt_template_revisions_canonical_published_key
  ON entity_prompt_template_revisions (template_key)
  WHERE ownership_scope = 'CANONICAL' AND lifecycle_state = 'PUBLISHED';

CREATE UNIQUE INDEX entity_prompt_template_revisions_project_published_key
  ON entity_prompt_template_revisions (project_id, template_key)
  WHERE ownership_scope = 'PROJECT' AND lifecycle_state = 'PUBLISHED';

CREATE INDEX entity_prompt_template_revisions_history_idx
  ON entity_prompt_template_revisions (
    template_key,
    ownership_scope,
    project_id,
    revision_number DESC
  );

CREATE INDEX entity_prompt_template_revisions_effective_idx
  ON entity_prompt_template_revisions (
    project_id,
    template_key,
    lifecycle_state,
    validation_status
  );

INSERT INTO entity_prompt_template_revisions (
  template_key,
  selector,
  syntax_version,
  revision_number,
  content,
  ownership_scope,
  lifecycle_state,
  validation_status,
  validation_issues,
  validated_at,
  validator_version,
  published_at
)
VALUES
  ('entity_context.project', '{"entityType":"PROJECT"}'::jsonb, 'V1', 1, 'Use {{entity.id}} and {{context.projectId}} as authoritative project context. Preserve entity types, hierarchy, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.plan', '{"entityType":"PLAN"}'::jsonb, 'V1', 1, 'Use {{entity.id}} and {{context.projectId}} as authoritative plan context. Preserve stages, steps, design decisions, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.design_doc', '{"entityType":"DESIGN_DOC"}'::jsonb, 'V1', 1, 'Use {{entity.id}} and {{context.projectId}} as authoritative design-document context. Preserve decisions, requirements, linked implementation work, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.agent_session', '{"entityType":"AGENT_SESSION"}'::jsonb, 'V1', 1, 'Use {{entity.id}} and {{session.id}} as authoritative Agent Session context. Preserve task, messages, decisions, handoffs, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.standard', '{"entityType":"WORK_ITEM","workItemTypeKey":"STANDARD"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.projectId}} as authoritative Work Item context. Preserve type, hierarchy, requirements, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.feature', '{"entityType":"WORK_ITEM","workItemTypeKey":"FEATURE"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.projectId}} as authoritative Feature context. Preserve product intent, requirements, hierarchy, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.goal', '{"entityType":"WORK_ITEM","workItemTypeKey":"GOAL"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.projectId}} as authoritative Goal context. Preserve outcome, scope, linked work, hierarchy, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.bug', '{"entityType":"WORK_ITEM","workItemTypeKey":"BUG"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.projectId}} as authoritative Bug context. Preserve the defect, required fix, affected hierarchy, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.workflow', '{"entityType":"WORK_ITEM","workItemTypeKey":"WORKFLOW"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.projectId}} as authoritative Workflow context. Preserve purpose, steps, handoffs, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP),
  ('entity_context.work_item.workflow_step', '{"entityType":"WORK_ITEM","workItemTypeKey":"WORKFLOW_STEP"}'::jsonb, 'V1', 1, 'Use {{entity.id}}, {{entity.type}}, and {{context.projectId}} as authoritative Workflow Step context. Preserve state, action, handoff, links, and provenance. Do not invent missing fields or relationships.', 'CANONICAL', 'PUBLISHED', 'VALID', '[]'::jsonb, CURRENT_TIMESTAMP, 'entity-prompt-template-v1', CURRENT_TIMESTAMP);
