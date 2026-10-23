import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.20.2__repair_diagram_authoring_guidance.sql',
  ),
  'utf8',
);

describe('canonical Diagram authoring guidance migration', () => {
  it('teaches diagramElements and removes legacy Workflow entity headings', () => {
    expect(migration).toContain('canonical `diagramElements` input');
    expect(migration).toContain('DIAGRAM_ELEMENT children');
    expect(migration).toContain('## Editing Diagrams');
    expect(migration).toContain('## Editing Diagram Elements');
    expect(migration).toContain(
      "RAISE EXCEPTION 'Canonical Diagram authoring guidance still contains legacy Workflow headings'",
    );
  });

  it('updates canonical templates without rewriting project-owned overrides', () => {
    expect(migration).toContain('UPDATE work_item_type_template');
    expect(migration).not.toContain('UPDATE work_item_type\n');
    expect(migration).not.toContain('is_system');
  });
});
