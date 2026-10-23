import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const sql = readFileSync(
  join(
    process.cwd(),
    'db/flyway/V2026.10.21.130000__clarify_decision_intent_and_maintenance_guidance.sql',
  ),
  'utf8',
);

describe('decision intent guidance migration', () => {
  it('updates only the canonical decision template', () => {
    expect(sql).toContain('UPDATE work_item_type_template');
    expect(sql).toContain("WHERE type_key = 'decision'");
    expect(sql).not.toContain('work_item_type ');
    expect(sql).not.toContain('project_id');
  });

  it('adds the direction statement to description and semantic overview', () => {
    expect(sql).toContain("not proof of the project''s current implementation");
    expect(sql).toContain('jsonb_set(');
    expect(sql).toContain("'{overview}'");
    expect(sql).toContain('which may still need implementation');
  });

  it('adds maintenance advice for links, consistency and gaps', () => {
    expect(sql).toContain('maintenance_guidance');
    expect(sql).toContain('accurate typed relationships');
    expect(sql).toContain('surface each discrepancy');
    expect(sql).toContain('do not rewrite the Decision to match drift');
  });

  it('leaves structural and authoring fields untouched', () => {
    for (const column of [
      'section_definitions',
      'edge_targets',
      'allowed_statuses',
      'writing_standards',
      'parentage',
    ]) {
      expect(sql).not.toContain(column);
    }
  });
});
