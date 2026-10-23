ALTER TABLE work_item_change_set_materializations
  ADD COLUMN claim_token UUID,
  ADD COLUMN claim_expires_at TIMESTAMPTZ;

CREATE INDEX work_item_change_set_materializations_boundary_queue_idx
  ON work_item_change_set_materializations(
    organization_id,
    project_id,
    created_at
  )
  WHERE status <> 'PUBLISHED';

CREATE INDEX work_item_change_set_materializations_claim_expiry_idx
  ON work_item_change_set_materializations(claim_expires_at)
  WHERE claim_expires_at IS NOT NULL;
