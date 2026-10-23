ALTER TABLE plans
  ADD COLUMN parent_task_id TEXT REFERENCES tasks(id);

CREATE INDEX idx_plans_parent_task_id ON plans(parent_task_id);
