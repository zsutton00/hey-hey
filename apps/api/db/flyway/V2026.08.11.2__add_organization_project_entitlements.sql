CREATE TABLE organization_project_entitlements (
  organization_id TEXT PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,
  project_limit_override INTEGER
    CHECK (project_limit_override IS NULL OR project_limit_override >= 0),
  updated_by TEXT
    REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE organization_capacity_usage (
  organization_id TEXT PRIMARY KEY
    REFERENCES organizations(id) ON DELETE CASCADE,
  project_count INTEGER NOT NULL CHECK (project_count >= 0),
  work_item_count INTEGER NOT NULL CHECK (work_item_count >= 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO organization_capacity_usage (
  organization_id,
  project_count,
  work_item_count,
  observed_at
)
SELECT
  organization.id,
  COUNT(DISTINCT project.id) FILTER (WHERE project.deleted_at IS NULL),
  COUNT(DISTINCT task.id) FILTER (WHERE task.archived_at IS NULL),
  now()
FROM organizations AS organization
LEFT JOIN projects AS project
  ON project.organization_id = organization.id
LEFT JOIN tasks AS task
  ON task.organization_id = organization.id
GROUP BY organization.id;
