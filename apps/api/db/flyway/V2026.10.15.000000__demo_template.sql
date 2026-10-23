CREATE TABLE demo_templates (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
    repository_url TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX demo_templates_project_id_idx ON demo_templates(project_id);
CREATE UNIQUE INDEX demo_templates_one_active_idx ON demo_templates(active) WHERE active;
