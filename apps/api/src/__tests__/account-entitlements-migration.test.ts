import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('account entitlement migration contract', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.17.2__create_account_entitlements.sql',
    ),
    'utf8',
  );

  it('owns exactly one current entitlement per organization with positive revisions', () => {
    expect(sql).toMatch(
      /organization_id TEXT PRIMARY KEY\s+REFERENCES organizations\(id\)/,
    );
    expect(sql).toContain('CHECK (revision > 0)');
  });

  it('keeps beta paid-through data impossible in current and transition rows', () => {
    expect(
      sql.match(/subscription_type <> 'BETA' OR paid_through_at IS NULL/g),
    ).toHaveLength(2);
  });

  it('owns append-only evidence by organization and revision', () => {
    expect(sql).toContain(
      'REFERENCES account_entitlements(organization_id) ON DELETE CASCADE',
    );
    expect(sql).toContain('UNIQUE (organization_id, to_revision)');
    expect(sql).toContain('to_revision = from_revision + 1');
  });

  it('backfills admitted organizations without provider-shaped fields', () => {
    expect(sql).toContain('FROM organizations AS organization');
    expect(sql).not.toMatch(
      /customer_id|subscription_id|price_id|provider_status|credential|secret|raw_payload/,
    );
  });
});
