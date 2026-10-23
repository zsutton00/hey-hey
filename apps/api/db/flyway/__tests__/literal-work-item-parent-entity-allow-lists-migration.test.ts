import { readFileSync } from 'fs';
import { resolve } from 'path';

const MIGRATION_PATH = resolve(
  __dirname,
  '../V2026.08.10.2__enforce_literal_work_item_parent_entity_allow_lists.sql',
);

describe('literal work-item parent EntityType allow-list migration', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8');

  it.each([
    ['STANDARD', '["FEATURE","STANDARD"]', '["TASK"]', true],
    ['FEATURE', '["FEATURE"]', '["TASK"]', false],
    ['BUG', '["FEATURE"]', '["TASK"]', true],
    ['GOAL', '[]', '[]', false],
    ['CONTRACT', '["FEATURE"]', '["TASK"]', true],
    ['TASK_MONITOR', '["FEATURE","STANDARD"]', '["TASK"]', true],
    ['workflow', '["FEATURE","STANDARD"]', '["TASK"]', false],
    ['workflow_step', '["workflow"]', '["TASK"]', true],
  ])(
    'writes and verifies the canonical %s matrix row',
    (typeKey, parentTypes, parentEntityTypes, requiresParent) => {
      expect(sql).toContain(
        `('${typeKey}', '${parentTypes}'::jsonb, '${parentEntityTypes}'::jsonb)`,
      );
      expect(sql).toContain(
        `('${typeKey}', '${parentTypes}'::jsonb, '${parentEntityTypes}'::jsonb, ${requiresParent})`,
      );
    },
  );

  it('updates only canonical templates and leaves project overrides untouched', () => {
    expect(sql).toContain('UPDATE work_item_type_template AS template');
    expect(sql).not.toMatch(/(?:UPDATE|DELETE FROM)\s+work_item_type(?:\s|$)/);
  });

  it('preserves requiresParent and verifies it independently', () => {
    const update = sql.slice(0, sql.indexOf('DO $migration$'));
    expect(update).not.toContain('requiresParent');
    expect(sql).toContain(
      "(template.capabilities->>'requiresParent')::boolean",
    );
  });

  it('fails fast when a canonical row is missing or mismatched', () => {
    expect(sql).toContain('template.id IS NULL');
    expect(sql).toContain('IS DISTINCT FROM expected.allowed_parent_types');
    expect(sql).toContain(
      'IS DISTINCT FROM expected.allowed_parent_entity_types',
    );
    expect(sql).toContain('Canonical work-item parentage matrix mismatch for:');
  });
});
