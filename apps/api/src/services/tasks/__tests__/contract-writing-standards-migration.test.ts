import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.13.1__teach_contract_discovery_at_workflow_boundaries.sql',
);

describe('Contract writing-standards migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('tightens only the canonical Contract template', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`WHERE "type_key" = 'CONTRACT'`);
    expect(sql).not.toContain('UPDATE "work_item_type"\n');
    expect(sql).not.toContain('"is_system"');
    expect(sql).not.toContain('"lifecycle_status"');
  });

  it('fails fast when the canonical Contract template is missing', () => {
    expect(sql).toContain('IF NOT EXISTS (');
    expect(sql).toContain(
      'Cannot update Contract discovery guidance; canonical Contract template is missing',
    );
  });

  it('updates the registry description injected into the dynamic system prompt', () => {
    expect(sql).toContain(
      'A user-authored, first-class marker that a narrowly stated durable agreement exists at a concrete boundary.',
    );
    expect(sql).toContain(
      'A durable authoritative producer interface may qualify before a consumer exists.',
    );
    expect(sql).toContain(
      'workflow participation is recorded only for steps evidenced as authoring or enforcing the agreement',
    );
  });

  it('recognizes bounded producer interfaces and rejects broad or ad hoc boundaries', () => {
    expect(sql).toContain(
      "current workflow step''s concrete inputs, outputs, and responsibility",
    );
    expect(sql).toContain(
      'outside a workflow, use the narrowest authoritative operation, work item, design artifact, or schema',
    );
    expect(sql).toContain(
      'a durable authoritative producer interface can qualify before a consumer exists',
    );
    expect(sql).toContain(
      'Ad hoc interactions, broad communication channels, reference roll-ups, whole services or repositories, and schema mentions without a narrowly stated agreement do not qualify',
    );
  });

  it('uses exact workflow dependency vocabulary and evidence-based cardinality', () => {
    expect(sql).toContain(
      'each evidenced authoring or enforcement participant with `workflow_step DEPENDS_ON Contract`',
    );
    expect(sql).toContain(
      'let the known boundary determine participant count',
    );
    expect(sql).toContain('exclude steps that merely consume output or occur downstream');
    expect(sql).toContain('Keep flow and `FULFILLED_BY` links separate');
  });
});
