import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.12.1.1__create_private_beta_access_requests.sql',
);
const schemaPath = resolve(__dirname, '../../../prisma/schema.prisma');

describe('V2026.08.12.1.1: private-beta access request storage contract', () => {
  const migrationSql = readFileSync(migrationPath, 'utf8');
  const prismaSchema = readFileSync(schemaPath, 'utf8');

  it('declares the complete generated lifecycle vocabulary in SQL and Prisma', () => {
    for (const status of [
      'PENDING',
      'APPROVAL_IN_PROGRESS',
      'APPROVED',
      'REJECTED',
      'PROVISIONING_FAILED',
    ]) {
      expect(migrationSql).toContain(`'${status}'`);
      expect(prismaSchema).toContain(`  ${status}`);
    }

    expect(migrationSql).toContain(
      "status private_beta_access_request_status NOT NULL DEFAULT 'PENDING'",
    );
    expect(prismaSchema).toContain(
      'status                    PrivateBetaAccessRequestStatus @default(PENDING)',
    );
    expect(prismaSchema).toContain(
      '@@map("private_beta_access_request_status")',
    );
  });

  it('enforces one pending request per normalized email while retaining history', () => {
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS private_beta_access_requests_one_pending_email_idx\s+ON private_beta_access_requests \(normalized_email\)\s+WHERE status = 'PENDING';/s,
    );
    expect(prismaSchema).not.toContain('@@unique([normalizedEmail])');
    expect(prismaSchema).not.toContain('@@unique([normalizedEmail, status])');
  });

  it('keeps request persistence independent from provisioning entities', () => {
    const requestModel = prismaSchema.slice(
      prismaSchema.indexOf('model PrivateBetaAccessRequest {'),
      prismaSchema.indexOf(
        '\n}\n',
        prismaSchema.indexOf('model PrivateBetaAccessRequest {'),
      ) + 3,
    );

    expect(migrationSql).not.toMatch(/\bREFERENCES\b/i);
    expect(migrationSql).not.toMatch(/\bFOREIGN KEY\b/i);
    expect(requestModel).not.toMatch(/@relation/);
    expect(requestModel).not.toMatch(
      /\b(user|organization|invitation|session)Id\b/i,
    );

    for (const field of [
      'submitted_email',
      'normalized_email',
      'name',
      'organization_name',
      'team_size',
      'product_context',
      'access_rationale',
      'decision_at',
      'provisioned_user_id',
      'provisioned_organization_id',
      'provisioning_completed_at',
      'provisioning_error',
    ]) {
      expect(migrationSql).toContain(field);
    }
  });
});
