import { createHash } from 'node:crypto';

export type PaymentProviderHeaders = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export interface PaymentProviderAdapterRequest {
  provider: string;
  environment: string;
  rawBody: Buffer;
  headers: PaymentProviderHeaders;
}

/**
 * The provider supplied bytes or normalized facts are invalid or cannot be
 * trusted as a payment event. This is the only provider-boundary failure that
 * is safe to expose as a generic client error.
 */
export class PaymentProviderInputError extends Error {
  readonly kind = 'provider_input' as const;

  constructor(message = 'Invalid payment provider input') {
    super(message);
    this.name = 'PaymentProviderInputError';
  }
}

/**
 * Reconciliation could not establish or persist the provider-neutral result.
 * Callers must treat this as retryable without exposing implementation detail.
 */
export class PaymentProviderReconciliationError extends Error {
  readonly kind = 'reconciliation' as const;

  constructor() {
    super('Payment provider reconciliation failed');
    this.name = 'PaymentProviderReconciliationError';
  }
}

export type VerifiedPaymentProviderRequest = PaymentProviderAdapterRequest;

export interface NormalizedPaymentProviderEvent {
  provider: string;
  environment: string;
  providerEventId: string;
  normalizedEventKind: string;
  externalCustomerId: string | null;
  externalSubscriptionId: string | null;
  providerOccurredAt: Date | null;
  providerEventVersion: string | null;
  providerEventSequence: bigint | null;
  paidThroughAt: Date | null;
  payloadHash: string;
}

export interface PaymentProviderAdapter {
  readonly provider: string;
  readonly environments: readonly string[];
  verifySignature(request: PaymentProviderAdapterRequest): Promise<void>;
  normalizeVerifiedEvent(
    request: VerifiedPaymentProviderRequest,
  ): Promise<NormalizedPaymentProviderEvent>;
}

export function hashPaymentProviderRequest(rawBody: Buffer): string {
  if (!Buffer.isBuffer(rawBody)) {
    throw new Error(
      'Payment provider adapters require the exact request bytes',
    );
  }
  return createHash('sha256').update(rawBody).digest('hex');
}
