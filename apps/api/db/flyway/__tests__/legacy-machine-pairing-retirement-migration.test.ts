import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('legacy machine pairing retirement migration', () => {
  const migrationPath = resolve(
    __dirname,
    '..',
    'V2026.08.18.3__retire_legacy_machine_pairing.sql',
  );

  it('is append-only, retains rows, and makes the cut idempotent', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('UPDATE "pairing_codes"');
    expect(sql).toContain('WHERE "consumed_at" IS NULL');
    expect(sql).toContain('SET "authorization_protocol_version" = 1');
    expect(sql).toContain(
      'SET "authorization_state" = \'CONTROLLER_ENROLLMENT_REQUIRED\'',
    );
    expect(sql).toContain('WHERE "revoked_at" IS NULL');
    expect(sql).toContain('AND "authorization_protocol_version" = 1');
    expect(sql).not.toMatch(/DELETE\s+FROM/i);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i);
  });
});
