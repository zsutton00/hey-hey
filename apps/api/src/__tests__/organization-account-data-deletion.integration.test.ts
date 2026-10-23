import { randomUUID } from 'node:crypto';
import {
  AccountAccessStatus,
  AccountSubscriptionType,
  OrganizationAccountLifecycleState,
  OrganizationClosureExecutionStage,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import { AccountEntitlementService } from '../services/account-entitlement.service';
import { OrganizationAccountDataDeletionService } from '../services/organization-account-data-deletion.service';
import { OrganizationAccountLifecycleService } from '../services/organization-account-lifecycle.service';
import { OrganizationClosureDueWorkService } from '../services/organization-closure-due-work.service';
import { PaymentProviderBindingService } from '../services/payment-entitlement/payment-provider-binding.service';
import type { OrganizationId } from '../types';

jest.setTimeout(120_000);

const describeDatabase =
  process.env.RUN_ORGANIZATION_ACCOUNT_DATA_DELETION_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL?.startsWith('postgres')
    ? describe
    : describe.skip;

describeDatabase('organization account deletion PostgreSQL recovery', () => {
  let prisma: PrismaService;
  const fixtureOrganizationIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterEach(async () => {
    for (const organizationId of fixtureOrganizationIds.splice(0).reverse()) {
      await prisma.db.analyticsEvent.deleteMany({
        where: { organizationId },
      });
      await prisma.db.analyticsEventBatch.deleteMany({
        where: { organizationId },
      });
      await prisma.db.organizationClosureExecution.deleteMany({
        where: { organizationId },
      });
      await prisma.db.organizationDeletionMarker.deleteMany({
        where: { organizationId },
      });
      await prisma.db.outboxEvent.deleteMany({ where: { organizationId } });
      await prisma.db.outboxAggSeq.deleteMany({
        where: { aggregateId: organizationId },
      });
      await prisma.db.organization.deleteMany({
        where: { id: organizationId },
      });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('completes a retained PENDING execution after restored live rows are purged', async () => {
    const organizationId = randomUUID() as OrganizationId;
    const markerId = randomUUID();
    const effectiveClosureAt = new Date(Date.now() - 60_000);
    const deletionDeadline = new Date(
      effectiveClosureAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    fixtureOrganizationIds.push(organizationId);

    await createRestoredPreClosureFixture({
      organizationId,
      markerId,
      accessEndsAt: effectiveClosureAt,
      effectiveClosureAt,
      deletionDeadline,
    });
    await applyAuthoritativeRecoveryPurge(organizationId);

    const accountEntitlements = new AccountEntitlementService(prisma);
    const dueWork = new OrganizationClosureDueWorkService(prisma, {
      materializeReachedClosure: jest.fn(),
    } as any);
    const connectionEviction = {
      evictOrganization: jest.fn().mockResolvedValue(0),
    };
    const deletion = new OrganizationAccountDataDeletionService(
      prisma,
      dueWork,
      connectionEviction as any,
      accountEntitlements,
      new PaymentProviderBindingService(prisma),
    );

    await expect(deletion.executeForOrganization(organizationId)).resolves.toBe(
      true,
    );

    const [
      execution,
      marker,
      liveOrganizationRows,
      liveLifecycleRows,
      liveEntitlementRows,
      liveAnalyticsEventRows,
      liveAnalyticsBatchRows,
    ] = await Promise.all([
      prisma.db.organizationClosureExecution.findUniqueOrThrow({
        where: { organizationId },
      }),
      prisma.db.organizationDeletionMarker.findUniqueOrThrow({
        where: { organizationId },
      }),
      prisma.db.organization.count({ where: { id: organizationId } }),
      prisma.db.organizationAccountLifecycle.count({
        where: { organizationId },
      }),
      prisma.db.accountEntitlement.count({ where: { organizationId } }),
      prisma.db.analyticsEvent.count({ where: { organizationId } }),
      prisma.db.analyticsEventBatch.count({ where: { organizationId } }),
    ]);
    expect(execution).toMatchObject({
      organizationId,
      markerId,
      effectiveClosureAt,
      deletionDeadline,
      stage: OrganizationClosureExecutionStage.COMPLETED,
      claimToken: null,
      claimedAt: null,
      leaseExpiresAt: null,
      lastFailure: null,
    });
    expect(execution.completedAt).toEqual(expect.any(Date));
    expect(marker).toMatchObject({
      organizationId,
      id: markerId,
      accessEndsAt: effectiveClosureAt,
      effectiveClosureAt,
      deletionDeadline,
    });
    expect([
      liveOrganizationRows,
      liveLifecycleRows,
      liveEntitlementRows,
      liveAnalyticsEventRows,
      liveAnalyticsBatchRows,
    ]).toEqual([0, 0, 0, 0, 0]);
    expect(connectionEviction.evictOrganization).toHaveBeenCalledWith(
      organizationId,
    );

    await expect(deletion.executeForOrganization(organizationId)).resolves.toBe(
      false,
    );
    expect(
      await prisma.db.organizationClosureExecution.findUniqueOrThrow({
        where: { organizationId },
      }),
    ).toMatchObject({
      stage: OrganizationClosureExecutionStage.COMPLETED,
      lastFailure: null,
    });
  });

  it('materializes retained closure evidence with a day-30 access-end deadline', async () => {
    const organizationId = randomUUID() as OrganizationId;
    const markerId = randomUUID();
    const now = new Date();
    const accessEndsAt = new Date(now.getTime() - 4 * 60_000);
    const deletionEligibleAt = new Date(now.getTime() - 3 * 60_000);
    const irreversibleClosureAt = new Date(now.getTime() - 2 * 60_000);
    const deletionDeadline = new Date(
      accessEndsAt.getTime() + 30 * 24 * 60 * 60 * 1000,
    );
    const fixtureReason = 'Closure deadline PostgreSQL regression fixture';
    fixtureOrganizationIds.push(organizationId);

    await prisma.$transaction(async (tx) => {
      await tx.organization.create({
        data: {
          id: organizationId,
          name: `Closure deadline ${organizationId}`,
          slug: `closure-deadline-${organizationId}`,
        },
      });
      await tx.accountEntitlement.create({
        data: {
          organizationId,
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
          accessThroughAt: accessEndsAt,
          paidThroughAt: null,
          revision: 1,
          createdBy: fixtureReason,
          createdReason: fixtureReason,
          updatedBy: fixtureReason,
          updateReason: fixtureReason,
        },
      });
      await tx.organizationAccountLifecycle.create({
        data: {
          organizationId,
          lifecycleState: OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED,
          accessEndsAt,
          deletionEligibleAt,
          irreversibleClosureAt,
          deletedAt: null,
          closureEntitlementRevision: 1,
          revision: 1,
          createdBy: fixtureReason,
          createdReason: fixtureReason,
          updatedBy: fixtureReason,
          updateReason: fixtureReason,
        },
      });
    });

    const eventPublisher = {
      publishInTransaction: jest.fn().mockResolvedValue(markerId),
    };
    const lifecycle = new OrganizationAccountLifecycleService(
      prisma,
      new AccountEntitlementService(prisma),
      eventPublisher as unknown as DomainEventPublisher,
    );

    await lifecycle.materializeReachedClosure(organizationId, now);

    await expect(
      prisma.db.organizationDeletionMarker.findUniqueOrThrow({
        where: { organizationId },
      }),
    ).resolves.toMatchObject({
      organizationId,
      accessEndsAt,
      effectiveClosureAt: irreversibleClosureAt,
      deletionDeadline,
    });
    await expect(
      prisma.db.organizationClosureExecution.findUniqueOrThrow({
        where: { organizationId },
      }),
    ).resolves.toMatchObject({
      organizationId,
      effectiveClosureAt: irreversibleClosureAt,
      deletionDeadline,
      stage: OrganizationClosureExecutionStage.PENDING,
    });
  });

  async function createRestoredPreClosureFixture(input: {
    organizationId: OrganizationId;
    markerId: string;
    accessEndsAt: Date;
    effectiveClosureAt: Date;
    deletionDeadline: Date;
  }): Promise<void> {
    const fixtureReason = 'Restored pre-closure deletion regression fixture';
    await prisma.$transaction(async (tx) => {
      await tx.organization.create({
        data: {
          id: input.organizationId,
          name: `Restored closure ${input.organizationId}`,
          slug: `restored-closure-${input.organizationId}`,
        },
      });
      await tx.accountEntitlement.create({
        data: {
          organizationId: input.organizationId,
          subscriptionType: AccountSubscriptionType.BETA,
          accessStatus: AccountAccessStatus.ACTIVE,
          accessThroughAt: null,
          paidThroughAt: null,
          revision: 1,
          createdBy: fixtureReason,
          createdReason: fixtureReason,
          updatedBy: fixtureReason,
          updateReason: fixtureReason,
        },
      });
      await tx.organizationAccountLifecycle.create({
        data: {
          organizationId: input.organizationId,
          lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
          accessEndsAt: null,
          deletionEligibleAt: null,
          irreversibleClosureAt: null,
          deletedAt: null,
          closureEntitlementRevision: null,
          revision: 1,
          createdBy: fixtureReason,
          createdReason: fixtureReason,
          updatedBy: fixtureReason,
          updateReason: fixtureReason,
        },
      });
      const batchInternalId = randomUUID();
      const batchId = randomUUID();
      await tx.analyticsEventBatch.create({
        data: {
          id: batchInternalId,
          batchId,
          userId: randomUUID(),
          organizationId: input.organizationId,
          timestamp: input.effectiveClosureAt,
          deviceInfo: {},
          eventsCount: 1,
        },
      });
      await tx.analyticsEvent.create({
        data: {
          id: randomUUID(),
          batchInternalId,
          batchId,
          eventId: randomUUID(),
          sessionId: randomUUID(),
          userId: randomUUID(),
          organizationId: input.organizationId,
          category: 'account-closure-regression',
          action: 'fixture',
          timestamp: input.effectiveClosureAt,
          url: 'https://example.test/closure-fixture',
          userAgent: 'organization-account-data-deletion-integration',
          viewport: {},
          context: {},
          data: {},
        },
      });
      await tx.organizationDeletionMarker.create({
        data: {
          organizationId: input.organizationId,
          id: input.markerId,
          accessEndsAt: input.accessEndsAt,
          effectiveClosureAt: input.effectiveClosureAt,
          deletionDeadline: input.deletionDeadline,
        },
      });
      await tx.organizationClosureExecution.create({
        data: {
          organizationId: input.organizationId,
          markerId: input.markerId,
          effectiveClosureAt: input.effectiveClosureAt,
          deletionDeadline: input.deletionDeadline,
          stage: OrganizationClosureExecutionStage.PENDING,
          nextRetryAt: input.effectiveClosureAt,
        },
      });
      await tx.outboxEvent.create({
        data: {
          correlationId: randomUUID(),
          eventType: 'organization.closed',
          aggregateType: 'organization',
          aggregateId: input.organizationId,
          payload: {
            payloadType: 'organization.closed',
            organizationId: input.organizationId,
            markerId: input.markerId,
            effectiveClosureAt: input.effectiveClosureAt.toISOString(),
            deletionDeadline: input.deletionDeadline.toISOString(),
          },
          partitionKey: input.organizationId,
          sourceService: 'organization-account-data-deletion-integration',
          sourceMethod: 'createRestoredPreClosureFixture',
          organizationId: input.organizationId,
        },
      });
    });
  }

  async function applyAuthoritativeRecoveryPurge(
    organizationId: OrganizationId,
  ): Promise<void> {
    await prisma.$transaction(async (tx) => {
      await tx.outboxEvent.deleteMany({
        where: {
          organizationId,
          eventType: { not: 'organization.closed' },
        },
      });
      await tx.organization.deleteMany({ where: { id: organizationId } });
    });
  }
});
