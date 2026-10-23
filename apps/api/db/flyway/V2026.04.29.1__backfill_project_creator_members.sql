-- Backfill project_members for every existing project's creator.
-- Until this migration, listProjectMembers (which reads from project_members)
-- never surfaced the project owner because Project.create() recorded the
-- creator only on projects.created_by and never inserted a membership row.
-- Idempotent: ON CONFLICT relies on the (project_id, user_id) unique constraint.
INSERT INTO project_members (
  project_id,
  user_id,
  role,
  created_at,
  updated_at
)
SELECT
  p.id,
  p.created_by,
  'OWNER'::"ProjectRole",
  COALESCE(p.created_at, NOW()),
  NOW()
FROM projects p
WHERE p.created_by IS NOT NULL
  AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.created_by)
ON CONFLICT (project_id, user_id) DO NOTHING;
