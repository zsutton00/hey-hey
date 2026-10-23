import fs from 'node:fs';
import path from 'node:path';

const migrationSql = fs.readFileSync(
  path.resolve(
    process.cwd(),
    'db/flyway/V2026.09.05.1__reconcile_project_entity_registry.sql',
  ),
  'utf8',
);

describe('project entity registry reconciliation migration', () => {
  it('is an idempotent project-authoritative upsert that preserves deletion state', () => {
    expect(migrationSql).toContain("'PROJECT'::\"EntityType\"");
    expect(migrationSql).toContain('FROM "projects" AS p');
    expect(migrationSql).toContain('p."deleted_at"');
    expect(migrationSql).toContain(
      'ON CONFLICT ("organization_id", "entity_id", "entity_type")',
    );
    expect(migrationSql).toContain('"deleted_at" = EXCLUDED."deleted_at"');
    expect(migrationSql).not.toMatch(/DELETE\s+FROM/i);
  });
});

