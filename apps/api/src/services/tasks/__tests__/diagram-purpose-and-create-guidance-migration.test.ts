import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.02.110000__rewrite_diagram_purpose_and_create_guidance.sql',
  ),
  'utf8',
);

const sharedGuidance = migration.slice(
  migration.indexOf('pg_temp.diagram_semantics_guidance() RETURNS text'),
  migration.indexOf('CREATE FUNCTION pg_temp.diagram_writing_standards'),
);

const diagramCreate = migration.slice(
  migration.indexOf("'create', $ws$## Reuse an existing Diagram first"),
  migration.indexOf("'edit', $ws$## Editing Diagrams"),
);

describe('Diagram purpose and create guidance migration', () => {
  it('opens Diagram creation with finding and editing an existing Diagram', () => {
    expect(diagramCreate).toContain('## Reuse an existing Diagram first');
    expect(diagramCreate).toContain('`get_context`');
    expect(diagramCreate).toContain('`get_edges`');
    expect(diagramCreate).toContain('`get_workflow`');
    expect(diagramCreate).toContain(
      'propose an edit to it instead of creating a new Diagram',
    );
    expect(diagramCreate.indexOf('## Reuse an existing Diagram first')).toBe(
      diagramCreate.indexOf('## '),
    );
  });

  it('keeps creation mechanics in one section after the shared guidance', () => {
    expect(diagramCreate).not.toContain('## Compound creation');
    expect(diagramCreate).not.toContain('## What a Diagram is');
    expect(
      diagramCreate.indexOf('## Creating the Diagram and its elements'),
    ).toBeGreaterThan(
      diagramCreate.indexOf('pg_temp.diagram_semantics_guidance()'),
    );
  });

  it('explains Diagram levels in C4 terms in the purpose and shared guidance', () => {
    for (const text of [migration, sharedGuidance]) {
      expect(text).toMatch(/C4 level/);
    }
    expect(sharedGuidance).toContain('SYSTEM_CONTEXT for the system');
    expect(sharedGuidance).toContain('Do not mix levels in one Diagram');
    expect(migration).toContain(
      'Create one when the subject is clearer as connected elements than as prose, under the Feature it shows.',
    );
  });

  it.each([
    'Explanatory Mockup',
    'Represented entity',
    'Nested Diagram',
    'Near miss',
  ])('keeps the %s worked example with good and bad behavior', (title) => {
    const start = sharedGuidance.indexOf(`**${title}.**`);
    expect(start).toBeGreaterThan(-1);
    const example = sharedGuidance.slice(start).split('\n\n')[0];
    expect(example).toContain('Good:');
    expect(example).toContain('Bad:');
  });

  it.each(['Same-round target', 'Whole-Diagram target', 'Implementation evidence'])(
    'drops the %s worked example',
    (title) => {
      expect(sharedGuidance).not.toContain(`**${title}.**`);
    },
  );

  it('restores semantic overviews only where the cutover dropped them', () => {
    expect(migration).toContain("agent_guidance->>'overview' IS NULL");
    expect(migration).toContain(
      'so a subject\'s existing Diagrams are found through that owner\'s children and links',
    );
  });

  it('rewrites only canonical templates still carrying the previous text', () => {
    expect(migration).not.toContain('UPDATE work_item_type\n');
    expect(migration).toContain("position('**Same-round target.**'");
    expect(migration).toContain(
      "AND description = 'A graph-shaped design artifact with explicit kind and abstraction level.'",
    );
  });

  it('uses Diagram terminology in new shared text', () => {
    expect(sharedGuidance).not.toMatch(/workflow/i);
  });
});
