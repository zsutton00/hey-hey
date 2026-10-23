import { AccountAccessStatus, AccountSubscriptionType } from '@prisma/client';
import { mapPaymentPeriodToEntitlementTransition } from '../payment-entitlement/payment-entitlement-policy';

describe('payment entitlement policy', () => {
  const now = new Date('2026-08-14T12:00:00.000Z');

  it('maps a future paid period to PAID active access and keeps beta horizon empty', () => {
    expect(
      mapPaymentPeriodToEntitlementTransition(
        { paidThroughAt: new Date('2026-09-01T00:00:00.000Z') },
        now,
      ),
    ).toEqual({
      subscriptionType: AccountSubscriptionType.PAID,
      accessStatus: AccountAccessStatus.ACTIVE,
      accessThroughAt: null,
      paidThroughAt: new Date('2026-09-01T00:00:00.000Z'),
    });
  });

  it('maps absent or elapsed paid-period facts to expired paid access', () => {
    expect(
      mapPaymentPeriodToEntitlementTransition({ paidThroughAt: null }, now),
    ).toMatchObject({
      subscriptionType: AccountSubscriptionType.PAID,
      accessStatus: AccountAccessStatus.EXPIRED,
      accessThroughAt: null,
      paidThroughAt: null,
    });
    expect(
      mapPaymentPeriodToEntitlementTransition(
        { paidThroughAt: new Date('2026-08-01T00:00:00.000Z') },
        now,
      ).accessStatus,
    ).toBe(AccountAccessStatus.EXPIRED);
  });

  it('rejects invalid period facts instead of inventing an access horizon', () => {
    expect(() =>
      mapPaymentPeriodToEntitlementTransition({
        paidThroughAt: new Date('invalid'),
      }),
    ).toThrow('valid date');
  });
});
