import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.07.2.1__cut_over_child_owned_type_parentage.sql',
);

describe('V2026.08.07.2.1: child-owned work-item type parentage', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('fails before mutation when project or latest-template parent-only declarations exist', () => {
    const firstAlter = sql.indexOf('ALTER TABLE');
    const projectGuard = sql.indexOf(
      'unresolved project parent-only declarations',
    );
    const templateGuard = sql.indexOf(
      'unresolved latest-template parent-only declarations',
    );

    expect(projectGuard).toBeGreaterThanOrEqual(0);
    expect(templateGuard).toBeGreaterThan(projectGuard);
    expect(templateGuard).toBeLessThan(firstAlter);
    expect(sql).toContain('jsonb_array_elements_text(parent.allowed_child_types)');
    expect(sql).toContain(
      'NOT child.allowed_parent_types @> jsonb_build_array(claim.parent_type)',
    );
    expect(sql).toContain('ORDER BY type_key, revision DESC');
  });

  it('persists the closed icon palette and backfills known built-ins', () => {
    for (const [typeKey, iconKey] of [
      ['STANDARD', 'task'],
      ['BUG', 'bug'],
      ['FEATURE', 'feature'],
      ['GOAL', 'goal'],
      ['CONTRACT', 'contract'],
      ['workflow', 'workflow'],
    ]) {
      expect(sql).toContain(`WHEN '${typeKey}' THEN '${iconKey}'`);
    }

    expect(sql).toContain('work_item_type_template_icon_key_check');
    expect(sql).toContain('work_item_type_icon_key_check');
    expect(sql).toContain(
      "icon_key IN ('task', 'bug', 'feature', 'goal', 'contract', 'workflow')",
    );
  });

  it('drops the reciprocal column only after both preflights and icon backfills', () => {
    const firstDrop = sql.indexOf('DROP COLUMN allowed_child_types');
    expect(firstDrop).toBeGreaterThan(
      sql.lastIndexOf('UPDATE work_item_type\nSET icon_key'),
    );
    expect(sql.match(/DROP COLUMN allowed_child_types/g)).toHaveLength(2);
  });
});
