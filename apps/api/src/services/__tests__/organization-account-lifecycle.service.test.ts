import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  AccountAccessStatus,
  AccountSubscriptionType,
  OrganizationAccountLifecycle,
  OrganizationAccountLifecycleState,
  OrganizationClosureExecution,
  OrganizationDeletionMarker,
  OrganizationRole,
  Prisma,
} from '@prisma/client';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import { PrismaService } from '../../prisma/prisma.service';
import type { OrganizationId, UserId } from '../../types';
import { AccountEntitlementService } from '../account-entitlement.service';
import { DEMO_SYSTEM_USER_ID } from '../demo-sandbox/demo-sandbox.constants';
import { OrganizationAccountLifecycleService } from '../organization-account-lifecycle.service';

const organizationId = '50e01076-bce8-4a65-b205-c5da8480e8fb' as OrganizationId;
const actorId = '3b8a5b0e-33d7-4aa1-8b6f-dc362aa62597' as UserId;
const markerId = '43ed65fa-b0a8-4fe3-9577-28ee86f964d1';
const now = new Date('2026-08-14T12:00:00.000Z');
const graceEndsAt = new Date(now.getTime() + 27 * 24 * 60 * 60 * 1000);
const deletionDeadline = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

interface LifecycleTransactionMock {
  $queryRaw: jest.Mock;
  $executeRaw: jest.Mock;
  organizationMember: { findUnique: jest.Mock; findMany: jest.Mock };
  accountEntitlement: { findUnique: jest.Mock };
  organizationAccountLifecycle: {
    findUnique: jest.Mock;
    findUniqueOrThrow: jest.Mock;
    create: jest.Mock;
    updateMany: jest.Mock;
  };
  organizationAccountLifecycleTransition: { create: jest.Mock };
  organizationDeletionMarker: { findUnique: jest.Mock; create: jest.Mock };
  organizationClosureExecution: { findUnique: jest.Mock; create: jest.Mock };
}

const entitlement = (
  overrides: Partial<{
    subscriptionType: AccountSubscriptionType;
    accessStatus: AccountAccessStatus;
    accessThroughAt: Date | null;
    paidThroughAt: Date | null;
    revision: number;
  }> = {},
) => ({
  organizationId,
  subscriptionType: AccountSubscriptionType.BETA,
  accessStatus: AccountAccessStatus.ACTIVE,
  accessThroughAt: null,
  paidThroughAt: null,
  revision: 4,
  createdAt: now,
  createdBy: actorId,
  createdReason: 'admission',
  updatedAt: now,
  updatedBy: actorId,
  updateReason: 'admission',
  ...overrides,
});

