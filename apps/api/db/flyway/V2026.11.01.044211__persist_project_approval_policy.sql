-- Keep the revision row after restoring defaults to prevent ABA/lost updates.
CREATE TABLE project_approval_policy_configurations (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  rules JSONB,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE proposals ADD COLUMN approval_decision_evidence JSONB;
