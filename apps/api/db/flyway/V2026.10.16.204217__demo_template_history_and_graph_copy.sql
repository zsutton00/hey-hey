-- Designations belong to their project; historical rows must not pin tenancy.
ALTER TABLE demo_templates DROP CONSTRAINT demo_templates_project_id_fkey;
ALTER TABLE demo_templates ADD CONSTRAINT demo_templates_project_id_fkey
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

CREATE TABLE demo_graph_copy_intents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  command JSONB NOT NULL,
  completed_at TIMESTAMP(3),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX demo_graph_copy_intents_pending_idx
  ON demo_graph_copy_intents(completed_at, next_attempt_at);
