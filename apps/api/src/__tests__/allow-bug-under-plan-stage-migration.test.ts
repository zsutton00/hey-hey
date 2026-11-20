import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name: string) =>
  readFileSync(join(process.cwd(), 'db/flyway', name), 'utf8');

describe('allow Bug under Plan Stage migrations', () => {
  const parentage = read('V2026.11.19.083000__allow_bug_under_plan_stage.sql');
  const monitorKind = read(
    'V2026.11.19.083100__allow_bug_in_task_monitor_task_kind.sql',
  );

  it('changes only the canonical BUG template and keeps FEATURE', () => {
    expect(parentage).toContain('UPDATE work_item_type_template');
    expect(parentage).toContain("WHERE type_key = 'BUG'");
    expect(parentage).toContain('allowed_parent_types || \'["PLAN_STAGE"]\'');
    expect(parentage).not.toMatch(/UPDATE work_item_type\s/);
    expect(parentage).not.toContain("PLAN_STAGE' ,");
  });

  it('changes only the published task monitor kind on the canonical template', () => {
    expect(monitorKind).toContain('UPDATE work_item_type_template');
    expect(monitorKind).not.toMatch(/UPDATE work_item_type\s/);
    expect(monitorKind).toContain(
      "declared.kind -> 'allowedNodeTypes' = '[\"STANDARD\"]'::jsonb",
    );
  });
});
