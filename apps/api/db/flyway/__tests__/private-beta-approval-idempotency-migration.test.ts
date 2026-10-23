import { readFileSync } from 'fs';
import { resolve } from 'path';

const migrationPath = resolve(
  __dirname,
  '../V2026.08.12.3__add_private_beta_approval_idempotency.sql',
);
const schemaPath = resolve(__dirname, '../../../prisma/schema.prisma');

describe('V2026.08.12.3: private-beta approval idempotency contract', () => {
  const migrationSql = readFileSync(migrationPath, 'utf8');
  const prismaSchema = readFileSync(schemaPath, 'utf8');

  it('persists every provisioning and delivery checkpoint on the request', () => {
    for (const field of [
      'provisioning_user_completed_at',
      'provisioning_organization_completed_at',
      'provisioning_credential_id',
      'provisioning_credential_completed_at',
      'provisioning_organization_api_key_id',
      'provisioning_organization_api_key_completed_at',
      'welcome_email_idempotency_key',
      'welcome_email_sent_at',
    ]) {
      expect(migrationSql).toContain(field);
      expect(prismaSchema).toContain(`@map("${field}")`);
    }
  });

  it('makes request outcomes and credential issuance unique', () => {
    for (const index of [
      'private_beta_access_requests_provisioned_user_id_key',
      'private_beta_access_requests_provisioned_organization_id_key',
      'private_beta_access_requests_provisioning_credential_id_key',
      'private_beta_access_requests_provisioning_api_key_id_key',
      'private_beta_access_requests_welcome_email_idempotency_key_key',
      'password_change_credentials_private_beta_access_request_id_key',
    ]) {
      expect(migrationSql).toContain(index);
    }
    expect(prismaSchema).toContain(
      'privateBetaAccessRequestId String? @unique',
    );
  });
});
