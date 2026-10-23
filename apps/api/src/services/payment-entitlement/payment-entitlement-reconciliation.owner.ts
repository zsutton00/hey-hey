import type {
  NormalizedPaymentProviderEvent,
  PaymentProviderAdapterRequest,
} from './payment-provider-adapter';

export interface PaymentEntitlementReconciliationInput {
  request: PaymentProviderAdapterRequest;
  event: NormalizedPaymentProviderEvent;
}

export type PaymentEntitlementReconciliationStatus =
  | 'RECEIVED'
  | 'ACCEPTED'
  | 'IGNORED'
  | 'FAILED';

export interface PaymentEntitlementReconciliationResult {
  status: PaymentEntitlementReconciliationStatus;
  providerEventId: string;
  entitlementRevision: number | null;
  duplicate: boolean;
}

/**
 * Provider-neutral owner for the durable payment-event reconciliation
 * boundary. HTTP adapters may verify and normalize an event, but they must
 * not decide which account receives access or mutate entitlement state.
 */
export abstract class PaymentEntitlementReconciliationOwner {
  abstract reconcile(
    input: PaymentEntitlementReconciliationInput,
  ): Promise<PaymentEntitlementReconciliationResult>;
}
