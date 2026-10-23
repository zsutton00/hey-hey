import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('V2026.08.17.5: payment entitlement reconciliation storage contract', () => {
  const sql = readFileSync(
    join(
      process.cwd(),
      'db/flyway/V2026.08.17.5__create_payment_entitlement_reconciliation.sql',
    ),
    'utf8',
  );
  const prisma = readFileSync(
    join(process.cwd(), 'prisma/schema.prisma'),
    'utf8',
  );

  it('separates provider binding state from the canonical entitlement record', () => {
    expect(sql).toContain('CREATE TABLE payment_provider_bindings');
    expect(sql).toContain('CREATE TABLE payment_provider_event_inbox');
    expect(sql).toContain('REFERENCES organizations(id) ON DELETE CASCADE');
    expect(sql).toContain(
      'organization_id TEXT\n    REFERENCES organizations(id) ON DELETE SET NULL',
    );
    expect(sql).not.toMatch(
      /account_entitlements[\s\S]*(customer|subscription|price|secret|credential|raw_payload)/i,
    );
    expect(prisma).toContain('model PaymentProviderBinding {');
    expect(prisma).toContain('model PaymentProviderEventInbox {');
  });

  it('prevents ambiguous active customer and subscription correlation', () => {
    expect(sql).toContain('payment_provider_bindings_active_customer_idx');
    expect(sql).toContain(
      "WHERE status = 'ACTIVE' AND external_customer_id IS NOT NULL",
    );
    expect(sql).toContain('payment_provider_bindings_active_subscription_idx');
    expect(sql).toContain(
      "WHERE status = 'ACTIVE' AND external_subscription_id IS NOT NULL",
    );
    expect(sql).toContain(
      'external_customer_id IS NOT NULL OR external_subscription_id IS NOT NULL',
    );
  });

  it('deduplicates provider events while retaining sanitized evidence only', () => {
    expect(sql).toContain(
      'ON payment_provider_event_inbox (provider, environment, provider_event_id)',
    );
    for (const column of [
      'normalized_event_kind',
      'payload_hash',
      'provider_occurred_at',
      'provider_event_version',
      'provider_event_sequence',
      'processing_status',
      'failure_reason',
      'accepted_entitlement_revision',
    ]) {
      expect(sql).toContain(column);
    }
    expect(sql).not.toMatch(
      /raw_payload|payment_credentials|webhook_secret|card_data|provider_authorization_status/i,
    );
  });

  it('aligns status enums and provider-free canonical models across SQL and Prisma', () => {
    for (const value of ['ACTIVE', 'DISABLED']) {
      expect(sql).toContain(`'${value}'`);
      expect(prisma).toMatch(new RegExp(`\\b${value}\\b`));
    }
    for (const value of ['RECEIVED', 'ACCEPTED', 'IGNORED', 'FAILED']) {
      expect(sql).toContain(`'${value}'`);
      expect(prisma).toMatch(new RegExp(`\\b${value}\\b`));
    }
    expect(prisma).toContain('paymentProviderBindings');
    expect(prisma).toContain('paymentProviderEvents');
  });
});
