import {
  AccountAccessStatus,
  AccountSubscriptionType,
  PaymentProviderEventProcessingStatus,
  type PaymentProviderEventInbox,
} from '@prisma/client';
import { ConflictException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId } from '../../types';
import { AccountEntitlementService } from '../account-entitlement.service';
import type {
  NormalizedPaymentProviderEvent,
  PaymentProviderAdapterRequest,
} from '../payment-entitlement/payment-provider-adapter';
import { PaymentProviderBindingService } from '../payment-entitlement/payment-provider-binding.service';
import { PaymentEntitlementReconciliationService } from '../payment-entitlement/payment-entitlement-reconciliation.service';

const organizationId = '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId;
const bindingId = 'binding-1';
const now = new Date('2026-08-16T12:00:00.000Z');

const RECONCILIATION_LOG_KEYS = [
  'event',
  'provider',
  'environment',
  'providerEventId',
  'normalizedEventKind',
  'reason',
  'bindingId',
  'organizationId',
  'status',
  'duplicate',
  'entitlementRevision',
  'attempt',
  'errorType',
  'currentEntitlementRevision',
  'lifecycleState',
  'irreversibleClosureAt',
  'retainedClosureAt',
  'lastAcceptedEntitlementRevision',
  'closureEntitlementRevision',
  'ordering',
] as const;

const expectSafeReconciliationLogs = (
  calls: unknown[][],
  forbiddenValues: string[],
) => {
  const entries = calls.map(([entry]) => entry);
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry).toEqual(expect.any(Object));
    expect(
      Object.keys(entry as Record<string, unknown>).every((key) =>
        RECONCILIATION_LOG_KEYS.includes(
          key as (typeof RECONCILIATION_LOG_KEYS)[number],
        ),
      ),
    ).toBe(true);
  }

  const serialized = JSON.stringify(entries);
  for (const forbiddenValue of forbiddenValues) {
    expect(serialized).not.toContain(forbiddenValue);
  }
};

const event = (
  overrides: Partial<NormalizedPaymentProviderEvent> = {},
): NormalizedPaymentProviderEvent => ({
  provider: 'stripe',
  environment: 'sandbox',
  providerEventId: 'evt_123',
  normalizedEventKind: 'PAID_PERIOD_UPDATED',
  externalCustomerId: 'cus_123',
  externalSubscriptionId: 'sub_123',
  providerOccurredAt: now,
  providerEventVersion: null,
  providerEventSequence: 2n,
  paidThroughAt: new Date('2026-09-01T00:00:00.000Z'),
  payloadHash: 'a'.repeat(64),
  ...overrides,
});

const requestFor = (paymentEvent: NormalizedPaymentProviderEvent) =>
  ({
    provider: paymentEvent.provider,
    environment: paymentEvent.environment,
    rawBody: Buffer.from('{"signed":true}'),
    headers: { 'x-provider-signature': 'signature' },
  }) satisfies PaymentProviderAdapterRequest;

const entitlement = (overrides: Record<string, unknown> = {}) => ({
  organizationId,
  subscriptionType: AccountSubscriptionType.BETA,
  accessStatus: AccountAccessStatus.ACTIVE,
  accessThroughAt: null,
  paidThroughAt: null,
  revision: 1,
  ...overrides,
});

const inbox = (
  paymentEvent: NormalizedPaymentProviderEvent,
  overrides: Record<string, unknown> = {},
) =>
  ({
    id: `inbox-${paymentEvent.providerEventId}`,
    organizationId,
    bindingId,
    provider: paymentEvent.provider,
    environment: paymentEvent.environment,
    providerEventId: paymentEvent.providerEventId,
    normalizedEventKind: paymentEvent.normalizedEventKind,
    payloadHash: paymentEvent.payloadHash,
    providerOccurredAt: paymentEvent.providerOccurredAt,
    providerEventVersion: paymentEvent.providerEventVersion,
    providerEventSequence: paymentEvent.providerEventSequence,
    processingStatus: PaymentProviderEventProcessingStatus.RECEIVED,
    failureReason: null,
    acceptedEntitlementRevision: null,
    processedAt: null,
    ...overrides,
  }) as unknown as PaymentProviderEventInbox;

