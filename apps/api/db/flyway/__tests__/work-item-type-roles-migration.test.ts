import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const baseMigrationPath = resolve(
  __dirname,
  '../V2026.08.25.2__add_work_item_type_roles.sql',
);
const monitorMigrationPath = resolve(
  __dirname,
  '../V2026.08.25.3__add_task_monitor_role.sql',
);
const baseSql = readFileSync(baseMigrationPath, 'utf8');
const monitorSql = readFileSync(monitorMigrationPath, 'utf8');

describe('work-item type role migration', () => {
  it('backfills task-like built-ins and constrains the complete vocabulary', () => {
    expect(baseSql).toContain("type_key IN ('STANDARD', 'BUG')");
    expect(baseSql).toContain("THEN 'work-item'");
    expect(baseSql).toContain("ELSE 'project-info'");
    expect(baseSql).toContain(
      "CHECK (role IN ('work-item', 'project-info', 'scheduled', 'trigger'))",
    );
  });

  it('classifies task monitors separately from structural project information', () => {
    expect(monitorSql).toContain("SET role = 'monitor'");
    expect(monitorSql).toContain("WHERE type_key = 'TASK_MONITOR'");
    expect(monitorSql).toContain(
      "CHECK (role IN ('work-item', 'project-info', 'scheduled', 'trigger', 'monitor'))",
    );
  });
});
