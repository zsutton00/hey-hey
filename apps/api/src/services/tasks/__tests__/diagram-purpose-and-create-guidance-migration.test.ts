import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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

  it.each([
    'Same-round target',
    'Whole-Diagram target',
    'Implementation evidence',
  ])('drops the %s worked example', (title) => {
    expect(sharedGuidance).not.toContain(`**${title}.**`);
  });

  it('restores semantic overviews only where the cutover dropped them', () => {
    expect(migration).toContain("agent_guidance->>'overview' IS NULL");
    expect(migration).toContain(
      "so a subject's existing Diagrams are found through that owner's children and links",
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

describe('Mockup screen reference guidance migration', () => {
  const update = readFileSync(
    resolve(
      process.cwd(),
      'db/flyway/V2026.10.27.194014__teach_diagram_mockup_screen_references.sql',
    ),
    'utf8',
  );
  const newGuidance = update.split('SELECT $new$')[1]!.split('$new$')[0]!;

  it('distinguishes represented screens from actions, uncertainty and same-round proposals', () => {
    for (const phrase of [
      'an existing Mockup when the element is that screen',
      'a Mockup illustrating an action or control',
      'element name could replace the Mockup name without changing its meaning',
      'If still unclear, link rather than reference',
      'link the element to its proposal, never use it as a canonical reference',
      '**Screen element.**',
      '"Submit checkout" is an action, not the screen',
      'similar names, a shared word, or proximity are not enough',
    ])
      expect(newGuidance).toContain(phrase);
    expect(newGuidance).not.toContain('It is never the canonical reference');
  });

  it('updates the same predecessor passage in both create and edit, only in canonical templates', () => {
    expect(update).toContain(
      "WHERE type_key IN ('DIAGRAM', 'DIAGRAM_ELEMENT')",
    );
    expect(update).toContain(
      "position(pg_temp.old_diagram_semantics() IN writing_standards->>'create') > 0",
    );
    expect(update).toContain(
      "position(pg_temp.old_diagram_semantics() IN writing_standards->>'edit') > 0",
    );
    expect(update).not.toMatch(/UPDATE work_item_type\s/);
    expect(update).not.toMatch(/UPDATE task\s/);
  });
});

const postgresTest =
  process.env.RUN_DIAGRAM_MIGRATION_TESTS === '1' ? it : it.skip;
postgresTest(
  'preserves unrelated content, overrides and Diagrams in PostgreSQL',
  () => {
    const update = readFileSync(
      resolve(
        process.cwd(),
        'db/flyway/V2026.10.27.194014__teach_diagram_mockup_screen_references.sql',
      ),
      'utf8',
    );
    const original = update.split('SELECT $old$')[1]!.split('$old$')[0]!;
    const output = execFileSync(
      'psql',
      ['-X', '--dbname=postgres', '--set=ON_ERROR_STOP=1', '--quiet'],
      {
        encoding: 'utf8',
        input: `
    BEGIN;
    SET LOCAL search_path = pg_temp;
    CREATE TEMP TABLE work_item_type_template (type_key text, writing_standards jsonb, updated_at timestamptz DEFAULT now());
    CREATE TEMP TABLE work_item_type (type_key text, writing_standards jsonb);
    CREATE TEMP TABLE task (name text);
    INSERT INTO work_item_type_template(type_key, writing_standards)
    SELECT key, jsonb_build_object('create', 'create prefix ' || $text$${original}$text$ || ' create suffix', 'edit', 'edit prefix ' || $text$${original}$text$ || ' edit suffix', 'other', 'unchanged') FROM unnest(ARRAY['DIAGRAM','DIAGRAM_ELEMENT']) key;
    INSERT INTO work_item_type_template(type_key, writing_standards) VALUES ('OTHER', '{"create":"unrelated"}');
    INSERT INTO work_item_type VALUES ('DIAGRAM', '{"create":"project override"}');
    INSERT INTO task VALUES ('existing Diagram');
    ${update}
    DO $test$ BEGIN
      IF (SELECT count(*) FROM work_item_type_template WHERE type_key IN ('DIAGRAM','DIAGRAM_ELEMENT') AND writing_standards->>'create' LIKE '%**Screen element.**%' AND writing_standards->>'edit' LIKE '%**Screen element.**%' AND writing_standards->>'create' LIKE 'create prefix % create suffix' AND writing_standards->>'edit' LIKE 'edit prefix % edit suffix' AND writing_standards->>'other' = 'unchanged') <> 2 THEN RAISE EXCEPTION 'Guidance or unrelated text changed incorrectly'; END IF;
      IF (SELECT writing_standards->>'create' FROM work_item_type WHERE type_key='DIAGRAM') <> 'project override' OR (SELECT name FROM task) <> 'existing Diagram' OR (SELECT writing_standards->>'create' FROM work_item_type_template WHERE type_key='OTHER') <> 'unrelated' THEN RAISE EXCEPTION 'Unrelated records changed'; END IF;
    END $test$;
    ROLLBACK;
    SELECT 'migration verified';`,
      },
    );
    expect(output).toContain('migration verified');
  },
);
