import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.22.044628__restore_diagram_icon.sql',
  ),
  'utf8',
);

describe('restore canonical Diagram icon migration', () => {
  it('restores the canonical Diagram presentation through the registry token', () => {
    expect(migration).toContain("SET icon_key = 'workflow'");
    expect(migration).toContain("WHERE type_key = 'DIAGRAM'");
    expect(migration).toContain("icon_key IS DISTINCT FROM 'workflow'");
  });

  it('repairs missing project copies without overriding explicit choices', () => {
    expect(migration).toContain('UPDATE work_item_type');
    expect(migration).toContain('AND icon_key IS NULL');
  });

  it('does not introduce a second Diagram-specific icon token or rendering path', () => {
    expect(migration).not.toContain("'diagram'");
    expect(migration).not.toContain('renderer');
  });
});
