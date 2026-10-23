import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    __dirname,
    '../../../db/flyway/V2026.09.11.8__retire_legacy_plan_storage.sql',
  ),
  'utf8',
);

describe('legacy Plan storage retirement migration', () => {
  it.each([
    'proposals',
    'conversations',
    'agent_sessions',
    'flow_executions',
    'message_mentions',
    'attention_events',
    'influences',
    'agent_session_work_item_associations',
  ])(
    'guards the %s reference family before destructive retirement',
    (table) => {
      const guardEnd = migration.indexOf(
        'CREATE TABLE IF NOT EXISTS plan_work_item_migration_archive',
      );
      expect(guardEnd).toBeGreaterThan(0);
      expect(migration.slice(0, guardEnd)).toContain(table);
    },
  );

  it('retains the dynamic EntityType-column audit before rebuilding enums', () => {
    expect(migration).toContain('attribute.atttypid = enum_oid');
    expect(migration).toContain('legacy entity identity remains in %.%.%');
  });
});
