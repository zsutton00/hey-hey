import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.13.1.1__add_private_beta_provisioning_metadata.sql',
);
const schemaPath = resolve(__dirname, '../../../prisma/schema.prisma');

describe('V2026.08.13.1.1: private-beta provisioning metadata contract', () => {
  const migrationSql = readFileSync(migrationPath, 'utf8');
  const prismaSchema = readFileSync(schemaPath, 'utf8');

  it.each([
    ['provisioning_attempted_at', 'provisioningAttemptedAt'],
    ['provisioning_failure_code', 'provisioningFailureCode'],
  ])('keeps %s aligned with Prisma field %s', (column, field) => {
    expect(migrationSql).toContain(column);
    expect(prismaSchema).toContain(`${field}`);
    expect(prismaSchema).toContain(`@map("${column}")`);
  });

  it('documents safe latest-attempt and bounded failure semantics', () => {
    expect(migrationSql).toContain('latest private-beta provisioning attempt');
    expect(migrationSql).toContain(
      'raw provider and database errors are never stored',
    );
  });
});
