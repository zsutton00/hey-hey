import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEMO_SYSTEM_USER_ID } from '../services/demo-sandbox/demo-sandbox.constants';

const migrationSql = readFileSync(
  join(
    process.cwd(),
    'db/flyway/V2026.10.27.210000__demo_system_user_uuid.sql',
  ),
  'utf8',
);

const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('V2026.10.27.210000: Demo system user UUID', () => {
  it('uses an id that satisfies the UserId pattern the event schema requires', () => {
    expect(DEMO_SYSTEM_USER_ID).toMatch(USER_ID_PATTERN);
  });

  it('moves the principal to the id the service uses', () => {
    expect(migrationSql).toContain(`'${DEMO_SYSTEM_USER_ID}'`);
    expect(migrationSql).toContain(
      "DELETE FROM users WHERE id = 'demo-system'",
    );
  });

  it('repoints every single-column reference to users before deleting the old row', () => {
    expect(migrationSql).toContain("c.confrelid = 'users'::regclass");
    expect(migrationSql.indexOf('FOR reference IN')).toBeLessThan(
      migrationSql.indexOf('DELETE FROM users'),
    );
  });
});
