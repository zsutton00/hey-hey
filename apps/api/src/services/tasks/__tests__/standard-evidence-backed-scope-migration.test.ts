import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../../../../db/flyway/V2026.07.20.1__require_evidence_backed_standard_scope.sql',
);

describe('STANDARD evidence-backed-scope migration', () => {
  const sql = readFileSync(migrationPath, 'utf8');

  it('updates only the active system STANDARD definition', () => {
    expect(sql).toContain(`WHERE "work_item_type"."type_key" = 'STANDARD'`);
    expect(sql).toContain(`AND "work_item_type"."is_system" = true`);
    expect(sql).toContain(`AND "work_item_type"."lifecycle_status" = 'active'`);
  });

  it('appends the same evidence boundary to create and edit guidance', () => {
    expect(sql).toContain(
      `'create', "writing_standards"->>'create' || evidence_backed_scope.value`,
    );
    expect(sql).toContain(
      `'edit', "writing_standards"->>'edit' || evidence_backed_scope.value`,
    );
    expect(sql).toContain(
      "user's request or authoritative, non-archived project",
    );
    expect(sql).toContain(
      'Plausibility, completeness, convention, likely edge cases, and general',
    );
    expect(sql).toContain(
      'Engineering standards may constrain how authorized work is implemented',
    );
  });

  it('requires a full support audit without letting acceptance criteria add scope', () => {
    expect(sql).toContain(
      'audit every substantive behavior,\nimplementation decision, scope boundary, and acceptance criterion',
    );
    expect(sql).toContain('Remove unsupported claims');
    expect(sql).toContain('surface the gap instead of resolving it silently');
    expect(sql).toContain(
      'Acceptance criteria are a\nprojection of established scope, not a place to elaborate it',
    );
  });
});
