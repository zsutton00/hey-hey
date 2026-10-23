import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.13.2__make_contract_definition_intent_first.sql',
);

describe('Intent-first Contract definition migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('updates only the canonical Contract prose and timestamp', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`WHERE "type_key" = 'CONTRACT'`);
    expect(sql).toContain('"description" = $contract_description$');
    expect(sql).toContain('"writing_standards" = jsonb_build_object(');
    expect(sql).toContain('"updated_at" = CURRENT_TIMESTAMP');
    expect(sql).not.toContain('UPDATE "work_item_type"');

    for (const untouchedColumn of [
      '"name" =',
      '"section_definitions" =',
      '"allowed_parent_types" =',
      '"allowed_child_types" =',
      '"edge_targets" =',
      '"allowed_statuses" =',
      '"required_scalars" =',
      '"forbidden_scalars" =',
      '"parentage" =',
      '"tracking" =',
      '"agent_settable_statuses" =',
      '"anchorable_report_types" =',
      '"capabilities" =',
      '"graph_configuration" =',
    ]) {
      expect(sql).not.toContain(untouchedColumn);
    }
  });

  it('fails fast when the canonical Contract template is missing', () => {
    expect(sql).toContain('IF NOT EXISTS (');
    expect(sql).toContain(
      'Cannot update intent-first Contract definition; canonical Contract template is missing',
    );
  });

  it('defines provider-owned intent independently of consumer count', () => {
    expect(sql).toContain(
      'a provider intentionally offers a stable interaction point and promises defined behavior',
    );
    expect(sql).toContain(
      'The promise may have zero, one, or many consumers: consumer count does not create, validate, or invalidate the Contract.',
    );
    expect(sql).toContain(
      'Consumer presence is a downstream fact, not the creation threshold',
    );
  });

  it('treats workflows as discovery and anchoring surfaces, not validity requirements', () => {
    expect(sql).toContain(
      'Workflows are a primary discovery and anchoring surface',
    );
    expect(sql).toContain(
      'workflow participation is not required for Contract validity',
    );
    expect(sql).toContain(
      'Workflow authoring creates a strong discovery moment, but it never proves that every boundary step is contractual.',
    );
    expect(sql).toContain(
      'When a workflow step authors or enforces the agreement, link that responsible workflow_step with `DEPENDS_ON`',
    );
  });

  it('uses state-machine and REST/CRUD positives with ordinary-topology negatives', () => {
    expect(sql).toContain(
      'A state-machine entry is a positive example when its provider promises that valid initial state starts the machine under defined semantics',
    );
    expect(sql).toContain(
      'A deliberate REST or CRUD operation is likewise contractual when its provider intentionally offers the operation and promises defined behavior under stated conditions',
    );
    expect(sql).toContain(
      'A task that happens to update two features or reuse a schema is a negative example',
    );
    expect(sql).toContain(
      'keep those cases as inline mentions and ordinary typed edges unless recorded design intent establishes a stable guarantee',
    );
    expect(sql).not.toContain('AuditRecord');
  });

  it('keeps flow and fulfillment links distinct from Contract dependencies', () => {
    expect(sql).toContain(
      'keep flow and `FULFILLED_BY` links separate, and do not link steps that merely consume output or occur downstream',
    );
    expect(sql).toContain(
      'keep flow and `FULFILLED_BY` links separate from `DEPENDS_ON` Contract links',
    );
  });
});
