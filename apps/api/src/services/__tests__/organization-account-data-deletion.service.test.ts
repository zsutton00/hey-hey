import {
  OrganizationClosureExecutionStage,
  OrganizationClosureProjectionConsumer,
  OrganizationClosureProjectionOutcome,
} from '@prisma/client';
import {
  OrganizationAccountDataDeletionService,
  orderOrganizationScopedTables,
} from '../organization-account-data-deletion.service';

describe('OrganizationAccountDataDeletionService', () => {
  const effectiveClosureAt = new Date('2026-08-18T10:00:00.000Z');
  const deletionDeadline = new Date('2026-09-17T10:00:00.000Z');

  function setup() {
    const prisma = {
      db: {
        organizationClosureExecution: {
          findUnique: jest.fn(),
          findUniqueOrThrow: jest.fn(),
          updateMany: jest.fn(),
        },
        organizationClosureProjectionCommand: {
          findMany: jest.fn().mockResolvedValue([]),
        },
      },
      $transaction: jest.fn(),
    };
    const dueWork = {
      materializeNextReachedSnapshot: jest.fn(),
      materializeReachedSnapshot: jest.fn(),
      claimNext: jest.fn(),
    };
    const connectionEviction = {
      evictOrganization: jest.fn().mockResolvedValue(0),
    };
    const accountEntitlements = { transitionInTransaction: jest.fn() };
    const paymentProviderBindings = { snapshotForClosure: jest.fn() };
    const service = new OrganizationAccountDataDeletionService(
      prisma as any,
      dueWork as any,
      connectionEviction as any,
      accountEntitlements as any,
      paymentProviderBindings as any,
    );
    return {
      service,
      prisma,
      dueWork,
      connectionEviction,
      accountEntitlements,
      paymentProviderBindings,
    };
  }

  it('exposes deterministic operator execution for one organization', async () => {
    const { service, prisma, dueWork } = setup();
    const execution = {
      organizationId: 'organization-id',
      stage: OrganizationClosureExecutionStage.PENDING,
    };
    prisma.db.organizationClosureExecution.findUnique.mockResolvedValue(
      execution,
    );
    dueWork.claimNext.mockResolvedValue(execution);
    jest.spyOn(service, 'execute').mockResolvedValue();

    await expect(
      service.executeForOrganization('organization-id' as any),
    ).resolves.toBe(true);

    expect(dueWork.claimNext).toHaveBeenCalledWith(
      expect.any(Date),
      'organization-id',
    );
    expect(service.execute).toHaveBeenCalledWith(execution);
  });

  it('does not execute when the reached closure cannot be claimed', async () => {
    const { service, prisma, dueWork } = setup();
    prisma.db.organizationClosureExecution.findUnique.mockResolvedValue(null);
    dueWork.materializeReachedSnapshot.mockResolvedValue(undefined);
    dueWork.claimNext.mockResolvedValue(null);
    const execute = jest.spyOn(service, 'execute');

    await expect(
      service.executeForOrganization('organization-id' as any),
    ).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('surfaces an execution failure after recording the retry', async () => {
    const { service, prisma } = setup();
    const execution = {
      organizationId: 'organization-id',
      stage: 'UNSUPPORTED_STAGE',
      attemptCount: 1,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
    prisma.db.organizationClosureExecution.updateMany.mockResolvedValue({
      count: 1,
    });

    await expect(service.execute(execution as any)).rejects.toThrow(
      'Unsupported organization closure stage',
    );
    expect(
      prisma.db.organizationClosureExecution.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: 'organization-id',
          claimToken: 'claim-token',
          attemptId: 'attempt-id',
        },
      }),
    );
  });

  it('revokes access through the append-only entitlement transition owner', async () => {
    const { service, prisma, connectionEviction, accountEntitlements } =
      setup();
    const execution = {
      organizationId: 'organization-id',
      stage: OrganizationClosureExecutionStage.PENDING,
      attemptCount: 1,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
      markerId: 'marker-id',
      effectiveClosureAt,
      deletionDeadline,
    };
    const entitlement = {
      subscriptionType: 'BETA',
      accessStatus: 'ACTIVE',
      accessThroughAt: null,
      paidThroughAt: null,
      revision: 4,
    };
    const tx = {
      organization: {
        findUnique: jest.fn().mockResolvedValue({ id: 'organization-id' }),
        update: jest.fn().mockResolvedValue({}),
      },
      organizationAccountLifecycle: {
        findUnique: jest.fn().mockResolvedValue({
          lifecycleState: 'IRREVERSIBLY_CLOSED',
          irreversibleClosureAt: new Date(Date.now() - 1000),
        }),
      },
      accountEntitlement: {
        findUnique: jest.fn().mockResolvedValue(entitlement),
      },
      organizationDeletionMarker: {
        findUnique: jest.fn().mockResolvedValue({
          organizationId: 'organization-id',
          id: 'marker-id',
          effectiveClosureAt,
          deletionDeadline,
        }),
      },
      apiKey: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      organizationClosureExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => any) =>
      callback(tx),
    );
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue({
      ...execution,
      stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
    });
    accountEntitlements.transitionInTransaction.mockResolvedValue({
      ...entitlement,
      accessStatus: 'REVOKED',
      revision: 5,
    });

    await (service as any).revokeAuthority(execution);

    expect(accountEntitlements.transitionInTransaction).toHaveBeenCalledWith(
      tx,
      'organization-id',
      4,
      {
        subscriptionType: 'BETA',
        accessStatus: 'REVOKED',
        accessThroughAt: null,
        paidThroughAt: null,
      },
      {
        actor: 'account-closure-worker',
        reason: 'Effective organization closure',
      },
    );
    expect(connectionEviction.evictOrganization).toHaveBeenCalledWith(
      'organization-id',
    );
  });

  it('advances a PENDING execution when exact retained evidence is the only remaining state', async () => {
    const { service, prisma, connectionEviction, accountEntitlements } =
      setup();
    const execution = pendingExecution();
    const tx = recoveryTransaction({
      marker: matchingMarker(),
    });
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => any) =>
      callback(tx),
    );
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue({
      ...execution,
      stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
    });

    await (service as any).revokeAuthority(execution);

    expect(tx.organizationClosureExecution.updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'organization-id',
        claimToken: 'claim-token',
        attemptId: 'attempt-id',
      },
      data: {
        stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
        updatedAt: expect.any(Date),
        revision: { increment: 1 },
      },
    });
    expect(accountEntitlements.transitionInTransaction).not.toHaveBeenCalled();
    expect(connectionEviction.evictOrganization).toHaveBeenCalledWith(
      'organization-id',
    );
  });

  it.each([
    ['missing marker', null],
    [
      'organization identity',
      matchingMarker({ organizationId: 'different-organization-id' }),
    ],
    ['marker identity', matchingMarker({ id: 'different-marker-id' })],
    [
      'effective closure time',
      matchingMarker({
        effectiveClosureAt: new Date(effectiveClosureAt.getTime() + 1),
      }),
    ],
    [
      'deletion deadline',
      matchingMarker({
        deletionDeadline: new Date(deletionDeadline.getTime() + 1),
      }),
    ],
  ])(
    'rejects all-absent recovery with mismatched %s',
    async (_case, marker) => {
      const { service, prisma, accountEntitlements, connectionEviction } =
        setup();
      const tx = recoveryTransaction({ marker });
      prisma.$transaction.mockImplementation(
        async (callback: (tx: any) => any) => callback(tx),
      );

      await expect(
        (service as any).revokeAuthority(pendingExecution()),
      ).rejects.toThrow(
        'Retained closure marker does not match the claimed execution',
      );
      expect(tx.organizationClosureExecution.updateMany).not.toHaveBeenCalled();
      expect(
        accountEntitlements.transitionInTransaction,
      ).not.toHaveBeenCalled();
      expect(connectionEviction.evictOrganization).not.toHaveBeenCalled();
    },
  );

  it.each([
    [true, false, false],
    [false, true, false],
    [false, false, true],
    [true, true, false],
    [true, false, true],
    [false, true, true],
  ])(
    'rejects partial live state (organization=%s lifecycle=%s entitlement=%s)',
    async (hasOrganization, hasLifecycle, hasEntitlement) => {
      const { service, prisma, accountEntitlements, connectionEviction } =
        setup();
      const tx = recoveryTransaction({
        organization: hasOrganization ? { id: 'organization-id' } : null,
        lifecycle: hasLifecycle
          ? { effectiveClosureAt: new Date(Date.now() - 1000) }
          : null,
        entitlement: hasEntitlement
          ? {
              revision: 1,
              subscriptionType: 'BETA',
              accessThroughAt: null,
              paidThroughAt: null,
            }
          : null,
        marker: matchingMarker(),
      });
      prisma.$transaction.mockImplementation(
        async (callback: (tx: any) => any) => callback(tx),
      );

      await expect(
        (service as any).revokeAuthority(pendingExecution()),
      ).rejects.toThrow(
        'Partial live organization state cannot resume closure execution',
      );
      expect(tx.organizationClosureExecution.updateMany).not.toHaveBeenCalled();
      expect(
        accountEntitlements.transitionInTransaction,
      ).not.toHaveBeenCalled();
      expect(connectionEviction.evictOrganization).not.toHaveBeenCalled();
    },
  );

  it.each([null, new Date(Date.now() + 60_000)])(
    'rejects a complete live state whose closure milestone is %s',
    async (effectiveClosureAt) => {
      const { service, prisma, accountEntitlements, connectionEviction } =
        setup();
      const tx = recoveryTransaction({
        organization: { id: 'organization-id' },
        lifecycle: { effectiveClosureAt },
        entitlement: {
          revision: 1,
          subscriptionType: 'BETA',
          accessThroughAt: null,
          paidThroughAt: null,
        },
        marker: matchingMarker(),
      });
      prisma.$transaction.mockImplementation(
        async (callback: (tx: any) => any) => callback(tx),
      );

      await expect(
        (service as any).revokeAuthority(pendingExecution()),
      ).rejects.toThrow('Closure snapshot has not been reached');
      expect(tx.organizationClosureExecution.updateMany).not.toHaveBeenCalled();
      expect(
        accountEntitlements.transitionInTransaction,
      ).not.toHaveBeenCalled();
      expect(connectionEviction.evictOrganization).not.toHaveBeenCalled();
    },
  );

  it('disconnects organization sockets again before resumed deletion', async () => {
    const { service, prisma, connectionEviction } = setup();
    const execution = {
      organizationId: 'organization-id',
      stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
      attemptCount: 2,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
    const tx = {
      outboxEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organization: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      organizationClosureExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => any) =>
      callback(tx),
    );
    jest
      .spyOn(service as any, 'organizationScopedTables')
      .mockResolvedValue([]);
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue({
      ...execution,
      stage: OrganizationClosureExecutionStage.CONTENT_DELETED,
    });

    await (service as any).deleteContent(execution);

    expect(connectionEviction.evictOrganization).toHaveBeenCalledWith(
      'organization-id',
    );
    expect(
      connectionEviction.evictOrganization.mock.invocationCallOrder[0]!,
    ).toBeLessThan(tx.organization.deleteMany.mock.invocationCallOrder[0]!);
  });

  it('orders analytics events before their referenced batches', () => {
    expect(
      orderOrganizationScopedTables(
        ['analytics_event_batches', 'analytics_events'],
        [
          {
            childTableName: 'analytics_events',
            parentTableName: 'analytics_event_batches',
          },
        ],
      ),
    ).toEqual(['analytics_events', 'analytics_event_batches']);
  });

  it('reports the dependency path when organization tables contain a cycle', () => {
    expect(() =>
      orderOrganizationScopedTables(
        ['analytics_event_batches', 'analytics_events'],
        [
          {
            childTableName: 'analytics_events',
            parentTableName: 'analytics_event_batches',
          },
          {
            childTableName: 'analytics_event_batches',
            parentTableName: 'analytics_events',
          },
        ],
      ),
    ).toThrow(
      'analytics_event_batches -> analytics_events -> analytics_event_batches',
    );
  });

  it('snapshots provider correlation before cascading live organization deletion', async () => {
    const { service, prisma, paymentProviderBindings } = setup();
    const execution = {
      organizationId: 'organization-id',
      markerId: 'marker-id',
      stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
      attemptCount: 2,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
    const tx = {
      outboxEvent: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
      organization: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      organizationClosureExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(async (callback: (tx: any) => any) =>
      callback(tx),
    );
    jest
      .spyOn(service as any, 'organizationScopedTables')
      .mockResolvedValue([]);
    prisma.db.organizationClosureExecution.findUniqueOrThrow.mockResolvedValue({
      ...execution,
      stage: OrganizationClosureExecutionStage.CONTENT_DELETED,
    });

    await (service as any).deleteContent(execution);

    expect(paymentProviderBindings.snapshotForClosure).toHaveBeenCalledWith(
      tx,
      'organization-id',
      'marker-id',
    );
    expect(
      paymentProviderBindings.snapshotForClosure.mock.invocationCallOrder[0]!,
    ).toBeLessThan(tx.organization.deleteMany.mock.invocationCallOrder[0]!);
  });

  it('marks the execution terminal after the fixed attempt bound', async () => {
    const { service, prisma } = setup();
    const execution = {
      organizationId: 'organization-id',
      stage: 'UNSUPPORTED_STAGE',
      attemptCount: 8,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
    prisma.db.organizationClosureExecution.updateMany.mockResolvedValue({
      count: 1,
    });

    await expect(service.execute(execution as any)).rejects.toThrow(
      'Unsupported organization closure stage',
    );
    expect(
      prisma.db.organizationClosureExecution.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          stage: OrganizationClosureExecutionStage.FAILED,
          failedAt: expect.any(Date),
          nextRetryAt: null,
          lastFailure: 'UNSUPPORTED_STAGE:Error',
          claimToken: null,
          claimedAt: null,
          leaseExpiresAt: null,
        }),
      }),
    );
  });

  it('blocks PostgreSQL deletion when either projection acknowledgement is incomplete', async () => {
    const { service, prisma } = setup();
    const execution = {
      organizationId: 'organization-id',
      markerId: 'marker-id',
      effectiveClosureAt: new Date('2026-08-19T12:00:00.000Z'),
      deletionDeadline: new Date('2026-09-18T12:00:00.000Z'),
      stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
      attemptCount: 1,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
    prisma.db.organizationClosureProjectionCommand.findMany.mockResolvedValue([
      {
        organizationId: execution.organizationId,
        markerId: execution.markerId,
        irreversibleClosureAt: execution.effectiveClosureAt,
        deletionDeadline: execution.deletionDeadline,
        consumer: OrganizationClosureProjectionConsumer.GRAPH,
        acknowledgedAt: new Date(),
        verifiedOutcome: OrganizationClosureProjectionOutcome.VERIFIED,
      },
      {
        organizationId: execution.organizationId,
        markerId: execution.markerId,
        irreversibleClosureAt: execution.effectiveClosureAt,
        deletionDeadline: execution.deletionDeadline,
        consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
        acknowledgedAt: null,
        verifiedOutcome: null,
      },
    ]);
    prisma.db.organizationClosureExecution.updateMany.mockResolvedValue({
      count: 1,
    });

    await expect(
      service.executeAfterProjectionDeletion(execution as any),
    ).rejects.toThrow('Projection deletion is not durably verified');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('starts authoritative deletion from the authority-revoked stage after projections verify', async () => {
    const { service, prisma } = setup();
    const execution = {
      organizationId: 'organization-id',
      markerId: 'marker-id',
      effectiveClosureAt: new Date('2026-08-19T12:00:00.000Z'),
      deletionDeadline: new Date('2026-09-18T12:00:00.000Z'),
      stage: OrganizationClosureExecutionStage.AUTHORITY_REVOKED,
      attemptCount: 1,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
    prisma.db.organizationClosureProjectionCommand.findMany.mockResolvedValue([
      {
        organizationId: execution.organizationId,
        markerId: execution.markerId,
        irreversibleClosureAt: execution.effectiveClosureAt,
        deletionDeadline: execution.deletionDeadline,
        consumer: OrganizationClosureProjectionConsumer.GRAPH,
        acknowledgedAt: new Date(),
        verifiedOutcome: OrganizationClosureProjectionOutcome.VERIFIED,
      },
      {
        organizationId: execution.organizationId,
        markerId: execution.markerId,
        irreversibleClosureAt: execution.effectiveClosureAt,
        deletionDeadline: execution.deletionDeadline,
        consumer: OrganizationClosureProjectionConsumer.EMBEDDINGS,
        acknowledgedAt: new Date(),
        verifiedOutcome: OrganizationClosureProjectionOutcome.VERIFIED,
      },
    ]);
    const executeStage = jest
      .spyOn(service as any, 'executeStage')
      .mockResolvedValue({
        ...execution,
        stage: OrganizationClosureExecutionStage.COMPLETED,
      });

    await service.executeAfterProjectionDeletion(execution as any);

    expect(executeStage).toHaveBeenCalledWith(execution);
  });

  function pendingExecution() {
    return {
      organizationId: 'organization-id',
      markerId: 'marker-id',
      effectiveClosureAt,
      deletionDeadline,
      stage: OrganizationClosureExecutionStage.PENDING,
      attemptCount: 1,
      attemptId: 'attempt-id',
      claimToken: 'claim-token',
      claimedAt: new Date(),
    };
  }

  function matchingMarker(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: 'organization-id',
      id: 'marker-id',
      effectiveClosureAt,
      deletionDeadline,
      ...overrides,
    };
  }

  function recoveryTransaction(
    state: {
      organization?: unknown;
      lifecycle?: unknown;
      entitlement?: unknown;
      marker?: unknown;
    } = {},
  ) {
    return {
      organization: {
        findUnique: jest.fn().mockResolvedValue(state.organization ?? null),
      },
      organizationAccountLifecycle: {
        findUnique: jest.fn().mockResolvedValue(state.lifecycle ?? null),
      },
      accountEntitlement: {
        findUnique: jest.fn().mockResolvedValue(state.entitlement ?? null),
      },
      organizationDeletionMarker: {
        findUnique: jest.fn().mockResolvedValue(state.marker ?? null),
      },
      organizationClosureExecution: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }
});
