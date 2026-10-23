import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    __dirname,
    '../V2026.09.18.1__generalize_work_item_service_scope_guidance.sql',
  ),
  'utf8',
);

describe('work-item service-scope guidance migration', () => {
  it('updates only canonical work-item-role templates', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain('wit."role" = \'work-item\'');
    expect(sql).not.toContain('UPDATE "work_item_type"');
    expect(sql).not.toContain('project_id');
  });

  it('replaces stale STANDARD wording and preserves the complete-set contract', () => {
    expect(sql).toContain('For a STANDARD work item');
    expect(sql).toContain(
      'For a work-item type whose registry role is `work-item`',
    );
    expect(sql).toContain('replace(');
    expect(sql).toContain('without guessing additional services');
    expect(sql).toContain('supply an empty array only to assert');
  });
});
