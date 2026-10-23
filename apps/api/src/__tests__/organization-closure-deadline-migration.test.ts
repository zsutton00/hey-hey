import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('organization closure deadline migration', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.30.3__align_closure_deadline_with_access_end.sql',
    ),
    'utf8',
  );

  it('pins the day-30 deadline to access end while retaining closure identity', () => {
    expect(sql).toContain('ADD COLUMN access_ends_at TIMESTAMPTZ');
    expect(sql).toContain(
      "SET access_ends_at = deletion_deadline - INTERVAL '30 days'",
    );
    expect(sql).toContain(
      "deletion_deadline = access_ends_at + INTERVAL '30 days'",
    );
    expect(sql).toContain('effective_closure_at >= access_ends_at');
    expect(sql).toContain(
      'OR NEW.access_ends_at IS DISTINCT FROM OLD.access_ends_at',
    );
  });

  it('keeps execution and projection deadlines bounded by irreversible closure', () => {
    expect(sql).toContain(
      'organization_closure_executions_deadline_check CHECK',
    );
    expect(sql).toContain(
      'organization_closure_projection_commands_deadline_check CHECK',
    );
    expect(
      sql.match(/deletion_deadline >= effective_closure_at/g),
    ).toHaveLength(2);
  });
});
