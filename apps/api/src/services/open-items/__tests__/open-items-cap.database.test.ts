import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const database = process.env.OPEN_ITEMS_CAP_TEST_DATABASE_URL;
const enabled =
  database &&
  new URL(database).pathname === '/open_items_cap_test' &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname);
const databaseTests = enabled ? describe : describe.skip;
const migration = (name: string) =>
  readFileSync(resolve(__dirname, '../../../../db/flyway', name), 'utf8');

databaseTests('Open Items cap migration on populated collections', () => {
  it('backfills visits, trims oldest unprotected entries atomically and retains protected overflow', () => {
    const schema = `cap_${randomUUID().replaceAll('-', '')}`;
    const sql = `BEGIN;
      CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema};
      CREATE TABLE organizations (id text PRIMARY KEY);
      CREATE TABLE projects (id text PRIMARY KEY);
      CREATE TABLE users (id text PRIMARY KEY);
      INSERT INTO organizations VALUES ('org'); INSERT INTO projects VALUES ('project');
      INSERT INTO users VALUES ('user1'), ('user2');
      ${migration('V2026.10.05.030501__create_open_items.sql')}
      ${migration('V2026.10.13.074407__persist_open_item_goal_row_state.sql')}
      INSERT INTO open_item_collections (id, organization_id, project_id, user_id, revision)
        VALUES ('mixed', 'org', 'project', 'user1', 1), ('protected', 'org', 'project', 'user2', 1);
      INSERT INTO open_item_groups (id, collection_id, name, position, revision)
        VALUES ('review', 'mixed', 'Review', 'V', 1);
      INSERT INTO open_items (id, collection_id, entity_type, entity_id, note, pinned, position, group_id, member_position, revision, lineage, presentation, updated_at)
      SELECT 'mixed' || n, 'mixed', CASE WHEN n % 3 = 0 THEN 'AGENT_SESSION' ELSE 'TASK' END,
        'entity' || n, CASE WHEN n = 2 THEN 'Awaiting review' END, n = 1,
        'V' || lpad(n::text, 3, '0'), CASE WHEN n = 3 THEN 'review' END, CASE WHEN n = 3 THEN 'V' END,
        1, '[]', jsonb_build_object('label', 'Existing item ' || n), timestamp '2026-10-01' + n * interval '1 second'
      FROM generate_series(1, 105) n;
      INSERT INTO open_items (id, collection_id, entity_type, entity_id, pinned, position, revision, lineage, presentation, updated_at)
      SELECT 'protected' || n, 'protected', 'TASK', 'entity' || n, true,
        'V' || lpad(n::text, 3, '0'), 1, '[]', jsonb_build_object('label', 'Pinned item ' || n), timestamp '2026-10-01'
      FROM generate_series(1, 105) n;
      ${migration('V2026.11.13.100131__track_open_item_activation.sql')}
      DO $$ BEGIN
        IF (SELECT count(*) FROM open_items WHERE collection_id = 'mixed' AND removed_at IS NULL) <> 100 THEN
          RAISE EXCEPTION 'mixed collection was not trimmed to 100'; END IF;
        IF (SELECT count(*) FROM open_items WHERE collection_id = 'protected' AND removed_at IS NULL) <> 105 THEN
          RAISE EXCEPTION 'protected entries were removed'; END IF;
        IF EXISTS (SELECT 1 FROM open_items WHERE collection_id = 'mixed' AND removed_at IS NOT NULL AND id NOT IN ('mixed4', 'mixed5', 'mixed6', 'mixed7', 'mixed8')) THEN
          RAISE EXCEPTION 'wrong eviction order'; END IF;
        IF (SELECT revision FROM open_item_collections WHERE id = 'mixed') <> 2 OR
           (SELECT revision FROM open_item_collections WHERE id = 'protected') <> 1 THEN
          RAISE EXCEPTION 'collection revisions did not advance atomically'; END IF;
        IF EXISTS (SELECT 1 FROM open_items WHERE last_activated_at IS NULL) OR
           (SELECT last_activated_at FROM open_items WHERE id = 'mixed4') <> timestamp '2026-10-01 00:00:04' THEN
          RAISE EXCEPTION 'legacy activation time was not preserved'; END IF;
      END $$;
      ROLLBACK;`;
    const result = spawnSync(
      'psql',
      ['--no-psqlrc', '--set', 'ON_ERROR_STOP=1', '--dbname', database!],
      { input: sql, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      throw new Error(
        result.stderr ||
          result.error?.message ||
          'Migration database check failed',
      );
    }
  });
});
