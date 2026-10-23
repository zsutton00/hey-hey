import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.07.1__backfill_task_monitor_canonical_parents.sql',
);

describe('V2026.08.07.1: backfill canonical Task Monitor parents', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('updates revision one templates for Feature and Standard in place', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(
      '"allowed_child_types" || \'["TASK_MONITOR"]\'::jsonb',
    );
    expect(sql).toContain('WHERE "revision" = 1');
    expect(sql).toContain("AND \"type_key\" IN ('FEATURE', 'STANDARD')");
  });

  it('immediately backfills all materialized project definitions', () => {
    expect(sql).toContain('UPDATE "work_item_type"');
    expect(sql).toContain("WHERE \"type_key\" IN ('FEATURE', 'STANDARD')");
    expect(sql).toContain('THEN 1');
  });

  it('removes the superseded revision two rows after repointing project definitions', () => {
    expect(sql).toContain('DELETE FROM "work_item_type_template"');
    expect(sql).toContain('WHERE "revision" = 2');
  });

  it('fails if a template or project definition remains one-sided', () => {
    expect(sql).toContain("(VALUES ('FEATURE'), ('STANDARD'))");
    expect(sql).toContain('template.id IS NULL');
    expect(sql).toContain('invalid_projects');
    expect(sql).toContain('RAISE EXCEPTION');
  });
});
