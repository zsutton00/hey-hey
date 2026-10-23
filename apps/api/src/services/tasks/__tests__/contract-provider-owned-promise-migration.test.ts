import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.19.2__constrain_contract_guidance_to_provider_owned_promises.sql',
);

describe('Provider-owned Contract promise migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  function taggedBody(tag: string): string {
    const match = sql.match(
      new RegExp(`\\$${tag}\\$\\n([\\s\\S]*?)\\n\\$${tag}\\$`),
    );
    if (!match) {
      throw new Error(`Expected migration body tagged ${tag}`);
    }
    return match[1]!;
  }

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
      'Cannot constrain Contract guidance; canonical Contract template is missing',
    );
  });

  it('defines exactly one provider-controlled observable promise', () => {
    expect(taggedBody('contract_description')).toBe(
      [
        'A Contract records one durable promise made by an identified provider at an owned interaction point: when stated conditions are met, the provider guarantees a stated, observable delivery. Every part of the promise must be within the provider’s control or enforced by its owned boundary.',
        'The Contract records only that promise. It does not describe consumer UX, workflow context, downstream use, implementation, exact payload shape, or behavior merely expected from a third party. It points to the authoritative source without replacing it.',
      ].join('\n\n'),
    );
    expect(sql).toContain(
      '> When <conditions>, <provider> guarantees <observable delivery>.',
    );
    expect(sql).toContain(
      'If a clause cannot be enforced by the named provider, either restate it as',
    );
    expect(sql).not.toContain('A state-machine entry is a positive example');
    expect(sql).not.toContain('A deliberate REST or CRUD operation');
  });

  it('admits only clauses that distinguish fulfillment from breach', () => {
    expect(sql).toContain(
      'whether that same delivery was fulfilled or breached, such as timing,',
    );
    expect(sql).toContain('- How can fulfillment or breach be observed?');
    expect(sql).toContain('every sentence must distinguish fulfillment');
    expect(sql).toContain(
      'consumer UX, workflow context, downstream use, implementation, exact payload shape, or behavior merely expected from a third party',
    );
  });

  it('reconciles authority and topology only after writing the promise', () => {
    const createPromiseIndex = sql.indexOf('## Writing the description');
    const createTopologyIndex = sql.indexOf(
      '## Reconcile topology after writing',
      createPromiseIndex,
    );
    const editPromiseIndex = sql.indexOf('## Editing a Contract');
    const editTopologyIndex = sql.indexOf(
      '## Reconcile topology after writing',
      editPromiseIndex,
    );

    expect(createPromiseIndex).toBeGreaterThan(-1);
    expect(createTopologyIndex).toBeGreaterThan(createPromiseIndex);
    expect(editPromiseIndex).toBeGreaterThan(-1);
    expect(editTopologyIndex).toBeGreaterThan(editPromiseIndex);
    expect(sql).toContain(
      'Keep authority and participation separate from the promise body.',
    );
    expect(
      sql.match(/The structural parent is the owning feature/g),
    ).toHaveLength(2);
    expect(
      sql.match(/Use `workflow_step DEPENDS_ON Contract` only for steps/g),
    ).toHaveLength(2);
  });
});
