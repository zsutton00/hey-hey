import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), 'db/flyway', name), 'utf8');

describe('Diagram group color identity guidance migration', () => {
  const migration = read(
    'V2026.10.13.073857__teach_diagram_group_color_identity.sql',
  );
  it('extends canonical create and edit without touching project overrides or data', () => {
    expect(migration).toContain('UPDATE work_item_type_template');
    expect(migration).not.toMatch(/UPDATE "?work_item_type"?\s/);
    expect(migration).toContain("WHERE type_key = 'DIAGRAM'");
    expect(migration).toContain(
      "position('## Group color identity' IN writing_standards->>'create') = 0",
    );
    expect(migration).toContain(
      "position('## Group color identity' IN writing_standards->>'edit') = 0",
    );
    expect(migration).toContain(
      'DROP FUNCTION pg_temp.diagram_group_color_guidance()',
    );
  });
  it.each([
    'blue, green, orange, purple, red, or teal',
    'same color',
    'do not persist automatically assigned colors',
    'preserve authored colors',
    'dashed border',
    'solid borders',
    'existing hex-color behavior',
  ])('teaches %s', (text) => {
    expect(migration).toContain(text);
  });
});

describe('Diagram groups section migration', () => {
  const migration = read('V2026.10.08.120000__add_diagram_groups_section.sql');

  it('registers the optional section and declaration on canonical and project-owned Diagrams', () => {
    expect(migration).toContain('UPDATE "work_item_type"');
    expect(migration).toContain('UPDATE "work_item_type_template"');
    expect(migration.match(/"type_key" = 'DIAGRAM'/g)).toHaveLength(2);
    expect(
      migration.match(
        /"key":"diagramGroups","label":"Diagram Groups","kind":"json","required":false,"schemaRef":"#\/components\/schemas\/DiagramGroupsValue"/g,
      ),
    ).toHaveLength(2);
    expect(
      migration.match(
        /'\{groups\}',\s*'\{"sectionKey":"diagramGroups","schemaRef":"#\/components\/schemas\/DiagramGroupsValue"\}'::jsonb/g,
      ),
    ).toHaveLength(2);
  });

  it('is idempotent and never rewrites the authored layout declaration', () => {
    expect(
      migration.match(/@> '\[\{"key":"diagramGroups"\}\]'::jsonb/g),
    ).toHaveLength(2);
    expect(migration).not.toContain("'{layout}'");
    expect(migration).not.toContain("'{layoutPreference}'");
  });
});

describe('Diagram groups guidance migration', () => {
  const migration = read('V2026.10.08.120100__teach_diagram_groups.sql');

  it('appends one shared section to create and edit of canonical Diagram templates only', () => {
    expect(migration).toContain('UPDATE work_item_type_template');
    expect(migration).not.toMatch(/UPDATE "?work_item_type"?\s/);
    expect(migration).toContain("pg_temp.diagram_groups_guidance('create')");
    expect(migration).toContain("pg_temp.diagram_groups_guidance('edit')");
    expect(migration).toContain(
      "position('## Groups and boundaries' IN writing_standards->>'create') = 0",
    );
    expect(migration).toContain(
      'DROP FUNCTION pg_temp.diagram_groups_guidance',
    );
  });

  it.each([
    'VISUAL_ASSOCIATION',
    'STRUCTURAL_BOUNDARY',
    'DEPLOYMENT_BOUNDARY',
    'never containers',
    'Membership belongs to the element placement',
    'Never supply coordinates',
    '**Deployment boundaries.**',
  ])('teaches %s', (text) => {
    expect(migration).toContain(text);
  });
});
