import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(
    process.cwd(),
    'db/flyway/V2026.11.05.100200__teach_feature_concise_requirements.sql',
  ),
  'utf8',
);

it('appends the concise-requirement advice to canonical FEATURE create and edit standards only', () => {
  for (const operation of ['create', 'edit']) {
    expect(sql).toContain(`'{${operation}}'`);
    expect(sql).toContain(`template."writing_standards"->>'${operation}'`);
  }
  expect(sql.match(/\|\| concise_guidance.value/g)).toHaveLength(2);
  expect(sql).toContain(`WHERE template."type_key" = 'FEATURE'`);
  expect(sql).toContain('as concise as possible');
  expect(sql).toContain('self-contained summary of the promised behavior');
});

it('leaves project-owned definitions and the table shape untouched', () => {
  expect(sql).not.toMatch(/work_item_type_definition|project_work_item_type/i);
  expect(sql).not.toMatch(/ALTER TABLE|CREATE TABLE|ADD COLUMN/i);
});
