import { readFileSync } from 'fs';
import { resolve } from 'path';
import { PROJECT_MODE_SETTINGS_SCHEMA_REF } from '../project-mode-settings.validator';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.10.02.100000__add_mode_project_assistant_setting.sql',
);

describe('MODE Project Assistant setting migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('adds an optional schema-backed settings section to canonical and active project MODE definitions', () => {
    expect(sql).toContain('UPDATE work_item_type_template AS mode');
    expect(sql).toContain('UPDATE work_item_type AS mode');
    expect(sql).toContain("mode.lifecycle_status = 'active'");
    expect(sql).toContain(`"schemaRef":"${PROJECT_MODE_SETTINGS_SCHEMA_REF}"`);
    expect(sql).toContain('"key":"settings"');
    expect(sql).toContain('"kind":"json"');
    expect(sql).toContain('"required":false');
  });

  it('is idempotent and never rewrites existing MODE work items', () => {
    expect(sql.match(/existing\.section->>'key' = 'settings'/g)).toHaveLength(
      2,
    );
    expect(sql).not.toContain('UPDATE task');
    expect(sql).not.toContain('INSERT INTO task_sections');
  });

  it('appends Project Assistant guidance to create and edit standards in place', () => {
    expect(sql).toContain("NULLIF(mode.writing_standards->>'create', '')");
    expect(sql).toContain("NULLIF(mode.writing_standards->>'edit', '')");
    expect(sql).toContain(
      "Decide whether Project Assistant should run before this mode''s first turn",
    );
    expect(sql).toContain(
      'sessions already launched keep the value captured at launch',
    );
  });

  it('fails clearly when the canonical MODE template is absent', () => {
    expect(sql).toContain('canonical MODE template is missing');
    expect(sql).toContain('RAISE EXCEPTION');
  });
});
