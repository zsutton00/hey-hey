ALTER TABLE tasks ADD COLUMN project_id TEXT;

-- Pass 1: Tasks with an initiative — get projectId from initiative.originating_project_id
UPDATE tasks t
SET project_id = i.originating_project_id
FROM initiatives i
WHERE t.initiative_id = i.id
  AND i.originating_project_id IS NOT NULL;

-- Pass 2: Orphan tasks (e.g. FEATURE tasks with no initiative) —
-- assign to the first project in their organization
UPDATE tasks t
SET project_id = (
  SELECT p.id FROM projects p
  WHERE p.organization_id = t.organization_id
  ORDER BY p.created_at ASC
  LIMIT 1
)
WHERE t.project_id IS NULL;

-- Fail fast with a clear message if any rows still could not be backfilled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tasks WHERE project_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot set NOT NULL: % tasks have NULL project_id',
      (SELECT count(*) FROM tasks WHERE project_id IS NULL);
  END IF;
END $$;

ALTER TABLE tasks ALTER COLUMN project_id SET NOT NULL;

ALTER TABLE tasks
  ADD CONSTRAINT fk_tasks_project
  FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE INDEX idx_tasks_project_id ON tasks (project_id);
CREATE INDEX idx_tasks_project_id_status ON tasks (project_id, status);
