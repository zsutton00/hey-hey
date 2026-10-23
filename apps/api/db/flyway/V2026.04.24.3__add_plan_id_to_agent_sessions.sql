ALTER TABLE agent_sessions ADD COLUMN plan_id TEXT;

ALTER TABLE agent_sessions
  ADD CONSTRAINT fk_agent_sessions_plan
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL;

CREATE INDEX idx_agent_sessions_plan_id
  ON agent_sessions (plan_id)
  WHERE plan_id IS NOT NULL;
