import { BadRequestException, Logger } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import {
  AccountAccessStatus,
  AccountSubscriptionType,
  OrganizationAccountLifecycleState,
  PaymentProviderEventProcessingStatus,
} from '@prisma/client';

import { PaymentProviderWebhookController } from '../controllers/payment-provider-webhook.controller';
import { PrismaService } from '../prisma/prisma.service';
import { AccountEntitlementService } from '../services/account-entitlement.service';
import { OrganizationAccountLifecycleService } from '../services/organization-account-lifecycle.service';
import { OutboxStore } from '../services/outbox-store.service';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import {
  PaymentProviderAdapter,
  PaymentProviderAdapterRequest,
  hashPaymentProviderRequest,
} from '../services/payment-entitlement/payment-provider-adapter';
import { PaymentProviderAdapterRegistry } from '../services/payment-entitlement/payment-provider-adapter.registry';
import { PaymentProviderBindingService } from '../services/payment-entitlement/payment-provider-binding.service';
import { PaymentEntitlementReconciliationOwner } from '../services/payment-entitlement/payment-entitlement-reconciliation.owner';
import { PaymentEntitlementReconciliationService } from '../services/payment-entitlement/payment-entitlement-reconciliation.service';
import type { OrganizationId, UserId } from '../types';

jest.setTimeout(120_000);

const describeDatabase =
  process.env.RUN_PAYMENT_ENTITLEMENT_RECONCILIATION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL?.startsWith('postgres')
    ? describe
    : describe.skip;

const PROVIDER = 'deterministic';
const ENVIRONMENT = 'sandbox';
const SIGNING_SECRET = 'payment-entitlement-reconciliation-test-secret';
const ACTOR = 'payment-entitlement-reconciliation-integration';
const INITIAL_REASON = 'Deterministic payment entitlement fixture';

type Fixture = {
  organizationId: OrganizationId;
  userId: UserId;
  customerId: string;
  subscriptionId: string;
  bindingId: string;
};

type PaymentFixturePayload = {
  eventId: string;
  kind: string;
  customerId: string | null;
  subscriptionId: string | null;
  occurredAt: string | null;
  version: string | null;
  sequence: string | null;
  paidThroughAt: string | null;
  accountId?: string;
  rawMarker?: string;
};

class DeterministicPaymentAdapter implements PaymentProviderAdapter {
  readonly provider = PROVIDER;
  readonly environments = [ENVIRONMENT] as const;

  async verifySignature(request: PaymentProviderAdapterRequest): Promise<void> {
    const supplied = request.headers['x-deterministic-signature'];
    const signature = Array.isArray(supplied) ? supplied[0] : supplied;
    const expected = createHmac('sha256', SIGNING_SECRET)
      .update(request.rawBody)
      .digest('hex');
    if (
      !signature ||
      signature.length !== expected.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    ) {
      throw new Error('Invalid deterministic payment signature');
    }
  }

  async normalizeVerifiedEvent(request: PaymentProviderAdapterRequest) {
    const payload = JSON.parse(
      request.rawBody.toString('utf8'),
    ) as PaymentFixturePayload;
    if (!payload.eventId || !payload.kind) {
      throw new Error('Deterministic payment fixture identity is required');
    }

    const normalized = {
      provider: request.provider,
      environment: request.environment,
      providerEventId: payload.eventId,
      normalizedEventKind: payload.kind,
      externalCustomerId: payload.customerId,
      externalSubscriptionId: payload.subscriptionId,
      providerOccurredAt: payload.occurredAt
        ? new Date(payload.occurredAt)
        : null,
      providerEventVersion: payload.version,
      providerEventSequence:
        payload.sequence === null || payload.sequence === undefined
          ? null
          : BigInt(payload.sequence),
      paidThroughAt: payload.paidThroughAt
        ? new Date(payload.paidThroughAt)
        : null,
      payloadHash: hashPaymentProviderRequest(request.rawBody),
    };
    return normalized;
  }
}

