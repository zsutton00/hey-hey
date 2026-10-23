import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.30.090000__teach_diagram_element_roles_and_links.sql',
  ),
  'utf8',
);

const sharedGuidance = migration.slice(
  migration.indexOf('pg_temp.diagram_semantics_guidance() RETURNS text'),
  migration.indexOf('CREATE FUNCTION pg_temp.diagram_writing_standards'),
);

describe('Diagram element roles and links guidance migration', () => {
  it('shares one role, link, and worked-example text across create and edit', () => {
    // DIAGRAM create/edit and DIAGRAM_ELEMENT create/edit all append it.
    expect(
      migration.match(/\|\| pg_temp\.diagram_semantics_guidance\(\)/g),
    ).toHaveLength(4);
    expect(sharedGuidance).toContain(
      '## Choosing kind, level, and element roles',
    );
    expect(sharedGuidance).toContain('## Connecting elements to the project');
    expect(sharedGuidance).toContain('## Worked examples');
  });

  it.each([
    'Explanatory Mockup',
    'Same-round target',
    'Whole-Diagram target',
    'Represented entity',
    'Nested Diagram',
    'Implementation evidence',
    'Near miss',
  ])('carries the %s worked example with good and bad behavior', (title) => {
    const start = sharedGuidance.indexOf(`**${title}.**`);
    expect(start).toBeGreaterThan(-1);
    const example = sharedGuidance.slice(start).split('\n\n')[0];
    expect(example).toContain('Good:');
    expect(example).toContain('Bad:');
  });

  it('distinguishes represented entities, explanatory artifacts, and implementation', () => {
    expect(sharedGuidance).toContain('data-hh-id="submit-order"');
    expect(sharedGuidance).toContain(
      "Bad: making the Mockup the element's canonical reference",
    );
    expect(sharedGuidance).toContain(
      'Canonical references point only at existing entities.',
    );
    expect(sharedGuidance).toContain(
      'role DIAGRAM_REFERENCE and canonical reference',
    );
    expect(sharedGuidance).toContain(
      'a FULFILLED_BY link from the element to that task',
    );
    expect(sharedGuidance).toContain(
      'A Diagram-level link never replaces an element link.',
    );
    expect(sharedGuidance).toContain(
      'similar names, a shared word, or proximity are not enough',
    );
    expect(sharedGuidance).toContain(
      'GENERIC is correct for an ordinary action',
    );
  });

  it('teaches same-round links without proposal groups and re-links revisions', () => {
    expect(sharedGuidance).toContain('Bad: a proposal group');
    expect(sharedGuidance).toContain('link to the new proposal');
    expect(sharedGuidance).toContain('not carried forward');
  });

  it('keeps sourceRef out of create guidance and in edit guidance', () => {
    const createMechanics = migration.slice(
      migration.indexOf('## Declaring element meaning and links when creating'),
      migration.indexOf("'edit', $ws$## Editing Diagrams"),
    );
    const editMechanics = migration.slice(
      migration.indexOf('## Declaring element meaning and links when editing'),
      migration.indexOf("WHEN 'DIAGRAM_ELEMENT'"),
    );
    expect(createMechanics).toContain('`diagramElements[].edges`');
    expect(createMechanics).toContain('`targetEntityType: "PROPOSAL"`');
    expect(createMechanics).not.toContain('sourceRef');
    expect(sharedGuidance).not.toContain('sourceRef');
    expect(editMechanics).toContain('`relationship.create` operation');
    expect(editMechanics).toContain('`sourceRef`');
  });

  it('rewrites only canonical templates still carrying the repaired text', () => {
    expect(migration).toContain('UPDATE work_item_type_template');
    expect(migration).not.toContain('UPDATE work_item_type\n');
    expect(migration).toContain("LIKE '## What a Diagram is%'");
    expect(migration).toContain("LIKE '## What a Diagram Element is%'");
    expect(migration).toContain(
      "RAISE EXCEPTION 'Canonical Diagram create and edit guidance must carry the worked examples'",
    );
  });

  it('uses Diagram terminology in new text', () => {
    expect(sharedGuidance).not.toMatch(/workflow/i);
  });
});
