import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.09.30.071500__allow_diagram_element_informational_links.sql',
  ),
  'utf8',
);

describe('allow Diagram Element informational links migration', () => {
  it('declares the informational link types as meta element-to-external links', () => {
    expect(migration).toContain(
      "ARRAY['RELATED_TO','DERIVES_FROM','CONTRADICTS','EVOLVES']",
    );
    expect(migration).toContain("'category', 'meta'");
    expect(migration).toContain(
      "jsonb_build_object('role','graphNode','entityTypes',jsonb_build_array('TASK'),\n      'workItemTypeKeys',jsonb_build_array('DIAGRAM_ELEMENT'))",
    );
    expect(migration).toContain(
      "jsonb_build_object('role','externalEntity','entityTypes',jsonb_build_array('TASK'))",
    );
  });

  it('makes them both editable and readable on canonical and project Diagram rows', () => {
    expect(migration).toContain('{readableRelationships}');
    expect(migration).toContain('{editableRelationships}');
    expect(migration).toContain('UPDATE work_item_type_template');
    expect(migration).toContain('UPDATE work_item_type\n');
    expect(migration.match(/WHERE type_key = 'DIAGRAM';/g)).toHaveLength(2);
  });

  it('is idempotent per edge type', () => {
    expect(
      migration.match(/WHERE r->>'edgeType' = d->>'edgeType'/g),
    ).toHaveLength(2);
  });

  it('leaves SUPERSEDES out and keeps flow, FULFILLED_BY and Contract declarations untouched', () => {
    expect(migration).not.toMatch(/ARRAY\[[^\]]*'SUPERSEDES'/);
    expect(migration).toContain(
      "RAISE EXCEPTION 'SUPERSEDES must not be an editable Diagram relationship'",
    );
    for (const edgeType of [
      'STANDARD',
      'CONDITIONAL',
      'LOOP',
      'FULFILLED_BY',
      'GUARANTEES',
      'IMPLEMENTS',
      'CONSUMES',
    ]) {
      expect(migration).not.toContain(`'${edgeType}'`);
    }
    expect(migration).not.toContain('edge_targets =');
  });
});
