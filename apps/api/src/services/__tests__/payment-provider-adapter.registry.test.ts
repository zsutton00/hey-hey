import {
  hashPaymentProviderRequest,
  PaymentProviderAdapter,
} from '../payment-entitlement/payment-provider-adapter';
import {
  PaymentProviderAdapterRegistry,
  UnsupportedPaymentProviderError,
} from '../payment-entitlement/payment-provider-adapter.registry';

describe('PaymentProviderAdapterRegistry', () => {
  const rawBody = Buffer.from('{"event":"signed"}');
  const adapter: PaymentProviderAdapter = {
    provider: 'stripe',
    environments: ['sandbox'],
    verifySignature: jest.fn(async () => undefined),
    normalizeVerifiedEvent: jest.fn(async (request) => ({
      provider: request.provider,
      environment: request.environment,
      providerEventId: 'evt_123',
      normalizedEventKind: 'PAID_PERIOD_UPDATED',
      externalCustomerId: 'cus_123',
      externalSubscriptionId: 'sub_123',
      providerOccurredAt: null,
      providerEventVersion: null,
      providerEventSequence: null,
      paidThroughAt: new Date('2026-09-01T00:00:00.000Z'),
      payloadHash: hashPaymentProviderRequest(request.rawBody),
    })),
  };

  it('starts fail-closed when no processor is registered', () => {
    const registry = new PaymentProviderAdapterRegistry();
    expect(() => registry.resolve('stripe', 'sandbox')).toThrow(
      UnsupportedPaymentProviderError,
    );
  });

  it('delegates exact request bytes and typed headers to an explicit adapter', async () => {
    const registry = new PaymentProviderAdapterRegistry();
    registry.register(adapter);
    const headers = { 'x-signature': 'signature' } as const;

    const result = await registry.verifyAndNormalize({
      provider: 'Stripe',
      environment: 'Sandbox',
      rawBody,
      headers,
    });

    expect(adapter.verifySignature).toHaveBeenCalledWith({
      provider: 'stripe',
      environment: 'sandbox',
      rawBody,
      headers,
    });
    expect(adapter.normalizeVerifiedEvent).toHaveBeenCalledWith({
      provider: 'stripe',
      environment: 'sandbox',
      rawBody,
      headers,
    });
    expect(result.payloadHash).toBe(hashPaymentProviderRequest(rawBody));
  });

  it('rejects duplicate registrations and adapter output that changes scope', async () => {
    const registry = new PaymentProviderAdapterRegistry();
    registry.register(adapter);
    expect(() => registry.register(adapter)).toThrow('already registered');

    const invalidRegistry = new PaymentProviderAdapterRegistry();
    invalidRegistry.register({
      ...adapter,
      normalizeVerifiedEvent: jest.fn(async () => ({
        ...(await adapter.normalizeVerifiedEvent({
          provider: 'stripe',
          environment: 'sandbox',
          rawBody,
          headers: {},
        })),
        environment: 'production',
      })),
    });
    await expect(
      invalidRegistry.verifyAndNormalize({
        provider: 'stripe',
        environment: 'sandbox',
        rawBody,
        headers: {},
      }),
    ).rejects.toThrow('invalid normalized data');
  });
});
