ALTER TABLE agent_sessions ADD COLUMN project_id TEXT;

-- Backfill from the linked conversation's project_id
UPDATE agent_sessions a
SET project_id = c.project_id
FROM conversations c
WHERE a.conversation_id = c.id
  AND c.project_id IS NOT NULL;

-- Fallback: assign to the provided default project for any remaining rows
UPDATE agent_sessions
SET project_id = '96c5429a-84d1-4813-b661-75be18f2b3c2'
WHERE project_id IS NULL;

-- Fail fast if any rows still could not be backfilled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM agent_sessions WHERE project_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set NOT NULL: % agent_sessions have NULL project_id',
      (SELECT count(*) FROM agent_sessions WHERE project_id IS NULL);
  END IF;
END $$;

ALTER TABLE agent_sessions ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE agent_sessions
  ADD CONSTRAINT fk_agent_sessions_project
  FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE INDEX idx_agent_sessions_project_id ON agent_sessions (project_id);
