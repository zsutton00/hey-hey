ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS last_applied_proposal_id UUID;

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS target_last_applied_proposal_id UUID;
