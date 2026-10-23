ALTER TABLE work_item_change_set_materializations
  RENAME COLUMN prior_published_projection TO prior_projection;

ALTER TABLE work_item_change_set_materializations
  ADD COLUMN target_projection JSONB,
  ADD COLUMN affected_work_item_ids JSONB,
  ADD COLUMN affected_relationship_ids JSONB,
  ADD COLUMN fences_released_at TIMESTAMPTZ;

CREATE INDEX work_item_change_set_materializations_unreleased_fences_idx
  ON work_item_change_set_materializations(organization_id, project_id, status)
  WHERE fences_released_at IS NULL;
