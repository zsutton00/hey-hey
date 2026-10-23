CREATE TYPE work_item_change_set_materialization_status AS ENUM (
  'PREPARED',
  'APPLYING',
  'PUBLISHING',
  'PUBLISHED'
);

CREATE TYPE work_item_change_set_checkpoint_status AS ENUM (
  'PENDING',
  'APPLYING',
  'COMPLETED',
  'FAILED'
);

CREATE TABLE work_item_change_set_materializations (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  root_work_item_id TEXT,
  validation_revision TEXT NOT NULL,
  status work_item_change_set_materialization_status NOT NULL DEFAULT 'PREPARED',
  operation_set JSONB NOT NULL,
  work_item_id_mappings JSONB NOT NULL,
  relationship_id_mappings JSONB NOT NULL,
  prior_published_projection JSONB NOT NULL,
  prior_projection_revision TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX work_item_change_set_materializations_scope_status_idx
  ON work_item_change_set_materializations(organization_id, project_id, status);
CREATE INDEX work_item_change_set_materializations_root_status_idx
  ON work_item_change_set_materializations(root_work_item_id, status);

CREATE TABLE work_item_change_set_materialization_checkpoints (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  materialization_id TEXT NOT NULL REFERENCES work_item_change_set_materializations(id) ON DELETE CASCADE,
  operation_index INTEGER NOT NULL,
  operation_kind TEXT NOT NULL,
  validation_revision TEXT NOT NULL,
  status work_item_change_set_checkpoint_status NOT NULL DEFAULT 'PENDING',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  last_attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT work_item_change_set_checkpoint_operation_unique
    UNIQUE(materialization_id, operation_index)
);

CREATE INDEX work_item_change_set_checkpoints_materialization_status_idx
  ON work_item_change_set_materialization_checkpoints(materialization_id, status);
