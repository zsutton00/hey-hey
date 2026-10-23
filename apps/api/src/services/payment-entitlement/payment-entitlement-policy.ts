import { AccountAccessStatus, AccountSubscriptionType } from '@prisma/client';
import { AccountEntitlementTransitionInput } from '../account-entitlement.service';

export interface PaymentEntitlementPeriodFacts {
  paidThroughAt: Date | null;
}

/**
 * Converts already-verified provider facts into the provider-neutral access
 * transition shape. Provider product, price, and dashboard status are
 * deliberately not accepted as inputs to this mapper.
 */
export function mapPaymentPeriodToEntitlementTransition(
  facts: PaymentEntitlementPeriodFacts,
  now = new Date(),
): AccountEntitlementTransitionInput {
  if (
    facts.paidThroughAt !== null &&
    (!(facts.paidThroughAt instanceof Date) ||
      !Number.isFinite(facts.paidThroughAt.getTime()))
  ) {
    throw new Error('Payment entitlement period must be a valid date');
  }

  const paidThroughAt = facts.paidThroughAt;
  return {
    subscriptionType: AccountSubscriptionType.PAID,
    accessStatus:
      paidThroughAt && paidThroughAt.getTime() > now.getTime()
        ? AccountAccessStatus.ACTIVE
        : AccountAccessStatus.EXPIRED,
    accessThroughAt: null,
    paidThroughAt,
  };
}
