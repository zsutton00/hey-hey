CREATE TABLE proposal_reconciliation_effects (
  materialization_id text NOT NULL REFERENCES work_item_change_set_materializations(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  basis jsonb NOT NULL,
  operation_indexes integer[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (materialization_id, entity_type, entity_id)
);
