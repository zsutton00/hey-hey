import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('password recovery credential kind migration', () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      'db/flyway/V2026.08.26.2__add_password_recovery_credential_kind.sql',
    ),
    'utf8',
  );

  it('backfills required-change purpose and enforces bounded recovery expiry', () => {
    expect(sql).toContain("'REQUIRED_CHANGE'");
    expect(sql).toContain("'ACCOUNT_RECOVERY'");
    expect(sql).toContain("SET issuance_kind = 'REQUIRED_CHANGE'");
    expect(sql).toContain("issued_at + INTERVAL '15 minutes'");
  });
});
