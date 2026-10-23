import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.27.090922__make_canonical_mockups_start_active.sql',
  ),
  'utf8',
);

describe('canonical Mockup initial status migration', () => {
  it('puts Active first while retaining the allowed status set', () => {
    expect(migrationSql).toContain(
      '\'["ACTIVE","BACKLOG","READY","ARCHIVED"]\'::jsonb',
    );
  });

  it('replaces only the lifecycle sentence, preserving appended guidance', () => {
    expect(migrationSql).toMatch(
      /jsonb_set\(\s*"writing_standards",\s*'\{create\}',\s*to_jsonb\(replace\(/,
    );
    expect(migrationSql).toContain('"writing_standards"->>\'create\'');
    expect(migrationSql).toContain(
      "'Backlog is the initial state; Active means drafting;'",
    );
    expect(migrationSql).toContain("'Active is the initial drafting state;'");
    expect(migrationSql).toMatch(/\)\),\s*false\s*\)/);
  });

  it('preserves capabilities, unrelated fields, project definitions and items', () => {
    expect(migrationSql.match(/UPDATE\s+"[^"]+"/g)).toEqual([
      'UPDATE "work_item_type_template"',
    ]);
    expect(migrationSql).toContain('WHERE "type_key" = \'mockup\';');
    expect(migrationSql).not.toMatch(/\b(?:INSERT|DELETE|ALTER)\b/);
    expect(migrationSql.match(/"\w+"\s*=/g)).toEqual([
      '"allowed_statuses" =',
      '"writing_standards" =',
      '"updated_at" =',
      '"type_key" =',
    ]);
  });
});
