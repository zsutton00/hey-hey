CREATE TABLE bug_report_intake_contexts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  bug_task_id TEXT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  reported_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  product_location VARCHAR(500) NOT NULL,
  correlation_id VARCHAR(128),
  diagnostic_consent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX bug_report_intake_contexts_reported_by_created_at_idx
  ON bug_report_intake_contexts (reported_by_user_id, created_at);
