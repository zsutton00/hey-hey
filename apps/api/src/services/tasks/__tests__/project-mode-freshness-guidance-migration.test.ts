import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.09.22.120000__publish_mode_freshness_guidance.sql',
);

describe('project MODE freshness guidance migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('updates only agent guidance on the canonical and active project-effective MODE rows', () => {
    expect(sql).toContain('UPDATE work_item_type_template AS mode');
    expect(sql).toContain('UPDATE work_item_type AS mode');
    expect(sql.match(/SET agent_guidance/g)).toHaveLength(2);
    expect(sql).toContain("mode.type_key = 'MODE'");
    expect(sql).toContain('mode.project_id IS NOT NULL');
    expect(sql).toContain("mode.lifecycle_status = 'active'");
    expect(sql).not.toContain('SET writing_standards');
    expect(sql).not.toContain('SET section_definitions');
    expect(sql).not.toContain('SET allowed_parent_types');
    expect(sql).not.toContain('SET capabilities');
    expect(sql).not.toContain('SET graph_configuration');
  });

  it('preserves unrelated guidance fields and appends the semantic block only once', () => {
    expect(sql).toContain(
      "jsonb_set(\n  COALESCE(mode.agent_guidance, '{}'::jsonb),\n  '{overview}'",
    );
    expect(sql).toContain('## MODE placement, eligibility, and freshness');
    expect(sql).toContain("NOT LIKE '%' || guidance.marker || '%'");
    expect(sql).toContain("concat_ws(E'\\n\\n'");
  });

  it('publishes the complete placement, eligibility, compatibility, and freshness semantics', () => {
    expect(sql).toContain('one structural owning Feature');
    expect(sql).toContain('Structural parentage locates the MODE');
    expect(sql).toContain(
      'RELATED_TO is also navigational and never filters launch',
    );
    expect(sql).toContain('Only outbound MODE-to-Feature DEPENDS_ON');
    expect(sql).toContain('target Feature and its descendants');
    expect(sql).toContain('no outbound Feature DEPENDS_ON is project-global');
    expect(sql).toContain('agentGuidance.contexts[].focalTypeKeys');
    expect(sql).toContain('neither axis replaces the other');
    expect(sql).toContain('requirements, decisions, and completed work evolve');
    expect(sql).toContain('targeted, user-reviewable MODE proposals');
    expect(sql).toContain('Never mutate MODE content directly');
  });

  it('fails clearly when the prerequisite MODE definition is absent', () => {
    expect(sql).toContain('canonical MODE template is missing');
    expect(sql).toContain('RAISE EXCEPTION');
  });
});
