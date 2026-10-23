import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('V2026.08.17.6: payment provider ordering cursor', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.17.6__persist_payment_provider_event_ordering_cursor.sql',
    ),
    'utf8',
  );
  const prisma = readFileSync(
    join(process.cwd(), 'prisma/schema.prisma'),
    'utf8',
  );

  it('adds binding-scoped provider ordering evidence without changing the entitlement revision', () => {
    expect(sql).toContain('last_accepted_provider_event_sequence BIGINT');
    expect(sql).toContain('last_accepted_provider_event_version VARCHAR(255)');
    expect(sql).toContain('last_accepted_provider_occurred_at TIMESTAMPTZ');
    expect(sql).toContain('ALTER TABLE payment_provider_bindings');
    expect(prisma).toContain('lastAcceptedProviderEventSequence BigInt?');
    expect(prisma).toContain('lastAcceptedProviderEventVersion   String?');
    expect(prisma).toContain('lastAcceptedProviderOccurredAt     DateTime?');
    expect(prisma).not.toContain('lastAcceptedProviderEventSequence Int');
  });
});
