import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.27.1__make_contract_definition_deliberate_integration.sql',
);

describe('Deliberate Contract integration migration', () => {
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

  it('updates only canonical Contract prose and its timestamp', () => {
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
      'Cannot update deliberate Contract definition; canonical Contract template is missing',
    );
  });

  it('defines a deliberately designed integration with concrete inputs and broad guaranteed behavior', () => {
    expect(taggedBody('contract_description')).toBe(
      [
        'A Contract records a deliberately designed, durable integration agreement between two or more systems. At an identified provider’s owned interaction point, it defines the concrete input or triggering conditions the provider accepts and the provider-controlled behavior guaranteed when those conditions are met. The guaranteed behavior may be any observable consequence, including a returned result, acknowledgement, state transition, workflow continuation, event, side effect, rejection, preservation rule, or timing or availability guarantee. Every part of the promise must be controlled by the provider or enforced at its owned boundary.',
        'A Contract cannot be inferred from implementation alone. Code, schemas, endpoints, workflows, tests, and current consumer behavior may demonstrate fulfillment or breach, but they do not establish the design intent that creates the Contract.',
        'The Contract records only the durable promise. It lets participating systems treat one another’s internal implementation as a black box, points to the authoritative source for exact representation, and excludes consumer UX, workflow narrative, downstream use, implementation mechanics, and maintenance plans.',
      ].join('\n\n'),
    );
    expect(sql).toContain(
      '> At <interaction point>, when <input or triggering conditions>, <provider> guarantees <provider-controlled observable behavior>.',
    );
    expect(sql).toContain('The guaranteed behavior need not be a response payload.');
    expect(sql).toContain('workflow continuation');
  });

  it('requires user participation and never treats implementation as proof', () => {
    expect(sql).toContain('A Contract proposal requires user participation.');
    expect(sql).toContain(
      'the user affirmatively confirms that it should be\nauthored',
    );
    expect(sql).toContain(
      'Discovery permits suggestion and discussion; it does not authorize\nan immediate proposal.',
    );
    expect(sql).toContain(
      'They\ncannot, by themselves, prove that a Contract exists or establish its intended\npromise.',
    );
    expect(sql).toContain(
      'Never reverse-engineer\nthe current implementation into a Contract and present it as intentional design.',
    );
  });

  it('preserves black-box implementation freedom and considers evolution', () => {
    expect(sql).toContain(
      'depend on the agreement without\ndepending on one another’s internal implementation',
    );
    expect(sql).toContain(
      'Consider how the\nintegration can be maintained or extended without accidental breakage',
    );
    expect(sql).toContain(
      'recording only observable compatibility or evolution guarantees in the\nContract body',
    );
    expect(sql).toContain(
      'Never rewrite a Contract merely to match implementation drift.',
    );
  });

  it('keeps authority and topology outside the promise body', () => {
    expect(
      sql.match(/The structural parent is the owning feature/g),
    ).toHaveLength(2);
    expect(
      sql.match(/Use `workflow_step DEPENDS_ON Contract` only for steps/g),
    ).toHaveLength(2);
    expect(sql).toContain(
      'point to the authoritative\noperation, schema, or design source for exact representation',
    );
  });
});