describeDatabase(
  'payment entitlement reconciliation PostgreSQL conformance',
  () => {
    let moduleRef: TestingModule;
    let prisma: PrismaService;
    let controller: PaymentProviderWebhookController;
    let registry: PaymentProviderAdapterRegistry;
    let bindingService: PaymentProviderBindingService;
    let accountEntitlementService: AccountEntitlementService;
    let reconciliation: PaymentEntitlementReconciliationService;
    let lifecycle: OrganizationAccountLifecycleService;
    const fixtures: Array<{ organizationId: OrganizationId; userId: UserId }> =
      [];
    const eventIds = new Set<string>();
    const loggerSpies: jest.SpyInstance[] = [];

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();

      moduleRef = await Test.createTestingModule({
        controllers: [PaymentProviderWebhookController],
        providers: [
          { provide: PrismaService, useValue: prisma },
          AccountEntitlementService,
          PaymentProviderBindingService,
          PaymentProviderAdapterRegistry,
          PaymentEntitlementReconciliationService,
          {
            provide: PaymentEntitlementReconciliationOwner,
            useExisting: PaymentEntitlementReconciliationService,
          },
        ],
      }).compile();

      controller = moduleRef.get(PaymentProviderWebhookController);
      registry = moduleRef.get(PaymentProviderAdapterRegistry);
      bindingService = moduleRef.get(PaymentProviderBindingService);
      accountEntitlementService = moduleRef.get(AccountEntitlementService);
      reconciliation = moduleRef.get(PaymentEntitlementReconciliationService);
      lifecycle = new OrganizationAccountLifecycleService(
        prisma,
        accountEntitlementService,
        new DomainEventPublisher(new OutboxStore(prisma)),
      );
      registry.register(new DeterministicPaymentAdapter());
    });

    afterEach(async () => {
      while (loggerSpies.length) loggerSpies.pop()?.mockRestore();
      if (eventIds.size > 0) {
        await prisma.db.paymentProviderEventInbox.deleteMany({
          where: {
            provider: PROVIDER,
            providerEventId: { in: [...eventIds] },
          },
        });
        eventIds.clear();
      }
      for (const fixture of fixtures.splice(0).reverse()) {
        await prisma.db.organization.delete({
          where: { id: fixture.organizationId },
        });
        await prisma.db.user.delete({ where: { id: fixture.userId } });
      }
    });

    afterAll(async () => {
      await moduleRef.close();
      await prisma.$disconnect();
    });

    it('accepts signed bytes only after correlation and persists canonical evidence', async () => {
      const fixture = await createFixture();
      const payload = makePayload(fixture, {
        eventId: 'evt-valid-paid-period',
        sequence: '1',
        version: '1',
        paidThroughAt: '2026-09-16T00:00:00.000Z',
        rawMarker: 'raw-provider-payload-must-never-be-stored-or-logged',
      });
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = createHmac('sha256', SIGNING_SECRET)
        .update(rawBody)
        .digest('hex');
      const logs = captureReconciliationLogs();

      await deliverRaw(rawBody);

      const state = await readState(fixture, payload.eventId);
      expect(state.inbox).toMatchObject({
        organizationId: fixture.organizationId,
        bindingId: fixture.bindingId,
        provider: PROVIDER,
        environment: ENVIRONMENT,
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
        acceptedEntitlementRevision: 2,
        failureReason: null,
      });
      expect(state.inbox?.payloadHash).toBe(
        hashPaymentProviderRequest(rawBody),
      );
      expect(state.entitlement).toMatchObject({
        subscriptionType: AccountSubscriptionType.PAID,
        accessStatus: AccountAccessStatus.ACTIVE,
        paidThroughAt: new Date('2026-09-16T00:00:00.000Z'),
        revision: 2,
      });
      expect(state.entitlementTransitions).toHaveLength(2);
      expect(state.entitlementTransitions[1]).toMatchObject({
        fromRevision: 1,
        toRevision: 2,
        changedBy: 'payment-provider-webhook',
        reason: 'Verified payment provider entitlement reconciliation',
      });
      expect(
        await accountEntitlementService.resolveForOrganization(
          fixture.organizationId,
          new Date('2026-08-20T00:00:00.000Z'),
        ),
      ).toMatchObject({
        authorized: true,
        subscriptionType: AccountSubscriptionType.PAID,
        revision: 2,
      });
      expectSafeLogs(logs, [rawBody.toString('utf8'), signature]);
      expect(stringifySafe(state.inbox)).not.toContain(
        'x-deterministic-signature',
      );
      expect(stringifySafe(state.inbox)).not.toContain(
        rawBody.toString('utf8'),
      );
      expect(stringifySafe(state.inbox)).not.toContain(signature);
    });

    it('fails closed for forged signatures, unknown environments, and unknown bindings', async () => {
      const fixture = await createFixture();

      await expect(
        deliver(fixture, { eventId: 'evt-forged-signature' }, true),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        await prisma.db.paymentProviderEventInbox.count({
          where: { providerEventId: 'evt-forged-signature' },
        }),
      ).toBe(0);

      const unknownEnvironment = makePayload(fixture, {
        eventId: 'evt-unknown-environment',
      });
      await expect(
        deliverRaw(
          serializePayload(unknownEnvironment),
          ENVIRONMENT,
          'production',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      await deliverRaw(
        serializePayload({
          ...makePayload(fixture, { eventId: 'evt-unknown-binding' }),
          customerId: 'cus-unknown',
          subscriptionId: 'sub-unknown',
        }),
      );
      const state = await readState(fixture, 'evt-unknown-binding');
      expect(state.inbox).toMatchObject({
        organizationId: null,
        bindingId: null,
        processingStatus: PaymentProviderEventProcessingStatus.IGNORED,
        failureReason: 'UNKNOWN_OR_DISABLED_BINDING',
      });
      expect(state.entitlement?.revision).toBe(1);
      expect(state.entitlementTransitions).toHaveLength(1);
    });

    it('makes exact replay and concurrent duplicate delivery converge on one inbox outcome', async () => {
      const fixture = await createFixture();
      const rawBody = serializePayload(
        makePayload(fixture, {
          eventId: 'evt-concurrent-duplicate',
          sequence: '4',
          paidThroughAt: '2026-09-20T00:00:00.000Z',
        }),
      );

      await deliverRaw(rawBody);
      await deliverRaw(rawBody);
      await Promise.all(Array.from({ length: 8 }, () => deliverRaw(rawBody)));

      expect(
        await prisma.db.paymentProviderEventInbox.count({
          where: {
            organizationId: fixture.organizationId,
            providerEventId: 'evt-concurrent-duplicate',
          },
        }),
      ).toBe(1);
      expect(
        await prisma.db.accountEntitlementTransition.count({
          where: { organizationId: fixture.organizationId },
        }),
      ).toBe(2);
      const state = await readState(fixture, 'evt-concurrent-duplicate');
      expect(state.inbox?.processingStatus).toBe(
        PaymentProviderEventProcessingStatus.ACCEPTED,
      );
      expect(state.inbox?.acceptedEntitlementRevision).toBe(2);
      expect(state.entitlement?.paidThroughAt).toEqual(
        new Date('2026-09-20T00:00:00.000Z'),
      );
    });

    it('uses binding-owned correlation instead of payload account IDs and rejects cross-account pairs', async () => {
      const first = await createFixture();
      const second = await createFixture();

      await deliverRaw(
        serializePayload(
          makePayload(first, {
            eventId: 'evt-account-id-substitution',
            accountId: second.organizationId,
            paidThroughAt: '2026-09-21T00:00:00.000Z',
          }),
        ),
      );
      const accepted = await readState(first, 'evt-account-id-substitution');
      expect(accepted.inbox?.organizationId).toBe(first.organizationId);
      expect(accepted.entitlement?.revision).toBe(2);
      expect(
        (await readState(second, 'evt-account-id-substitution')).entitlement
          ?.revision,
      ).toBe(1);

      await deliverRaw(
        serializePayload({
          ...makePayload(first, {
            eventId: 'evt-cross-account-correlation',
            accountId: first.organizationId,
          }),
          subscriptionId: second.subscriptionId,
        }),
      );
      const rejected = await readState(first, 'evt-cross-account-correlation');
      expect(rejected.inbox).toMatchObject({
        organizationId: null,
        bindingId: null,
        processingStatus: PaymentProviderEventProcessingStatus.IGNORED,
        failureReason: 'AMBIGUOUS_BINDING',
      });
      expect(
        (await readState(first, 'evt-cross-account-correlation')).entitlement
          ?.revision,
      ).toBe(2);
      expect(
        (await readState(second, 'evt-cross-account-correlation')).entitlement
          ?.revision,
      ).toBe(1);
    });

    it('advances paid-through access while rejecting stale and out-of-order evidence', async () => {
      const sequenceFixture = await createFixture();
      await deliverRaw(
        serializePayload(
          makePayload(sequenceFixture, {
            eventId: 'evt-sequence-first',
            sequence: '10',
            paidThroughAt: '2026-09-01T00:00:00.000Z',
          }),
        ),
      );
      await deliverRaw(
        serializePayload(
          makePayload(sequenceFixture, {
            eventId: 'evt-sequence-advance',
            sequence: '11',
            paidThroughAt: '2026-10-01T00:00:00.000Z',
          }),
        ),
      );
      await deliverRaw(
        serializePayload(
          makePayload(sequenceFixture, {
            eventId: 'evt-sequence-stale',
            sequence: '9',
            paidThroughAt: '2026-08-20T00:00:00.000Z',
          }),
        ),
      );

      expect(
        (await readState(sequenceFixture, 'evt-sequence-stale')).inbox,
      ).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.IGNORED,
        failureReason: 'STALE_OR_OUT_OF_ORDER',
      });
      const advanced = await readState(sequenceFixture, 'evt-sequence-advance');
      expect(advanced.entitlement?.paidThroughAt).toEqual(
        new Date('2026-10-01T00:00:00.000Z'),
      );
      expect(advanced.entitlement?.revision).toBe(3);
      expect(advanced.entitlementTransitions).toHaveLength(3);

      const versionFixture = await createFixture();
      await deliverRaw(
        serializePayload(
          makePayload(versionFixture, {
            eventId: 'evt-version-first',
            sequence: null,
            version: '20',
            paidThroughAt: '2026-09-05T00:00:00.000Z',
          }),
        ),
      );
      await deliverRaw(
        serializePayload(
          makePayload(versionFixture, {
            eventId: 'evt-version-out-of-order',
            sequence: null,
            version: '19',
            paidThroughAt: '2026-10-05T00:00:00.000Z',
          }),
        ),
      );
      const versionState = await readState(
        versionFixture,
        'evt-version-out-of-order',
      );
      expect(versionState.inbox).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.IGNORED,
        failureReason: 'STALE_OR_OUT_OF_ORDER',
      });
      expect(versionState.entitlement?.paidThroughAt).toEqual(
        new Date('2026-09-05T00:00:00.000Z'),
      );
    });

    it('persists ordering through equal entitlement revisions and rejects a later stale no-op successor', async () => {
      const fixture = await createFixture();
      const noOpPaidThroughAt = '2026-09-01T00:00:00.000Z';

      await deliver(fixture, {
        eventId: 'evt-equal-revision-first',
        sequence: '10',
        paidThroughAt: noOpPaidThroughAt,
      });
      await deliver(fixture, {
        eventId: 'evt-equal-revision-no-op',
        sequence: '20',
        paidThroughAt: noOpPaidThroughAt,
      });
      await deliver(fixture, {
        eventId: 'evt-after-no-op-stale',
        sequence: '15',
        paidThroughAt: '2026-10-01T00:00:00.000Z',
      });

      const state = await readState(fixture, 'evt-after-no-op-stale');
      expect(
        (await readState(fixture, 'evt-equal-revision-first')).inbox,
      ).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
        acceptedEntitlementRevision: 2,
      });
      expect(
        (await readState(fixture, 'evt-equal-revision-no-op')).inbox,
      ).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
        acceptedEntitlementRevision: 2,
      });
      expect(state.inbox).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.IGNORED,
        failureReason: 'STALE_OR_OUT_OF_ORDER',
      });
      expect(state.entitlement).toMatchObject({
        paidThroughAt: new Date(noOpPaidThroughAt),
        revision: 2,
      });
      expect(
        await prisma.db.paymentProviderBinding.findUnique({
          where: { id: fixture.bindingId },
        }),
      ).toMatchObject({
        lastAcceptedProviderEventSequence: 20n,
      });
    });

    it('serializes competing deliveries when the older event commits first', async () => {
      const fixture = await createFixture();
      const logs = captureReconciliationLogs();
      const originalTransition =
        accountEntitlementService.transitionInTransaction.bind(
          accountEntitlementService,
        );
      let entered!: () => void;
      const enteredTransition = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transitionSpy = jest
        .spyOn(accountEntitlementService, 'transitionInTransaction')
        .mockImplementation(async (...args) => {
          entered();
          await hold;
          return originalTransition(...args);
        });

      const older = deliver(fixture, {
        eventId: 'evt-race-older-first',
        sequence: '10',
        paidThroughAt: '2026-09-01T00:00:00.000Z',
      });
      await enteredTransition;
      const newer = deliver(fixture, {
        eventId: 'evt-race-newer-second',
        sequence: '20',
        paidThroughAt: '2026-10-01T00:00:00.000Z',
      });
      await waitForLogCount(
        logs.debug,
        'payment_entitlement_reconciliation_started',
        2,
      );
      release();
      await Promise.all([older, newer]);
      transitionSpy.mockRestore();

      expect(
        (await readState(fixture, 'evt-race-older-first')).inbox,
      ).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
      });
      expect(
        (await readState(fixture, 'evt-race-newer-second')).inbox,
      ).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
      });
      const state = await readState(fixture, 'evt-race-newer-second');
      expect(state.entitlement).toMatchObject({
        paidThroughAt: new Date('2026-10-01T00:00:00.000Z'),
        revision: 3,
      });
      expect(
        await prisma.db.paymentProviderBinding.findUnique({
          where: { id: fixture.bindingId },
        }),
      ).toMatchObject({
        lastAcceptedProviderEventSequence: 20n,
      });
    });

    it('serializes competing deliveries when the newer event commits first', async () => {
      const fixture = await createFixture();
      const logs = captureReconciliationLogs();
      const originalTransition =
        accountEntitlementService.transitionInTransaction.bind(
          accountEntitlementService,
        );
      let entered!: () => void;
      const enteredTransition = new Promise<void>((resolve) => {
        entered = resolve;
      });
      let release!: () => void;
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const transitionSpy = jest
        .spyOn(accountEntitlementService, 'transitionInTransaction')
        .mockImplementation(async (...args) => {
          entered();
          await hold;
          return originalTransition(...args);
        });

      const newer = deliver(fixture, {
        eventId: 'evt-race-newer-first',
        sequence: '20',
        paidThroughAt: '2026-10-01T00:00:00.000Z',
      });
      await enteredTransition;
      const older = deliver(fixture, {
        eventId: 'evt-race-older-second',
        sequence: '10',
        paidThroughAt: '2026-09-01T00:00:00.000Z',
      });
      await waitForLogCount(
        logs.debug,
        'payment_entitlement_reconciliation_started',
        2,
      );
      release();
      await Promise.all([newer, older]);
      transitionSpy.mockRestore();

      expect(
        (await readState(fixture, 'evt-race-newer-first')).inbox,
      ).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
      });
      const state = await readState(fixture, 'evt-race-older-second');
      expect(state.inbox).toMatchObject({
        failureReason: 'STALE_OR_OUT_OF_ORDER',
      });
      expect(state.entitlement).toMatchObject({
        paidThroughAt: new Date('2026-10-01T00:00:00.000Z'),
        revision: 2,
      });
      expect(
        await prisma.db.paymentProviderBinding.findUnique({
          where: { id: fixture.bindingId },
        }),
      ).toMatchObject({
        lastAcceptedProviderEventSequence: 20n,
      });
    });

    it('commits reconciliation before cancellation and snapshots the accepted entitlement revision', async () => {
      const fixture = await createFixture();
      const payload = makePayload(fixture, {
        eventId: 'evt-reconciliation-before-cancellation',
        sequence: '1',
        paidThroughAt: '2026-09-30T00:00:00.000Z',
      });
      const logs = captureReconciliationLogs();
      const decisionReached = waitForLog(
        logs.debug,
        'payment_entitlement_reconciliation_transaction_decision',
      );
      const reconciliationPromise = deliverRaw(serializePayload(payload));
      await decisionReached;
      const cancellationPromise = lifecycle.cancel(
        fixture.organizationId,
        fixture.userId,
      );
      await Promise.all([reconciliationPromise, cancellationPromise]);

      const state = await readState(fixture, payload.eventId);
      expect(state.inbox?.processingStatus).toBe(
        PaymentProviderEventProcessingStatus.ACCEPTED,
      );
      expect(state.entitlement?.revision).toBe(2);
      expect(state.lifecycle).toMatchObject({
        lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
        closureEntitlementRevision: 2,
        accessEndsAt: new Date('2026-09-30T00:00:00.000Z'),
      });
      expect(state.lifecycleTransitions).toHaveLength(2);
    });

    it('commits cancellation before reconciliation without moving the immutable future closure snapshot', async () => {
      const fixture = await createFixture({
        paidThroughAt: new Date('2026-09-01T00:00:00.000Z'),
      });
      const payload = makePayload(fixture, {
        eventId: 'evt-cancellation-before-reconciliation',
        sequence: '2',
        paidThroughAt: '2026-10-01T00:00:00.000Z',
      });
      const rawBody = serializePayload(payload);
      const identity = JSON.stringify([PROVIDER, ENVIRONMENT, payload.eventId]);
      let release!: () => void;
      let ready!: () => void;
      const lockReady = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lockTransaction = prisma.db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT TRUE FROM (SELECT pg_advisory_xact_lock(hashtextextended($1, 0))) AS advisory_lock',
          identity,
        );
        ready();
        await hold;
      });

      await lockReady;
      const reconciliationPromise = deliverRaw(rawBody);
      await new Promise<void>((resolve) => setImmediate(resolve));
      await lifecycle.cancel(fixture.organizationId, fixture.userId);
      release();
      await Promise.all([lockTransaction, reconciliationPromise]);

      const state = await readState(fixture, payload.eventId);
      expect(state.inbox).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.ACCEPTED,
        acceptedEntitlementRevision: 3,
      });
      expect(state.entitlement).toMatchObject({
        subscriptionType: AccountSubscriptionType.PAID,
        paidThroughAt: new Date('2026-10-01T00:00:00.000Z'),
        revision: 3,
      });
      expect(state.lifecycle).toMatchObject({
        lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
        accessEndsAt: new Date('2026-09-01T00:00:00.000Z'),
        closureEntitlementRevision: 2,
        revision: 2,
      });
      expect(state.lifecycleTransitions).toHaveLength(2);
      expect(
        await accountEntitlementService.resolveForOrganization(
          fixture.organizationId,
          new Date('2026-08-20T00:00:00.000Z'),
        ),
      ).toMatchObject({
        authorized: true,
        accessHorizon: new Date('2026-09-01T00:00:00.000Z'),
      });
    });

    it('ignores delivery after effective closure and preserves the immutable closure evidence', async () => {
      const fixture = await createFixture({
        paidThroughAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      await lifecycle.cancel(fixture.organizationId, fixture.userId);
      const before = await readState(fixture);
      const payload = makePayload(fixture, {
        eventId: 'evt-after-effective-closure',
        sequence: '99',
        paidThroughAt: '2026-12-31T00:00:00.000Z',
      });

      await deliverRaw(serializePayload(payload));

      const after = await readState(fixture, payload.eventId);
      expect(after.inbox).toMatchObject({
        processingStatus: PaymentProviderEventProcessingStatus.IGNORED,
        failureReason: 'ACCOUNT_CLOSURE_REACHED',
        acceptedEntitlementRevision: null,
      });
      expect(after.entitlement).toEqual(before.entitlement);
      expect(after.lifecycle).toEqual(before.lifecycle);
      expect(after.marker).toEqual(before.marker);
      expect(after.lifecycleTransitions).toEqual(before.lifecycleTransitions);
      expect(after.entitlementTransitions).toEqual(
        before.entitlementTransitions,
      );
      expect(
        await accountEntitlementService.resolveForOrganization(
          fixture.organizationId,
          new Date('2026-08-20T00:00:00.000Z'),
        ),
      ).toMatchObject({
        authorized: false,
        status: AccountAccessStatus.REVOKED,
      });
    });

    function captureReconciliationLogs() {
      const logger = (reconciliation as unknown as { logger: Logger }).logger;
      const debug = jest.spyOn(logger, 'debug');
      const warn = jest.spyOn(logger, 'warn');
      loggerSpies.push(debug, warn);
      return { debug, warn };
    }

    async function waitForLog(
      spy: jest.SpyInstance,
      event: string,
    ): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (
          spy.mock.calls.some(
            ([entry]) =>
              entry &&
              typeof entry === 'object' &&
              (entry as { event?: unknown }).event === event,
          )
        ) {
          return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(`Timed out waiting for reconciliation log ${event}`);
    }

    async function waitForLogCount(
      spy: jest.SpyInstance,
      event: string,
      count: number,
    ): Promise<void> {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const matchingCalls = spy.mock.calls.filter(
          ([entry]) =>
            entry &&
            typeof entry === 'object' &&
            (entry as { event?: unknown }).event === event,
        );
        if (matchingCalls.length >= count) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      throw new Error(
        `Timed out waiting for ${count} reconciliation logs ${event}`,
      );
    }

    function expectSafeLogs(
      logs: { debug: jest.SpyInstance; warn: jest.SpyInstance },
      forbiddenValues: string[],
    ): void {
      const entries = [...logs.debug.mock.calls, ...logs.warn.mock.calls].map(
        ([entry]) => entry,
      );
      expect(entries.length).toBeGreaterThan(0);
      const allowedKeys = new Set([
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
      ]);
      for (const entry of entries) {
        expect(entry).toEqual(expect.any(Object));
        expect(
          Object.keys(entry as Record<string, unknown>).every((key) =>
            allowedKeys.has(key),
          ),
        ).toBe(true);
      }
      const serialized = stringifySafe(entries);
      for (const forbiddenValue of forbiddenValues) {
        expect(serialized).not.toContain(forbiddenValue);
      }
    }

    function stringifySafe(value: unknown): string {
      return JSON.stringify(value, (_key, nestedValue: unknown) =>
        typeof nestedValue === 'bigint' ? nestedValue.toString() : nestedValue,
      );
    }

    async function createFixture(
      options: { paidThroughAt?: Date } = {},
    ): Promise<Fixture> {
      const nonce = randomUUID();
      const user = await prisma.db.user.create({
        data: {
          email: `payment-reconciliation-${nonce}@example.test`,
          name: 'Payment reconciliation integration',
          passwordHash: 'not-a-real-password',
        },
      });
      const organization = await prisma.db.organization.create({
        data: {
          name: `Payment reconciliation ${nonce}`,
          slug: `payment-reconciliation-${nonce}`,
        },
      });
      fixtures.push({
        organizationId: organization.id as OrganizationId,
        userId: user.id as UserId,
      });
      await prisma.db.organizationMember.create({
        data: {
          userId: user.id,
          organizationId: organization.id,
          role: 'OWNER',
          isActive: true,
        },
      });
      const organizationId = organization.id as OrganizationId;
      await accountEntitlementService.createBetaAtAdmission(organizationId, {
        actor: ACTOR,
        reason: INITIAL_REASON,
      });
      await prisma.db.organizationAccountLifecycle.create({
        data: {
          organizationId,
          lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
          accessEndsAt: null,
          deletionEligibleAt: null,
          irreversibleClosureAt: null,
          deletedAt: null,
          closureEntitlementRevision: null,
          revision: 1,
          createdBy: ACTOR,
          createdReason: INITIAL_REASON,
          updatedBy: ACTOR,
          updateReason: INITIAL_REASON,
        },
      });
      await prisma.db.organizationAccountLifecycleTransition.create({
        data: {
          organizationId,
          fromRevision: null,
          toRevision: 1,
          previousLifecycleState: null,
          lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
          previousAccessEndsAt: null,
          accessEndsAt: null,
          previousDeletionEligibleAt: null,
          deletionEligibleAt: null,
          previousIrreversibleClosureAt: null,
          irreversibleClosureAt: null,
          previousDeletedAt: null,
          deletedAt: null,
          previousClosureEntitlementRevision: null,
          closureEntitlementRevision: null,
          changedBy: ACTOR,
          reason: INITIAL_REASON,
        },
      });
      if (options.paidThroughAt) {
        await accountEntitlementService.transition(
          organizationId,
          1,
          {
            subscriptionType: AccountSubscriptionType.PAID,
            accessStatus:
              options.paidThroughAt.getTime() > Date.now()
                ? AccountAccessStatus.ACTIVE
                : AccountAccessStatus.EXPIRED,
            accessThroughAt: null,
            paidThroughAt: options.paidThroughAt,
          },
          { actor: ACTOR, reason: INITIAL_REASON },
        );
      }
      const binding = await bindingService.createBinding({
        organizationId,
        provider: PROVIDER,
        environment: ENVIRONMENT,
        externalCustomerId: `cus-${nonce}`,
        externalSubscriptionId: `sub-${nonce}`,
        actor: ACTOR,
        reason: INITIAL_REASON,
      });
      const fixture = {
        organizationId,
        userId: user.id as UserId,
        customerId: binding.externalCustomerId!,
        subscriptionId: binding.externalSubscriptionId!,
        bindingId: binding.id,
      };
      return fixture;
    }

    function makePayload(
      fixture: Fixture,
      overrides: Partial<PaymentFixturePayload> = {},
    ): PaymentFixturePayload {
      return {
        eventId: 'evt-deterministic',
        kind: 'PAID_PERIOD_UPDATED',
        customerId: fixture.customerId,
        subscriptionId: fixture.subscriptionId,
        occurredAt: '2026-08-16T12:00:00.000Z',
        version: '1',
        sequence: '1',
        paidThroughAt: '2026-09-01T00:00:00.000Z',
        ...overrides,
      };
    }

    function serializePayload(payload: PaymentFixturePayload): Buffer {
      return Buffer.from(JSON.stringify(payload));
    }

    async function deliver(
      fixture: Fixture,
      overrides: Partial<PaymentFixturePayload>,
      forged = false,
    ) {
      return deliverRaw(
        serializePayload(makePayload(fixture, overrides)),
        PROVIDER,
        ENVIRONMENT,
        forged,
      );
    }

    async function deliverRaw(
      rawBody: Buffer,
      provider = PROVIDER,
      environment = ENVIRONMENT,
      forged = false,
    ) {
      const payload = JSON.parse(
        rawBody.toString('utf8'),
      ) as Partial<PaymentFixturePayload>;
      if (payload.eventId) eventIds.add(payload.eventId);
      const signature = forged
        ? 'forged-signature'
        : createHmac('sha256', SIGNING_SECRET).update(rawBody).digest('hex');
      const request = {
        rawBody,
        headers: { 'x-deterministic-signature': signature },
      } as unknown as RawBodyRequest<Request>;
      return controller.receive(request, provider, environment);
    }

    async function readState(fixture: Fixture, eventId?: string) {
      const [
        entitlement,
        lifecycleRow,
        marker,
        entitlementTransitions,
        lifecycleTransitions,
        inbox,
      ] = await Promise.all([
        prisma.db.accountEntitlement.findUnique({
          where: { organizationId: fixture.organizationId },
        }),
        prisma.db.organizationAccountLifecycle.findUnique({
          where: { organizationId: fixture.organizationId },
        }),
        prisma.db.organizationDeletionMarker.findUnique({
          where: { organizationId: fixture.organizationId },
        }),
        prisma.db.accountEntitlementTransition.findMany({
          where: { organizationId: fixture.organizationId },
          orderBy: { toRevision: 'asc' },
        }),
        prisma.db.organizationAccountLifecycleTransition.findMany({
          where: { organizationId: fixture.organizationId },
          orderBy: { toRevision: 'asc' },
        }),
        eventId
          ? prisma.db.paymentProviderEventInbox.findUnique({
              where: {
                provider_environment_providerEventId: {
                  provider: PROVIDER,
                  environment: ENVIRONMENT,
                  providerEventId: eventId,
                },
              },
            })
          : Promise.resolve(null),
      ]);
      return {
        entitlement,
        lifecycle: lifecycleRow,
        marker,
        entitlementTransitions,
        lifecycleTransitions,
        inbox,
      };
    }
  },
);