describe('OrganizationAccountLifecycleService', () => {
  let currentLifecycle: OrganizationAccountLifecycle | null;
  let currentEntitlement: ReturnType<typeof entitlement>;
  let deletionMarker: OrganizationDeletionMarker | null;
  let closureExecution: OrganizationClosureExecution | null;
  let tx: LifecycleTransactionMock;
  let service: OrganizationAccountLifecycleService;
  let eventPublisher: Pick<DomainEventPublisher, 'publishInTransaction'>;

  beforeEach(() => {
    jest.useFakeTimers({ now });
    currentLifecycle = null;
    deletionMarker = null;
    closureExecution = null;
    currentEntitlement = entitlement();
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: organizationId }]),
      $executeRaw: jest.fn(async () => {
        if (
          !currentLifecycle ||
          currentLifecycle.lifecycleState !==
            OrganizationAccountLifecycleState.SUSPENDED ||
          !currentLifecycle.deletionEligibleAt ||
          currentLifecycle.deletionEligibleAt.getTime() <= Date.now()
        ) {
          return 0;
        }
        currentLifecycle = {
          ...currentLifecycle,
          lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
          accessEndsAt: null,
          deletionEligibleAt: null,
          irreversibleClosureAt: null,
          deletedAt: null,
          closureEntitlementRevision: null,
          revision: currentLifecycle.revision + 1,
          updatedAt: new Date(),
          updatedBy: actorId,
          updateReason: 'Organization account reactivation',
        };
        return 1;
      }),
      organizationMember: {
        findUnique: jest.fn().mockResolvedValue({
          isActive: true,
          role: OrganizationRole.OWNER,
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: DEMO_SYSTEM_USER_ID }]),
      },
      accountEntitlement: {
        findUnique: jest.fn(async () => currentEntitlement),
      },
      organizationAccountLifecycle: {
        findUnique: jest.fn(async () => currentLifecycle),
        findUniqueOrThrow: jest.fn(async () => {
          if (!currentLifecycle) throw new Error('missing lifecycle');
          return currentLifecycle;
        }),
        create: jest.fn(async ({ data }) => {
          currentLifecycle = {
            ...data,
            createdAt: now,
            updatedAt: now,
          } as OrganizationAccountLifecycle;
          return currentLifecycle;
        }),
        updateMany: jest.fn(async ({ data }) => {
          if (!currentLifecycle) return { count: 0 };
          currentLifecycle = {
            ...currentLifecycle,
            ...data,
            revision: currentLifecycle.revision + 1,
            updatedAt: now,
          } as OrganizationAccountLifecycle;
          return { count: 1 };
        }),
      },
      organizationAccountLifecycleTransition: {
        create: jest.fn().mockResolvedValue(undefined),
      },
      organizationDeletionMarker: {
        findUnique: jest.fn(async () => deletionMarker),
        create: jest.fn(async ({ data }) => {
          deletionMarker = {
            ...data,
            id: markerId,
            recordedAt: now,
          } as OrganizationDeletionMarker;
          return deletionMarker;
        }),
      },
      organizationClosureExecution: {
        findUnique: jest.fn(async () => closureExecution),
        create: jest.fn(async ({ data }) => {
          closureExecution = {
            ...data,
            stage: 'PENDING',
            attemptCount: 0,
            attemptId: null,
            nextRetryAt: now,
            claimToken: null,
            claimedAt: null,
            leaseExpiresAt: null,
            startedAt: null,
            lastAttemptedAt: null,
            lastFailure: null,
            failedAt: null,
            completedAt: null,
            revision: 1,
            createdAt: now,
            updatedAt: now,
          } as OrganizationClosureExecution;
          return closureExecution;
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (
          callback: (client: LifecycleTransactionMock) => Promise<unknown>,
        ) => callback(tx),
      ),
    } as unknown as PrismaService;
    eventPublisher = {
      publishInTransaction: jest.fn().mockResolvedValue(markerId),
    };
    service = new OrganizationAccountLifecycleService(
      prisma,
      new AccountEntitlementService({} as PrismaService),
      eventPublisher as DomainEventPublisher,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an active lifecycle when no cancellation has been scheduled', async () => {
    await expect(service.get(organizationId, actorId)).resolves.toEqual({
      lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
      accessEndsAt: null,
      deletionEligibleAt: null,
      irreversibleClosureAt: null,
      deletedAt: null,
      accessAllowed: true,
      canReactivate: false,
    });
  });

  it('starts a 27-day recoverable suspension without creating deletion evidence', async () => {
    await expect(service.cancel(organizationId, actorId)).resolves.toEqual({
      lifecycleState: OrganizationAccountLifecycleState.SUSPENDED,
      accessEndsAt: now.toISOString(),
      deletionEligibleAt: graceEndsAt.toISOString(),
      irreversibleClosureAt: null,
      deletedAt: null,
      accessAllowed: false,
      canReactivate: true,
    });
    expect(tx.organizationDeletionMarker.create).not.toHaveBeenCalled();
  });

  it('keeps access active through a future authoritative horizon', async () => {
    const accessEndsAt = new Date('2026-08-20T12:00:00.000Z');
    currentEntitlement = entitlement({ accessThroughAt: accessEndsAt });

    await expect(service.cancel(organizationId, actorId)).resolves.toEqual(
      expect.objectContaining({
        lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
        accessEndsAt: accessEndsAt.toISOString(),
        accessAllowed: true,
        canReactivate: false,
      }),
    );
  });

  it('reactivates during suspension and clears every scheduled milestone', async () => {
    await service.cancel(organizationId, actorId);

    await expect(service.reactivate(organizationId, actorId)).resolves.toEqual({
      lifecycleState: OrganizationAccountLifecycleState.ACTIVE,
      accessEndsAt: null,
      deletionEligibleAt: null,
      irreversibleClosureAt: null,
      deletedAt: null,
      accessAllowed: true,
      canReactivate: false,
      outcome: 'REACTIVATED',
    });
  });

  it('commits irreversible closure at the deadline and returns typed deadline-lost data', async () => {
    await service.cancel(organizationId, actorId);
    jest.setSystemTime(graceEndsAt);

    let error: unknown;
    try {
      await service.reactivate(organizationId, actorId);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'REACTIVATION_DEADLINE_LOST',
      data: {
        outcome: 'DEADLINE_LOST',
        lifecycle: {
          lifecycleState: OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED,
          irreversibleClosureAt: graceEndsAt.toISOString(),
          canReactivate: false,
        },
      },
    });
    expect(tx.organizationDeletionMarker.create).toHaveBeenCalledWith({
      data: {
        organizationId,
        accessEndsAt: now,
        effectiveClosureAt: graceEndsAt,
        deletionDeadline,
      },
    });
    expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(tx, {
      type: EVENT_TYPES.ORGANIZATION.CLOSED,
      aggregateId: organizationId,
      payload: {
        payloadType: EVENT_TYPES.ORGANIZATION.CLOSED,
        organizationId,
        markerId,
        irreversibleClosureAt: graceEndsAt.toISOString(),
        deletionDeadline: deletionDeadline.toISOString(),
      },
    });
  });

  it('rejects deletion evidence before irreversible closure commits', async () => {
    await service.cancel(organizationId, actorId);

    await expect(
      service.establishReachedClosureEvidence(
        tx as unknown as Prisma.TransactionClient,
        organizationId,
        currentLifecycle as OrganizationAccountLifecycle,
        now,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  describe('closeImmediatelyForSystemOrganization', () => {
    it('commits irreversible closure and its deletion evidence in the caller transaction', async () => {
      const marker = await service.closeImmediatelyForSystemOrganization(
        tx as unknown as Prisma.TransactionClient,
        organizationId,
        'demo-sandbox-discard',
        'Demo sandbox provisioning failed',
      );

      expect(marker.organizationId).toBe(organizationId);
      expect(currentLifecycle).toEqual(
        expect.objectContaining({
          lifecycleState: OrganizationAccountLifecycleState.IRREVERSIBLY_CLOSED,
          accessEndsAt: now,
          deletionEligibleAt: now,
          irreversibleClosureAt: now,
          closureEntitlementRevision: 4,
        }),
      );
      expect(tx.organizationClosureExecution.create).toHaveBeenCalledTimes(1);
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ type: EVENT_TYPES.ORGANIZATION.CLOSED }),
      );
    });

    it('refuses an organization owned by a customer', async () => {
      tx.organizationMember.findMany.mockResolvedValue([{ userId: actorId }]);

      await expect(
        service.closeImmediatelyForSystemOrganization(
          tx as unknown as Prisma.TransactionClient,
          organizationId,
          'demo-sandbox-expiry',
          'Demo sandbox expired after inactivity',
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(currentLifecycle).toBeNull();
      expect(tx.organizationClosureExecution.create).not.toHaveBeenCalled();
    });

    it('refuses an organization with no owner or a mixed ownership', async () => {
      for (const owners of [
        [],
        [{ userId: DEMO_SYSTEM_USER_ID }, { userId: actorId }],
      ]) {
        tx.organizationMember.findMany.mockResolvedValue(owners);
        await expect(
          service.closeImmediatelyForSystemOrganization(
            tx as unknown as Prisma.TransactionClient,
            organizationId,
            'demo-sandbox-expiry',
            'Demo sandbox expired after inactivity',
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
    });

    it('refuses an organization that already has an account lifecycle', async () => {
      await service.cancel(organizationId, actorId);

      await expect(
        service.closeImmediatelyForSystemOrganization(
          tx as unknown as Prisma.TransactionClient,
          organizationId,
          'demo-sandbox-discard',
          'Demo sandbox provisioning failed',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
