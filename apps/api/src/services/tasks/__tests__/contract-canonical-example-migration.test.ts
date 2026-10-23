import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.03.1__move_contract_example_into_canonical_definition.sql',
);

describe('Canonical Contract example migration', () => {
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

  it('stores the approved canonical description byte-for-byte', () => {
    expect(taggedBody('contract_description')).toBe(
      [
        'A Contract records one deliberately designed, durable promise made by an identified provider at an owned interaction point. It states the concrete input or triggering conditions accepted at that boundary and the provider-controlled result guaranteed when those conditions are met. Contracts are not processes themselves, in fact they allow for systems to be black boxes for consumers.',
        'A Contract cannot be inferred from implementation alone. Code, schemas, tests, and current consumer behavior may reveal a candidate or demonstrate fulfillment or breach however. Violation of a contract should be considered high priority and always raised to the user',
        'Example:\nGood: “When a consumer calls the marketing-start endpoint with a `productId` and `message`, the provider guarantees that the marketing workflow is started.” Not automatically a Contract: “On startup, the workflow queue will be drained.” The first names a concrete boundary and observable provider-owned delivery; the second describes internal lifecycle behavior unless it is deliberately guaranteed at an owned boundary.',
      ].join('\n\n'),
    );
  });

  it('updates only the canonical Contract description and timestamp', () => {
    expect(sql).toContain('UPDATE "work_item_type_template"');
    expect(sql).toContain(`WHERE "type_key" = 'CONTRACT'`);
    expect(sql).toContain('"description" = $contract_description$');
    expect(sql).toContain('"updated_at" = CURRENT_TIMESTAMP');
    expect(sql).not.toContain('UPDATE "work_item_type"');
    expect(sql).not.toContain('"writing_standards" =');

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
      'Cannot move Contract example into canonical definition; canonical Contract template is missing',
    );
  });
});
