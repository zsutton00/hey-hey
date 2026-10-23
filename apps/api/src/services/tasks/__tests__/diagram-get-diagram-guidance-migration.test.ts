import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.17.100000__point_diagram_create_guidance_at_get_diagram.sql',
  ),
  'utf8',
);

describe('Diagram create guidance get_diagram migration', () => {
  it('rewrites the removed read-tool name in canonical Diagram create guidance', () => {
    expect(migration).toContain(
      "replace(writing_standards->>'create', '`get_workflow`', '`get_diagram`')",
    );
    expect(migration).toContain(
      "WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')",
    );
  });

  it('touches only rows that still carry the removed name', () => {
    expect(migration).toContain(
      "position('`get_workflow`' IN writing_standards->>'create') > 0",
    );
  });
});
