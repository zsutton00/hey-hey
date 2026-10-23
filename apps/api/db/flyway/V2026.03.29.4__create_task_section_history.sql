-- Create task_section_history table for tracking section-level version history
CREATE TABLE task_section_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  section_key         TEXT NOT NULL,
  version_number      INT NOT NULL,
  content_snapshot    TEXT NOT NULL,
  changed_by          TEXT REFERENCES users(id) ON DELETE SET NULL,
  changed_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_reason       TEXT,
  previous_version_id UUID REFERENCES task_section_history(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (task_id, section_key, version_number)
);

CREATE INDEX task_section_history_task_id_idx
  ON task_section_history (task_id);

CREATE INDEX task_section_history_changed_at_idx
  ON task_section_history (task_id, changed_at);
