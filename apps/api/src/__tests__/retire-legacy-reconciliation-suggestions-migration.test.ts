import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'db/flyway/V2026.10.27.200000__retire_legacy_reconciliation_suggestions.sql',
  ),
  'utf8',
);

describe('V2026.10.27.200000: Retire legacy reconciliation suggestions', () => {
  it('adds RETIRED to the suggestion status constraint', () => {
    expect(migrationSql).toContain(
      "CHECK(status IN ('PENDING','ACCEPTED','REJECTED','SUPERSEDED','OUT_OF_DATE','RETIRED'))",
    );
  });

  it('retires only pending suggestions that came from a standalone correction', () => {
    expect(migrationSql).toContain(
      "UPDATE proposal_reconciliation_suggestions SET status = 'RETIRED'\nWHERE status = 'PENDING' AND legacy_proposal_id IS NOT NULL;",
    );
  });

  it('makes each linked old correction ineligible to apply before retiring it', () => {
    const ineligible = migrationSql.indexOf('SET application_eligible = false');
    expect(ineligible).toBeGreaterThan(-1);
    expect(ineligible).toBeLessThan(
      migrationSql.indexOf("SET status = 'RETIRED'"),
    );
    expect(migrationSql).toContain('SELECT legacy_proposal_id FROM');
  });

  it('leaves the original proposal alone', () => {
    expect(migrationSql).not.toMatch(
      /UPDATE proposals SET (?!application_eligible)/,
    );
    const statements = migrationSql.replace(/^--.*$/gm, '');
    expect(statements).not.toMatch(/revisions|approvals/);
  });
});
