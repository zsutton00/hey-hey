import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.11.22.100000__teach_diagram_element_placement.sql',
  ),
  'utf8',
);

describe('Diagram element placement guidance migration', () => {
  it('teaches units, sizes, spacing, and the placement rules', () => {
    expect(migration).toContain('## Placing elements');
    expect(migration).toContain('medium display size');
    expect(migration).toContain('140 wide and 140 tall');
    expect(migration).toContain('300 between column origins');
    expect(migration).toContain('220 between row origins');
    expect(migration).toContain('`PRIMARY_PROGRESSION`');
    expect(migration).toContain('`layout.replace`');
    expect(migration).toContain('`layoutBoundary`');
  });

  it('limits full placement to creation and requested rearrangement', () => {
    expect(migration).toContain('or when the user asks you to rearrange one');
    expect(migration).toContain('leave the layout alone');
    expect(migration).toContain('move only the elements that must shift');
    expect(migration).toContain(
      'repeat every element you are not moving at its current coordinates',
    );
  });

  it('appends to both Diagram types in create and edit, once', () => {
    expect(migration).toContain("type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')");
    expect(migration).toContain("'{create}'");
    expect(migration).toContain("'{edit}'");
    expect(migration).toContain(
      "position('## Placing elements' IN writing_standards->>'create') = 0",
    );
  });
});
