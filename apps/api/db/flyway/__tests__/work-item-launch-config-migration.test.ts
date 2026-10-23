import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../V2026.09.07.1__persist_work_item_launch_config.sql',
);

describe('V2026.09.07.1: work-item launch configuration persistence', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('adds nullable task config with an object envelope check', () => {
    expect(sql).toContain('"config" JSONB');
    expect(sql).toContain('"tasks_config_shape_check"');
    expect(sql).toContain('jsonb_typeof("config") = \'object\'');
    expect(sql).toContain("jsonb_typeof(\"config\" -> 'kind') = 'string'");
    expect(sql).toContain("jsonb_typeof(\"config\" -> 'version') = 'string'");
  });

  it('backfills explicit config-kind policy on templates and project rows', () => {
    expect(sql).toContain('"accepted_config_kinds" JSONB');
    expect(sql).toContain(
      'WHEN "type_key" = \'STANDARD\' THEN \'["INITIAL_WORKTREE"]\'::jsonb',
    );
    expect(sql).toContain("ELSE '[]'::jsonb");
    expect(sql).toContain(
      '"work_item_type_template_accepted_config_kinds_shape_check"',
    );
    expect(sql).toContain('"work_item_type_accepted_config_kinds_shape_check"');
    expect(
      sql.match(/ALTER COLUMN "accepted_config_kinds" SET NOT NULL/g),
    ).toHaveLength(2);
  });

  it('does not materialize a checkout or introduce a per-type column', () => {
    expect(sql).not.toMatch(/worktree|checkout/i);
    expect(sql).not.toContain('initial_worktree');
  });
});
