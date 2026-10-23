import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('organization account lifecycle migration contract', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.17.3__create_organization_account_lifecycles.sql',
    ),
    'utf8',
  );

  it('owns one lifecycle row per organization with a positive revision', () => {
    expect(sql).toMatch(
      /organization_id TEXT PRIMARY KEY\s+REFERENCES organizations\(id\)/,
    );
    expect(sql).toContain('CHECK (revision > 0)');
  });

  it('requires closure evidence exactly when the lifecycle is not active', () => {
    expect(sql.match(/lifecycle_state = 'ACTIVE'/g)).toHaveLength(2);
    expect(sql.match(/effective_closure_at IS NULL/g)).toHaveLength(2);
    expect(sql.match(/closure_entitlement_revision IS NULL/g)).toHaveLength(2);
    expect(sql.match(/closure_entitlement_revision > 0/g)).toHaveLength(2);
  });

  it('records append-only, gap-free lifecycle transition evidence', () => {
    expect(sql).toContain(
      'REFERENCES organization_account_lifecycles(organization_id) ON DELETE CASCADE',
    );
    expect(sql).toContain('UNIQUE (organization_id, to_revision)');
    expect(sql).toContain('to_revision = from_revision + 1');
  });
});
