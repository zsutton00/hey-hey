import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('organization closure evidence migration contract', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.17.4__create_organization_closure_evidence.sql',
    ),
    'utf8',
  );

  it('retains exactly one marker and execution per organization', () => {
    expect(sql).toMatch(
      /CREATE TABLE organization_deletion_markers \(\s+organization_id TEXT PRIMARY KEY/,
    );
    expect(sql).toMatch(
      /CREATE TABLE organization_closure_executions \(\s+organization_id TEXT PRIMARY KEY/,
    );
    expect(sql).not.toMatch(/REFERENCES organizations\(id\)/);
    expect(sql).toContain('organization_closure_executions_marker_fkey');
    expect(sql).toMatch(
      /marker_id,\s+organization_id,\s+effective_closure_at,\s+deletion_deadline\s+\) REFERENCES organization_deletion_markers/,
    );
  });

  it('pins the once-derived deadline and immutable closure identity', () => {
    expect(
      sql.match(
        /deletion_deadline = effective_closure_at \+ INTERVAL '30 days'/g,
      ),
    ).toHaveLength(2);
    expect(sql).toContain('organization_deletion_markers_immutable');
    expect(sql).toContain('organization_closure_executions_immutable');
    expect(sql).toContain(
      "RAISE EXCEPTION 'organization closure identity and deadline evidence is immutable'",
    );
  });

  it('stores fenced retry and bounded terminal failure evidence', () => {
    expect(sql).toContain('attempt_count INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('attempt_id TEXT');
    expect(sql).toContain('claim_token TEXT');
    expect(sql).toContain('lease_expires_at TIMESTAMPTZ');
    expect(sql).toContain('next_retry_at TIMESTAMPTZ');
    expect(sql).toContain('last_failure VARCHAR(2000)');
    expect(sql).toContain('revision INTEGER NOT NULL DEFAULT 1');
    expect(sql).toContain('organization_closure_executions_claim_check');
    expect(sql).toContain('organization_closure_executions_terminal_check');
  });
});