describe('PaymentEntitlementReconciliationService', () => {
  let tx: {
    $queryRaw: jest.Mock;
    accountEntitlement: { findUnique: jest.Mock };
    organizationAccountLifecycle: { findUnique: jest.Mock };
    organizationDeletionMarker: { findUnique: jest.Mock };
    paymentProviderBinding: { findUnique: jest.Mock; update: jest.Mock };
    paymentProviderEventInbox: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let prisma: { $transaction: jest.Mock };
  let bindingService: {
    resolveBinding: jest.Mock;
    resolveClosureCorrelation: jest.Mock;
  };
  let accountEntitlementService: {
    transitionInTransaction: jest.Mock;
  };
  let service: PaymentEntitlementReconciliationService;
  let currentEntitlement: ReturnType<typeof entitlement>;
  let currentLifecycle: Record<string, unknown> | null;
  let currentClosureMarker: Record<string, unknown> | null;
  let currentInbox: PaymentProviderEventInbox | null;
  let currentBinding: Record<string, unknown>;
  let transitionInTransaction: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    currentEntitlement = entitlement();
    currentLifecycle = null;
    currentClosureMarker = null;
    currentInbox = null;
    currentBinding = {
      id: bindingId,
      organizationId,
      provider: 'stripe',
      environment: 'sandbox',
      externalCustomerId: 'cus_123',
      externalSubscriptionId: 'sub_123',
      lastAcceptedProviderEventSequence: null,
      lastAcceptedProviderEventVersion: null,
      lastAcceptedProviderOccurredAt: null,
      status: 'ACTIVE',
      revision: 1,
    };

    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      accountEntitlement: {
        findUnique: jest.fn(async () => currentEntitlement),
      },
      organizationAccountLifecycle: {
        findUnique: jest.fn(async () => currentLifecycle),
      },
      organizationDeletionMarker: {
        findUnique: jest.fn(async () => currentClosureMarker),
      },
      paymentProviderBinding: {
        findUnique: jest.fn(async () => currentBinding),
        update: jest.fn(async ({ data }) => {
          currentBinding = { ...currentBinding, ...data };
          return currentBinding;
        }),
      },
      paymentProviderEventInbox: {
        findUnique: jest.fn(async () => currentInbox),
        create: jest.fn(async ({ data }) => {
          currentInbox = {
            ...inbox(event({ providerEventId: data.providerEventId })),
            ...data,
            id: `inbox-${data.providerEventId}`,
          } as PaymentProviderEventInbox;
          return currentInbox;
        }),
        update: jest.fn(async ({ data }) => {
          currentInbox = {
            ...(currentInbox as PaymentProviderEventInbox),
            ...data,
          };
          return currentInbox;
        }),
      },
    };
    prisma = {
      $transaction: jest.fn(async (callback) => callback(tx)),
    };
    bindingService = {
      resolveBinding: jest.fn(async () => currentBinding),
      resolveClosureCorrelation: jest.fn(async () => null),
    };
    transitionInTransaction = jest.fn(
      async (_tx, _organizationId, revision, next) => {
        currentEntitlement = {
          ...currentEntitlement,
          ...next,
          revision: revision + 1,
        };
        return currentEntitlement;
      },
    );
    accountEntitlementService = { transitionInTransaction };
    service = new PaymentEntitlementReconciliationService(
      prisma as unknown as PrismaService,
      bindingService as unknown as PaymentProviderBindingService,
      accountEntitlementService as unknown as AccountEntitlementService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('accepts a current paid period through the canonical entitlement owner', async () => {
    const paymentEvent = event();
    const result = await service.reconcile({
      request: requestFor(paymentEvent),
      event: paymentEvent,
    });

    expect(result).toMatchObject({
      status: PaymentProviderEventProcessingStatus.ACCEPTED,
      entitlementRevision: 2,
      duplicate: false,
    });
    expect(transitionInTransaction).toHaveBeenCalledWith(
      tx,
      organizationId,
      1,
      expect.objectContaining({
        subscriptionType: AccountSubscriptionType.PAID,
        accessStatus: AccountAccessStatus.ACTIVE,
        paidThroughAt: paymentEvent.paidThroughAt,
      }),
      expect.objectContaining({ actor: 'payment-provider-webhook' }),
    );
    expect(currentInbox?.processingStatus).toBe(
      PaymentProviderEventProcessingStatus.ACCEPTED,
    );
    expect(currentBinding.lastAcceptedProviderEventSequence).toBe(2n);
  });

  it('advances the binding cursor for an accepted no-op at the same entitlement revision', async () => {
    const paidThroughAt = new Date('2026-09-01T00:00:00.000Z');
    currentEntitlement = entitlement({
      subscriptionType: AccountSubscriptionType.PAID,
      paidThroughAt,
      revision: 4,
    });
    currentBinding.lastAcceptedProviderEventSequence = 7n;
    const paymentEvent = event({
      providerEventId: 'evt_no_op',
      providerEventSequence: 8n,
      paidThroughAt,
    });

    const result = await service.reconcile({
      request: requestFor(paymentEvent),
      event: paymentEvent,
    });

    expect(result).toMatchObject({
      status: PaymentProviderEventProcessingStatus.ACCEPTED,
      entitlementRevision: 4,
      duplicate: false,
    });
    expect(transitionInTransaction).not.toHaveBeenCalled();
    expect(currentBinding.lastAcceptedProviderEventSequence).toBe(8n);
  });

  it('does not regress other ordering evidence when sequence advances', async () => {
    currentBinding = {
      ...currentBinding,
      lastAcceptedProviderEventSequence: 7n,
      lastAcceptedProviderEventVersion: '20',
      lastAcceptedProviderOccurredAt: new Date('2026-08-16T12:00:01.000Z'),
    };
    const sequenceSuccessor = event({
      providerEventId: 'evt_sequence_successor',
      providerEventSequence: 8n,
      providerEventVersion: '19',
      providerOccurredAt: new Date('2026-08-16T12:00:00.000Z'),
      paidThroughAt: new Date('2026-09-01T00:00:00.000Z'),
    });

    await expect(
      service.reconcile({
        request: requestFor(sequenceSuccessor),
        event: sequenceSuccessor,
      }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.ACCEPTED,
    });

    expect(currentBinding).toMatchObject({
      lastAcceptedProviderEventSequence: 8n,
      lastAcceptedProviderEventVersion: '20',
      lastAcceptedProviderOccurredAt: new Date('2026-08-16T12:00:01.000Z'),
    });

    currentInbox = null;
    const versionRegression = event({
      providerEventId: 'evt_version_regression',
      providerEventSequence: null,
      providerEventVersion: '19.5',
      providerOccurredAt: null,
      paidThroughAt: new Date('2026-10-01T00:00:00.000Z'),
    });
    await expect(
      service.reconcile({
        request: requestFor(versionRegression),
        event: versionRegression,
      }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.IGNORED,
    });
    expect(transitionInTransaction).toHaveBeenCalledTimes(1);
  });

  it('logs only safe operational fields and excludes request and provider secrets', async () => {
    const logger = (
      service as unknown as {
        logger: {
          debug: (...args: unknown[]) => void;
          warn: (...args: unknown[]) => void;
        };
      }
    ).logger;
    const debugSpy = jest.spyOn(logger, 'debug');
    const warnSpy = jest.spyOn(logger, 'warn');
    const paymentEvent = event({ providerEventId: 'evt_log_safe' });
    const request = {
      ...requestFor(paymentEvent),
      rawBody: Buffer.from(
        '{"providerSecret":"raw-provider-payload","credential":"secret"}',
      ),
      headers: {
        authorization: 'Bearer provider-credential',
        'x-provider-signature': 'provider-signature',
      },
    } satisfies PaymentProviderAdapterRequest;

    await expect(
      service.reconcile({ request, event: paymentEvent }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.ACCEPTED,
    });

    const logCalls = [...debugSpy.mock.calls, ...warnSpy.mock.calls];
    expectSafeReconciliationLogs(logCalls, [
      request.rawBody.toString(),
      'provider-signature',
      'Bearer provider-credential',
      'cus_123',
      'sub_123',
      'raw-provider-payload',
      'secret',
    ]);
    const serialized = JSON.stringify(logCalls);
    expect(serialized).toContain('evt_log_safe');
    expect(serialized).toContain(bindingId);
    expect(serialized).toContain(organizationId);
  });

  it('returns the persisted duplicate outcome without a second transition', async () => {
    const paymentEvent = event();
    currentInbox = inbox(paymentEvent, {
      processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
      acceptedEntitlementRevision: 4,
    });

    const result = await service.reconcile({
      request: requestFor(paymentEvent),
      event: paymentEvent,
    });

    expect(result).toMatchObject({
      status: PaymentProviderEventProcessingStatus.ACCEPTED,
      entitlementRevision: 4,
      duplicate: true,
    });
    expect(transitionInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['stale sequence', event({ providerEventSequence: 1n })],
    [
      'stale version',
      event({ providerEventSequence: null, providerEventVersion: '1' }),
    ],
    [
      'stale occurred time',
      event({
        providerEventSequence: null,
        providerOccurredAt: new Date('2026-08-15T12:00:00.000Z'),
      }),
    ],
  ])(
    'ignores %s without regressing entitlement',
    async (_name, paymentEvent) => {
      currentBinding = {
        ...currentBinding,
        lastAcceptedProviderEventSequence: 2n,
        lastAcceptedProviderEventVersion: '2',
        lastAcceptedProviderOccurredAt: now,
      };
      const result = await service.reconcile({
        request: requestFor(paymentEvent),
        event: paymentEvent,
      });

      expect(result.status).toBe(PaymentProviderEventProcessingStatus.IGNORED);
      expect(transitionInTransaction).not.toHaveBeenCalled();
    },
  );

  it('records a reached closure as ignored and leaves the immutable closure unchanged', async () => {
    const closure = new Date('2026-08-16T11:59:00.000Z');
    currentLifecycle = {
      lifecycleState: 'IRREVERSIBLY_CLOSED',
      irreversibleClosureAt: closure,
      closureEntitlementRevision: 1,
    };

    const result = await service.reconcile({
      request: requestFor(event()),
      event: event(),
    });

    expect(result.status).toBe(PaymentProviderEventProcessingStatus.IGNORED);
    expect(currentLifecycle.irreversibleClosureAt).toBe(closure);
    expect(transitionInTransaction).not.toHaveBeenCalled();
    expect(currentInbox?.failureReason).toBe('ACCOUNT_CLOSURE_REACHED');
  });

  it('advances entitlement evidence without moving a future cancellation snapshot', async () => {
    const closure = new Date('2026-08-20T12:00:00.000Z');
    currentLifecycle = {
      lifecycleState: 'ACTIVE',
      accessEndsAt: closure,
      irreversibleClosureAt: null,
      closureEntitlementRevision: 1,
    };
    const paymentEvent = event({ providerEventSequence: 3n });

    const result = await service.reconcile({
      request: requestFor(paymentEvent),
      event: paymentEvent,
    });

    expect(result.status).toBe(PaymentProviderEventProcessingStatus.ACCEPTED);
    expect(currentLifecycle.accessEndsAt).toBe(closure);
    expect(transitionInTransaction).toHaveBeenCalled();
  });

  it('honors retained closure evidence even when the live snapshot is unavailable', async () => {
    currentClosureMarker = {
      organizationId,
      effectiveClosureAt: new Date('2026-08-15T12:00:00.000Z'),
      deletionDeadline: new Date('2026-09-15T12:00:00.000Z'),
    };
    const paymentEvent = event({ providerEventId: 'evt_retained_closure' });

    const result = await service.reconcile({
      request: requestFor(paymentEvent),
      event: paymentEvent,
    });

    expect(result.status).toBe(PaymentProviderEventProcessingStatus.IGNORED);
    expect(currentInbox?.failureReason).toBe('ACCOUNT_CLOSURE_REACHED');
    expect(transitionInTransaction).not.toHaveBeenCalled();
  });

  it('classifies an exact post-deletion provider correlation as a closure barrier', async () => {
    bindingService.resolveBinding.mockResolvedValueOnce(null);
    bindingService.resolveClosureCorrelation.mockResolvedValueOnce({
      id: 'tombstone-1',
      organizationId,
      markerId: 'marker-1',
    });
    const paymentEvent = event({ providerEventId: 'evt_post_deletion' });

    await expect(
      service.reconcile({
        request: requestFor(paymentEvent),
        event: paymentEvent,
      }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.IGNORED,
      entitlementRevision: null,
    });
    expect(currentInbox).toMatchObject({
      organizationId: null,
      bindingId: null,
      failureReason: 'ACCOUNT_CLOSURE_REACHED',
    });
  });

  it('fails closed for unknown, ambiguous, and changed bindings', async () => {
    bindingService.resolveBinding.mockResolvedValueOnce(null);
    const unknown = event({ providerEventId: 'evt_unknown' });
    await expect(
      service.reconcile({ request: requestFor(unknown), event: unknown }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.IGNORED,
    });
    expect(transitionInTransaction).not.toHaveBeenCalled();

    bindingService.resolveBinding.mockRejectedValueOnce(
      new ConflictException(
        'Payment provider identifiers resolve to multiple bindings',
      ),
    );
    const ambiguous = event({ providerEventId: 'evt_ambiguous' });
    await expect(
      service.reconcile({ request: requestFor(ambiguous), event: ambiguous }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.IGNORED,
    });

    bindingService.resolveBinding.mockResolvedValueOnce({
      id: bindingId,
      organizationId,
      provider: 'stripe',
      environment: 'sandbox',
      externalCustomerId: 'cus_123',
      externalSubscriptionId: 'sub_123',
      status: 'ACTIVE',
      revision: 1,
    });
    tx.paymentProviderBinding.findUnique.mockResolvedValueOnce({
      id: bindingId,
      organizationId,
      provider: 'stripe',
      environment: 'production',
      externalCustomerId: 'cus_123',
      externalSubscriptionId: 'sub_123',
      status: 'ACTIVE',
      revision: 1,
    });
    const changed = event({ providerEventId: 'evt_changed' });
    await expect(
      service.reconcile({ request: requestFor(changed), event: changed }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.IGNORED,
    });
    expect(transitionInTransaction).not.toHaveBeenCalled();
  });

  it('retries serialization and unique-identity conflicts', async () => {
    const logger = (
      service as unknown as {
        logger: { debug: (...args: unknown[]) => void };
      }
    ).logger;
    const debugSpy = jest.spyOn(logger, 'debug');
    prisma.$transaction
      .mockRejectedValueOnce({ code: 'P2034' })
      .mockImplementationOnce(
        async (callback: (transaction: typeof tx) => unknown) => callback(tx),
      );

    const paymentEvent = event({ providerEventId: 'evt_retry' });
    await expect(
      service.reconcile({
        request: requestFor(paymentEvent),
        event: paymentEvent,
      }),
    ).resolves.toMatchObject({
      status: PaymentProviderEventProcessingStatus.ACCEPTED,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(debugSpy.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            event: 'payment_entitlement_reconciliation_retry',
            attempt: 1,
            errorType: 'object',
          }),
        ],
      ]),
    );
    expect(JSON.stringify(debugSpy.mock.calls)).not.toContain('serialization');
  });
});
