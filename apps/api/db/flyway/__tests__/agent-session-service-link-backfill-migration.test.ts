import { readFileSync } from 'fs';
import { join } from 'path';

describe('V2026.06.30.3: backfill agent session selected-service links', () => {
  const migrationSql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.06.30.3__backfill_agent_session_service_links.sql',
    ),
    'utf8',
  );

  it('backfills service_agent_sessions from non-null launch services', () => {
    expect(migrationSql).toContain('INSERT INTO "service_agent_sessions"');
    expect(migrationSql).toContain('FROM "agent_sessions" agent_sessions');
    expect(migrationSql).toContain(
      'WHERE agent_sessions.service_id IS NOT NULL',
    );
    expect(migrationSql).toContain('agent_sessions.service_id');
    expect(migrationSql).toContain('agent_sessions.id');
  });

  it('is safe to rerun when links already exist', () => {
    expect(migrationSql).toContain(
      'ON CONFLICT ("service_id", "agent_session_id") DO NOTHING',
    );
  });
});
