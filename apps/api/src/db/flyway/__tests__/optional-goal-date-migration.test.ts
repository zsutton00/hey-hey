import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.10.12.214740__allow_undated_goals.sql',
  ),
  'utf8',
);

describe('optional canonical Goal dates', () => {
  it('retains top-level enforcement without requiring a deadline', () => {
    expect(sql).toContain("CHECK (type <> 'GOAL' OR parent_task_id IS NULL)");
    expect(sql).not.toContain('due_date IS NOT NULL');
  });

  it('changes only the canonical Goal policy, preserving project overrides', () => {
    expect(sql).toContain("required_scalars = required_scalars - 'dueDate'");
    expect(sql).toContain("WHERE type_key = 'GOAL'");
    expect(sql.match(/UPDATE\s+\w+/g)).toEqual([
      'UPDATE work_item_type_template',
    ]);
    expect(sql).toContain('explicit null clears it');
  });
});
