import { readFileSync } from 'fs';
import { resolve } from 'path';

const sql = readFileSync(
  resolve(
    __dirname,
    '../../../../db/flyway/V2026.11.07.110000__make_eval_case_handler_sections_optional.sql',
  ),
  'utf8',
);

describe('V2026.11.07.110000: Eval Case handler sections are optional', () => {
  it('marks coding and consumerHandler optional on canonical and project-owned Eval Case types', () => {
    expect(sql).toContain("section->>'key' IN ('coding', 'consumerHandler')");
    expect(sql).toContain("'{required}', 'false'::jsonb");
    expect(sql).toMatch(/UPDATE work_item_type_template[\s\S]*?'EVAL_CASE'/u);
    expect(sql).toMatch(/UPDATE work_item_type\n[\s\S]*?'EVAL_CASE'/u);
  });

  it('keeps section order, leaves other sections alone, and is idempotent', () => {
    expect(sql).toContain('ORDER BY ordinal');
    expect(sql).toContain('ELSE section');
    expect(
      sql.match(/section_definitions IS DISTINCT FROM/gu) ?? [],
    ).toHaveLength(2);
  });
});
