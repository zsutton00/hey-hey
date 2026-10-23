import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('closure provider correlation tombstone migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.19.5__retain_closure_provider_correlation.sql',
    ),
    'utf8',
  );

  it('retains only sanitized provider/environment correlation linked to closure evidence', () => {
    expect(sql).toMatch(
      /CREATE TABLE organization_closure_provider_correlation_tombstones/,
    );
    expect(sql).toContain('organization_id TEXT NOT NULL');
    expect(sql).toContain(
      'REFERENCES organization_deletion_markers(id) ON DELETE RESTRICT',
    );
    expect(sql).toContain('provider VARCHAR(64) NOT NULL');
    expect(sql).toContain('environment VARCHAR(32) NOT NULL');
    expect(sql).toContain('external_customer_id VARCHAR(255)');
    expect(sql).toContain('external_subscription_id VARCHAR(255)');
    expect(sql).not.toMatch(/payload|secret|credential|card|financial/iu);
  });

  it('indexes both opaque identifiers and makes a marker snapshot idempotent', () => {
    expect(sql).toContain(
      'organization_closure_provider_correlation_customer_idx',
    );
    expect(sql).toContain(
      'organization_closure_provider_correlation_subscription_idx',
    );
    expect(sql).toContain(
      'organization_closure_provider_correlation_snapshot_idx',
    );
  });
});
