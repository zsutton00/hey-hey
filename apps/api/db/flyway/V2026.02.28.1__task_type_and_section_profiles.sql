-- Add task_type enum + tasks.type discriminator
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_type') THEN
    CREATE TYPE task_type AS ENUM ('STANDARD', 'BUG');
  END IF;
END
$$;

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS type task_type;

UPDATE tasks
SET type = 'STANDARD'
WHERE type IS NULL;

ALTER TABLE tasks
  ALTER COLUMN type SET DEFAULT 'STANDARD';

ALTER TABLE tasks
  ALTER COLUMN type SET NOT NULL;

-- Merge legacy details content into description deterministically.
-- 1) If description row is missing, convert details row into description.
UPDATE task_sections details_section
SET key = 'description',
    "order" = 0,
    updated_at = NOW()
WHERE details_section.key = 'details'
  AND NOT EXISTS (
    SELECT 1
    FROM task_sections description_section
    WHERE description_section.task_id = details_section.task_id
      AND description_section.key = 'description'
  );

-- 2) For tasks that still have both rows, merge values into description.
WITH section_pairs AS (
  SELECT
    description_section.id AS description_id,
    COALESCE(description_section.materialized_markdown, '') AS description_markdown,
    COALESCE(details_section.materialized_markdown, '') AS details_markdown
  FROM task_sections description_section
  JOIN task_sections details_section
    ON details_section.task_id = description_section.task_id
   AND details_section.key = 'details'
  WHERE description_section.key = 'description'
)
UPDATE task_sections description_section
SET materialized_markdown = CASE
      WHEN BTRIM(section_pairs.description_markdown) = ''
        THEN section_pairs.details_markdown
      WHEN BTRIM(section_pairs.details_markdown) = ''
        THEN section_pairs.description_markdown
      ELSE section_pairs.description_markdown || E'\n\n---\n\n' || section_pairs.details_markdown
    END,
    updated_at = NOW()
FROM section_pairs
WHERE description_section.id = section_pairs.description_id;

-- Ensure required profile sections exist.
-- STANDARD: description + acceptanceCriteria
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
  'task-section-' || t.id || '-description',
  t.id,
  'description',
  0,
  '',
  NOW(),
  NOW()
FROM tasks t
WHERE t.type = 'STANDARD'
  AND NOT EXISTS (
    SELECT 1
    FROM task_sections section
    WHERE section.task_id = t.id
      AND section.key = 'description'
  );

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
  'task-section-' || t.id || '-acceptanceCriteria',
  t.id,
  'acceptanceCriteria',
  1,
  '',
  NOW(),
  NOW()
FROM tasks t
WHERE t.type = 'STANDARD'
  AND NOT EXISTS (
    SELECT 1
    FROM task_sections section
    WHERE section.task_id = t.id
      AND section.key = 'acceptanceCriteria'
  );

-- BUG: description only
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
  'task-section-' || t.id || '-description',
  t.id,
  'description',
  0,
  '',
  NOW(),
  NOW()
FROM tasks t
WHERE t.type = 'BUG'
  AND NOT EXISTS (
    SELECT 1
    FROM task_sections section
    WHERE section.task_id = t.id
      AND section.key = 'description'
  );

-- Remove legacy details rows for all task types.
DELETE FROM task_sections
WHERE key = 'details';

-- Enforce profile section sets after hard cut.
DELETE FROM task_sections section
USING tasks t
WHERE section.task_id = t.id
  AND t.type = 'BUG'
  AND section.key <> 'description';

UPDATE task_sections
SET "order" = 0,
    updated_at = NOW()
WHERE key = 'description';

UPDATE task_sections
SET "order" = 1,
    updated_at = NOW()
WHERE key = 'acceptanceCriteria';

-- Rollout checks (manual):
-- SELECT COUNT(*) FROM task_sections WHERE key = 'details';
-- SELECT t.type, ts.task_id, ARRAY_AGG(ts.key ORDER BY ts.key)
--   FROM task_sections ts JOIN tasks t ON t.id = ts.task_id
--  GROUP BY t.type, ts.task_id;
