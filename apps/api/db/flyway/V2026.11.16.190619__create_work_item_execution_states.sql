-- Latest owner-reported execution state of a participating work item.
-- One row per work item, updated in place: this is neither execution history
-- nor ordinary work-item status. source_revision orders reports from one
-- owner; revision is platform-assigned and orders every accepted change.
CREATE TABLE work_item_execution_states (
  work_item_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  state_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  owner_machine_id TEXT NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  source_revision BIGINT NOT NULL CHECK (source_revision >= 0),
  revision BIGINT NOT NULL CHECK (revision >= 1),
  owner_connected BOOLEAN NOT NULL,
  freshness_changed_at TIMESTAMP(3) NOT NULL,
  accepted_at TIMESTAMP(3) NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL
);

CREATE INDEX work_item_execution_states_owner_machine_id_idx
  ON work_item_execution_states (owner_machine_id);
CREATE INDEX work_item_execution_states_project_id_idx
  ON work_item_execution_states (project_id);
