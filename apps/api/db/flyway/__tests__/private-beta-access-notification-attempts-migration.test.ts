import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.12.2.1__create_private_beta_access_notification_attempts.sql',
);
const schemaPath = resolve(__dirname, '../../../prisma/schema.prisma');

describe('V2026.08.12.2.1: private-beta notification attempt contract', () => {
  const migrationSql = readFileSync(migrationPath, 'utf8');
  const prismaSchema = readFileSync(schemaPath, 'utf8');

  it('keeps recipient roles and delivery states aligned between SQL and Prisma', () => {
    for (const role of ['REQUESTER', 'OPERATOR']) {
      expect(migrationSql).toContain(`'${role}'`);
      expect(prismaSchema).toContain(`  ${role}`);
    }
    for (const state of ['PENDING', 'PROCESSING', 'SENT', 'FAILED']) {
      expect(migrationSql).toContain(`'${state}'`);
      expect(prismaSchema).toContain(`  ${state}`);
    }

    expect(prismaSchema).toContain(
      'model PrivateBetaAccessNotificationAttempt',
    );
    expect(prismaSchema).toContain(
      '@@map("private_beta_access_notification_attempts")',
    );
  });

  it('links attempts to stored requests and prevents duplicate recipient jobs', () => {
    expect(migrationSql).toMatch(
      /FOREIGN KEY \(request_id\)\s+REFERENCES private_beta_access_requests \(id\)\s+ON DELETE CASCADE/s,
    );
    expect(migrationSql).toMatch(
      /UNIQUE \(request_id, recipient_role\)/s,
    );
    expect(migrationSql).toContain('attempt_count');
    expect(migrationSql).toContain('claimed_at');
    expect(migrationSql).toContain('claim_expires_at');
    expect(migrationSql).toContain('last_error');
    expect(migrationSql).toContain('next_retry_at');
  });
});
