import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('recoverable organization account lifecycle migrations', () => {
  const enumSql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.30.1__add_recoverable_account_lifecycle_states.sql',
    ),
    'utf8',
  );
  const milestoneSql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.30.2__separate_account_lifecycle_milestones.sql',
    ),
    'utf8',
  );

  it('adds enum values in a migration before using them', () => {
    expect(enumSql).toContain("ADD VALUE IF NOT EXISTS 'SUSPENDED'");
    expect(enumSql).toContain("ADD VALUE IF NOT EXISTS 'IRREVERSIBLY_CLOSED'");
    expect(milestoneSql).not.toContain('ALTER TYPE');
  });

  it('separates access, deletion eligibility, irreversible closure, and deletion', () => {
    expect(milestoneSql).toContain('access_ends_at TIMESTAMPTZ');
    expect(milestoneSql).toContain('deletion_eligible_at TIMESTAMPTZ');
    expect(milestoneSql).toContain('irreversible_closure_at TIMESTAMPTZ');
    expect(milestoneSql).toContain('deleted_at TIMESTAMPTZ');
    expect(milestoneSql).toContain("INTERVAL '27 days'");
    expect(milestoneSql).toContain("lifecycle_state = 'SUSPENDED'");
    expect(milestoneSql).toContain("lifecycle_state = 'IRREVERSIBLY_CLOSED'");
  });
});
