import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationSql = readFileSync(
  resolve(
    __dirname,
    '../V2026.08.22.3__persist_agent_operation_admitted_authorization_kind.sql',
  ),
  'utf8',
);

describe('Agent Operation admitted authorization-kind migration', () => {
  it('uses the closed OpenAPI authorization-kind vocabulary', () => {
    expect(migrationSql).toContain("'controller_assertion'");
    expect(migrationSql).toContain("'bounded_grant'");
    expect(migrationSql).toContain(
      'authorization_kind agent_operation_authorization_kind',
    );
  });

  it('backfills from dispatch before recognized legacy result metadata', () => {
    const dispatchBackfill = migrationSql.indexOf(
      'FROM agent_operation_dispatches AS dispatch',
    );
    const legacyResultBackfill = migrationSql.indexOf(
      "result ->> 'authorizationKind' IN",
    );

    expect(dispatchBackfill).toBeGreaterThan(-1);
    expect(legacyResultBackfill).toBeGreaterThan(dispatchBackfill);
  });

  it('leaves unprovable operations nullable without inventing a default', () => {
    expect(migrationSql).not.toMatch(
      /agent_operations[\s\S]*authorization_kind[\s\S]*SET DEFAULT/i,
    );
    expect(migrationSql).not.toMatch(
      /agent_operations[\s\S]*authorization_kind[\s\S]*SET NOT NULL/i,
    );
  });
});
