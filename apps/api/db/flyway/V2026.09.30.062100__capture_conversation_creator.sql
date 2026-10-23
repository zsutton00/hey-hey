ALTER TABLE conversations ADD COLUMN created_by TEXT;

UPDATE conversations AS c
SET created_by = COALESCE(
  (
    SELECT m.user_id
    FROM messages AS m
    WHERE m.conversation_id = c.id AND m.type = 'USER'
    ORDER BY m.created_at, m.id
    LIMIT 1
  ),
  (
    SELECT s.user_id
    FROM agent_sessions AS s
    WHERE s.conversation_id = c.id
    ORDER BY s.created_at, s.id
    LIMIT 1
  ),
  (
    SELECT p.created_by
    FROM projects AS p
    WHERE p.id = c.project_id
  )
)
WHERE c.created_by IS NULL;
