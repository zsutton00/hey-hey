import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(__dirname, '../V2026.09.16.2__repair_plan_status_policy.sql'),
  'utf8',
);

describe('Plan VERIFYING status policy migration', () => {
  it('repairs both canonical and project-effective status sets', () => {
    expect(sql).toContain('UPDATE work_item_type_template');
    expect(sql).toContain('UPDATE work_item_type');
    expect(sql).toContain("type_key = 'PLAN'");
    expect(sql).toContain("'[\"VERIFYING\"]'::jsonb");
    expect(sql).toContain('allowed_statuses');
    expect(sql).toContain('agent_settable_statuses');
  });

  it('fails if either PLAN status set remains incomplete', () => {
    expect(sql).toContain(
      "RAISE EXCEPTION 'PLAN status policy does not include VERIFYING in both status sets'",
    );
  });
});
