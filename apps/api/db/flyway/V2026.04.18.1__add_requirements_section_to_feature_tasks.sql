-- Backfill all existing FEATURE tasks with an empty requirements section.
-- Idempotent: the NOT EXISTS guard prevents duplicate rows on re-run.
INSERT INTO task_sections (
  id,
  task_id,
  key,
  "order",
  materialized_markdown,
  created_at,
  updated_at
)
SELECT
  'task-section-' || t.id || '-requirements',
  t.id,
  'requirements',
  1,
  '',
  NOW(),
  NOW()
FROM tasks t
WHERE t.type = 'FEATURE'
  AND NOT EXISTS (
    SELECT 1
    FROM task_sections s
    WHERE s.task_id = t.id
      AND s.key = 'requirements'
  );
