import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('V2026.08.18.2: GitHub webhook inbox', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.18.2__create_github_webhook_inbox.sql',
    ),
    'utf8',
  );
  const prisma = readFileSync(
    join(process.cwd(), 'prisma/schema.prisma'),
    'utf8',
  );

  it('makes integration and delivery identity the durable idempotency key', () => {
    expect(sql).toContain('CREATE TABLE github_webhook_inbox');
    expect(sql).toContain('UNIQUE (integration_id, delivery_id)');
    expect(prisma).toContain('model GitHubWebhookInbox {');
    expect(prisma).toContain(
      '@@unique([integrationId, deliveryId], map: "ux_github_webhook_inbox_integration_delivery")',
    );
  });

  it('persists project scope and the normalized handoff without raw payloads', () => {
    for (const column of [
      'organization_id TEXT NOT NULL',
      'project_id TEXT NOT NULL',
      'payload_hash VARCHAR(64) NOT NULL',
      'normalized_event JSONB NOT NULL',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(/raw_(body|payload)/i);
    expect(sql).toContain('ix_github_webhook_inbox_project_accepted');
    expect(sql).toContain('ix_github_webhook_inbox_event_accepted');
  });

  it('uses the existing text identifier contract for all foreign keys', () => {
    expect(sql).toContain('integration_id TEXT NOT NULL');
    expect(sql).toContain('REFERENCES integrations(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES organizations(id) ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES projects(id) ON DELETE CASCADE');
  });
});
