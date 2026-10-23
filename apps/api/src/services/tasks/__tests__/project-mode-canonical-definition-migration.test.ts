import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.22.203142__canonicalize_mode_purpose_and_semantic_guidance.sql',
);
const terminologyMigrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.22.224409__rename_mode_to_agent_mode.sql',
);

describe('canonical MODE definition migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');
  const terminologySql = readFileSync(terminologyMigrationPath, 'utf8');

  it('publishes the Agent Mode display name and agreed purpose on the canonical template', () => {
    expect(terminologySql).toContain('UPDATE work_item_type_template AS mode');
    expect(terminologySql).toContain("WHERE mode.type_key = 'MODE'");
    expect(terminologySql).toContain("'Agent Mode'::text AS display_name");
    expect(terminologySql).toContain('SET name = canonical.display_name');
    expect(terminologySql).toContain('analogous to a skill');
    expect(terminologySql).not.toContain('UPDATE work_item_type AS mode');
  });

  it('fails clearly when the Agent Mode terminology prerequisite is absent', () => {
    expect(terminologySql).toContain('canonical MODE template is missing');
    expect(terminologySql).toContain('RAISE EXCEPTION');
  });

  it('publishes the user-facing purpose on the canonical template', () => {
    expect(sql).toContain('UPDATE work_item_type_template AS mode');
    expect(sql).toContain("WHERE mode.type_key = 'MODE'");
    expect(sql).toContain('SET description = canonical.purpose');
    expect(sql).toContain("$mode_purpose$::text, E'\\n') AS purpose");
    expect(sql).toContain(
      'A reusable set of instructions for how an agent approaches work.',
    );
    expect(sql).not.toContain('UPDATE work_item_type AS mode');
  });

  it('publishes the reusable-approach semantic guidance without removing other guidance fields', () => {
    expect(sql).toContain(
      "jsonb_set(\n      COALESCE(mode.agent_guidance, '{}'::jsonb),\n      '{overview}'",
    );
    expect(sql).toContain(
      "$mode_guidance$::text, E'\\n') AS semantic_guidance",
    );
    expect(sql).toContain(
      'A mode captures a reusable approach an agent can apply across sessions',
    );
    expect(sql).toContain('Repeated subject matter alone is insufficient');
    expect(sql).toContain(
      'Preparing Thursday’s briefing is the individual request',
    );
    expect(sql).toContain(
      'A mode guides the selected session’s behavior; it does not grant additional tools or permissions.',
    );
    expect(sql).toContain(
      'Skills remain separately reusable guidance for particular activities.',
    );
  });

  it('retains the canonical placement, eligibility, and freshness semantics', () => {
    expect(sql).toContain('## MODE placement, eligibility, and freshness');
    expect(sql).toContain('one structural owning Feature');
    expect(sql).toContain('Only outbound MODE-to-Feature DEPENDS_ON');
    expect(sql).toContain('Never mutate MODE content directly');
  });

  it('fails clearly when the prerequisite canonical definition is absent', () => {
    expect(sql).toContain('canonical MODE template is missing');
    expect(sql).toContain('RAISE EXCEPTION');
  });
});
