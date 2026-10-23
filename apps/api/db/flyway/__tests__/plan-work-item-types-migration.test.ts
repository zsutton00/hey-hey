import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(__dirname, '../V2026.09.11.4__seed_plan_work_item_types.sql'),
  'utf8',
);

describe('Plan work-item type seed migration', () => {
  it.each([
    ['PLAN', 'Plan'],
    ['PLAN_STAGE', 'Plan stage'],
  ])('supplies the required classification role for %s', (key, name) => {
    const inserts = sql.match(
      /INSERT INTO work_item_type_template\s*\([\s\S]*?;/g,
    );
    const insert = inserts?.find((statement) =>
      statement.includes(`'${key}',`),
    );

    expect(insert).toBeDefined();
    expect(insert).toMatch(/id, type_key, name, role, icon_key/);
    expect(insert).toContain(`'${key}',\n  '${name}',\n  'project-info',`);
  });
});
