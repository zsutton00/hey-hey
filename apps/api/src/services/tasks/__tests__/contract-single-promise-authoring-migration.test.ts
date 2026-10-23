import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.08.27.2__harden_contract_single_promise_authoring.sql',
);

describe('Contract single-promise authoring migration', () => {
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
    expect(sql).toContain('"writing_standards" = jsonb_set(');
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
      'Cannot harden Contract single-promise authoring; canonical Contract template is missing',
    );
  });

  it('defines one provider-owned promise rather than an umbrella integration', () => {
    const description = taggedBody('contract_description');

    expect(description).toContain(
      'one deliberately designed, durable promise made by an identified provider',
    );
    expect(description).toContain('A Contract owns one promise.');
    expect(description).toContain(
      'combining admission, dispatch, publication, replay, consumer synchronization, and downstream use into one umbrella Contract',
    );
    expect(description).toContain(
      'Every part of the promise must be controlled by the provider or enforced at its owned boundary.',
    );
  });

  it('makes multi-boundary and overlapping requests a mandatory user-selection stop', () => {
    const create = taggedBody('contract_create');

    expect(create).toContain('## Mandatory umbrella hard stop');
    expect(create).toContain('This is a hard stop, not a drafting preference.');
    expect(create).toContain(
      'Producing one Contract would require choosing the "strongest", "best",',
    );
    expect(create).toContain(
      'Do not resolve an umbrella request by silently selecting one candidate',
    );
    expect(create).toContain(
      'When an existing Contract substantially overlaps the candidate, do not create a\nduplicate.',
    );
    expect(create).toContain(
      'the user has already selected one\nspecific promise',
    );
  });

  it('requires the two-paragraph high-level and boundary-specific description shape', () => {
    const create = taggedBody('contract_create');
    const edit = taggedBody('contract_edit');

    for (const guidance of [create, edit]) {
      const normalized = guidance.replace(/\s+/g, ' ');

      expect(guidance).toContain('## Required two-paragraph description');
      expect(guidance).toContain('exactly two prose paragraphs');
      expect(guidance).toContain(
        'exactly one high-level sentence beginning with\n"Guarantees"',
      );
      expect(normalized).toContain(
        'the provider and its owned interaction point',
      );
    }
  });

  it('separates adjacent providers and separately owned promises', () => {
    const create = taggedBody('contract_create');
    const edit = taggedBody('contract_edit');

    expect(create).toContain(
      'Split admission, dispatch, publication, persistence, replay, and consumption',
    );
    expect(create).toContain(
      "Do not absorb an adjacent Contract's promise. Cite it as a dependency",
    );
    expect(edit).toContain(
      'Do not merge upstream admission, transport,\npublication, persistence, replay, synchronization, and consumer behavior',
    );
    expect(edit).toContain(
      'When another Contract owns an adjacent guarantee, retain that ownership',
    );
  });

  it('keeps topology separate while allowing explicit Contract dependencies', () => {
    expect(
      sql.match(/The structural parent is the owning feature/g),
    ).toHaveLength(2);
    expect(
      sql.match(/Use Contract `DEPENDS_ON` when this promise relies/g),
    ).toHaveLength(2);
    expect(
      sql.match(/Use `workflow_step DEPENDS_ON Contract` only for steps/g),
    ).toHaveLength(2);
  });
});
