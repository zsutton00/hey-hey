ALTER TABLE agent_sessions
  ADD COLUMN machine_id TEXT;

ALTER TABLE agent_sessions
  ADD CONSTRAINT agent_sessions_machine_id_fkey
  FOREIGN KEY (machine_id)
  REFERENCES machines(id)
  ON DELETE SET NULL;

CREATE INDEX agent_sessions_machine_id_idx
  ON agent_sessions(machine_id);
