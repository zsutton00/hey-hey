-- The sandbox owner principal was seeded with the id 'demo-system'. User ids
-- travel in domain events whose schema requires a UUID, so the Graph service
-- rejected every event stamped with it. Move the principal to a fixed UUID.
-- Every single-column reference to users(id) is repointed, so memberships,
-- ownership and audit columns follow the principal.
UPDATE users
SET email = 'demo-system-retired@internal.local'
WHERE id = 'demo-system';

INSERT INTO users (id, email, name, password_hash, is_active, is_demo_user, updated_at)
SELECT '00000000-0000-4000-8000-000000000001', 'demo-system@internal.local', name, password_hash, is_active, is_demo_user, CURRENT_TIMESTAMP
FROM users
WHERE id = 'demo-system';

DO $$
DECLARE
  reference RECORD;
BEGIN
  FOR reference IN
    SELECT c.conrelid::regclass AS table_name, a.attname AS column_name
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f'
      AND c.confrelid = 'users'::regclass
      AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'UPDATE %s SET %I = %L WHERE %I = %L',
      reference.table_name, reference.column_name, '00000000-0000-4000-8000-000000000001',
      reference.column_name, 'demo-system'
    );
  END LOOP;
END $$;

DELETE FROM users WHERE id = 'demo-system';
