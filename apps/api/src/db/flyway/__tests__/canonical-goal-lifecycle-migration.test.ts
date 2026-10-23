import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.08.181034__pare_down_canonical_goal_lifecycle.sql',
  ),
  'utf8',
);

describe('canonical Goal lifecycle migration', () => {
  it('sets the exact lifecycle with Active as the initial status', () => {
    expect(migrationSql).toContain(
      '\'["ACTIVE","ON_HOLD","VERIFYING","COMPLETED","CANCELLED","ARCHIVED"]\'::jsonb',
    );
    expect(migrationSql).toMatch(/"allowed_statuses"\s*=\s*'\["ACTIVE",/);
  });

  it('updates only the canonical Goal template lifecycle', () => {
    expect(migrationSql.match(/UPDATE\s+"[^"]+"/g)).toEqual([
      'UPDATE "work_item_type_template"',
    ]);
    expect(migrationSql).toContain('WHERE "type_key" = \'GOAL\';');
    expect(migrationSql).not.toMatch(/\b(?:INSERT|DELETE|ALTER)\b/i);
    const setClause = migrationSql.match(/\bSET\b([\s\S]*?)\bWHERE\b/i)?.[1];
    expect(setClause?.match(/"[^"]+"\s*=/g)).toEqual([
      '"allowed_statuses" =',
      '"updated_at" =',
    ]);
  });
});
