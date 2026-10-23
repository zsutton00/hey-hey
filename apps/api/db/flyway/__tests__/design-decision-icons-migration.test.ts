import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.23.234246__add_design_and_decision_work_item_icons.sql',
  ),
  'utf8',
);

describe('Design and Decision work-item icon migration', () => {
  it('accepts the new presentation tokens in both stored-key constraints', () => {
    expect(migration).toContain('work_item_type_template_icon_key_check');
    expect(migration).toContain('work_item_type_icon_key_check');
    expect(migration.match(/'design', 'decision'/g)).toHaveLength(2);
  });

  it('assigns the Design token only to the canonical Mockup template', () => {
    expect(migration).toContain("WHERE type_key = 'mockup'");
    expect(migration).toContain("SET icon_key = 'design'");
    expect(migration).toContain('work_item_type_template');
    expect(migration).not.toMatch(/UPDATE work_item_type\s+SET icon_key/);
  });

  it('fails clearly when the canonical Mockup template is missing', () => {
    expect(migration).toContain("WHERE type_key = 'mockup'");
    expect(migration).toContain('canonical Mockup template is missing');
  });
});
