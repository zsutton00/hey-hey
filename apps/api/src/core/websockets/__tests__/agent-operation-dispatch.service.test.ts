import {
  AgentOperationAuthorizationKind,
  AgentOperationDispatchState,
  AgentOperationKind,
  AgentOperationState,
} from '@prisma/client';
import { AgentOperationDispatchService } from '../agent-operation-dispatch.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { TriggerEmitter } from '../trigger-emitter.service';

const operationId = '11111111-1111-4111-8111-111111111111';
const dispatchRecord = (
  operationState: AgentOperationState = AgentOperationState.DISPATCH_PENDING,
  selectedOperationId = operationId,
  machineId = 'machine-1',
) => ({
  operationId: selectedOperationId,
  authorizationId: 'authorization-1',
  authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
  grantId: 'grant-1',
  machineId,
  triggerMessageId: 'message-1',
  createdAt: new Date(Date.now() - 2_000),
  state: AgentOperationDispatchState.CLAIMED,
  attemptCount: 1,
  claimOwner: 'worker-1',
  claimExpiresAt: new Date(Date.now() + 10_000),
  nextAttemptAt: new Date(),
  lastAttemptAt: new Date(),
  lastFailureCode: null,
  operation: {
    operationId: selectedOperationId,
    organizationId: 'organization-1',
    projectId: 'project-1',
    agentSessionId: 'session-1',
    conversationId: 'conversation-1',
    authorizationId: 'authorization-1',
    authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
    grantId: 'grant-1',
    triggerMessageId: 'message-1',
    state: operationState,
    result: null,
  },
});

const createService = (
  emitResult:
    | {
        acknowledged: true;
        machineId: string;
        acknowledgement: {
          status: 'ACCEPTED';
          operationId: string;
          operationFingerprint: string;
          replayed: boolean;
          inputDisposition: 'IMMEDIATE' | 'QUEUED' | 'NONE';
        };
      }
    | { acknowledged: false; reason?: string },
) => {
  const dispatch = jest
    .fn()
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValue({ count: 1 });
  const operation = jest.fn().mockResolvedValue({ count: 1 });
  const transaction = {
    message: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    $executeRaw: jest.fn(),
    agentOperationDispatch: { updateMany: dispatch },
    agentOperation: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: operation,
    },
    outboxEvent: {
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
  };
  const prisma = {
    db: {
      executionGrant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      agentOperationDispatch: {
        findFirst: jest.fn().mockResolvedValue({
          ...dispatchRecord(),
          state: AgentOperationDispatchState.PENDING,
        }),
        updateMany: dispatch,
        findUnique: jest.fn().mockResolvedValue(dispatchRecord()),
      },
      agentOperation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      conversation: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(
        async (callback: (tx: typeof transaction) => Promise<void>) =>
          callback(transaction),
      ),
    },
  };
  const triggerEmitter = {
    emitConversationTriggerWithAck: jest.fn().mockResolvedValue(emitResult),
  };
  const metrics = {
    recordDeliveryAttempt: jest.fn(),
    recordDispatchQueueWait: jest.fn(),
    recordDispatchCommitToAck: jest.fn(),
    recordTerminalOutcome: jest.fn(),
    recordExpiredClaimRecovery: jest.fn(),
    normalizeDeliveryReason: jest.fn((reason?: string) =>
      reason === 'timeout'
        ? 'acknowledgement_timeout'
        : reason?.startsWith('cli_rejected')
          ? 'cli_rejected'
          : (reason ?? 'transport_failure'),
    ),
  };
  return {
    service: new AgentOperationDispatchService(
      prisma as unknown as PrismaService,
      triggerEmitter as unknown as TriggerEmitter,
      metrics as never,
      { publishMessageUpdatedEvent: jest.fn() } as never,
    ),
    prisma,
    triggerEmitter,
    dispatch,
    operation,
    transaction,
    metrics,
  };
};

describe('AgentOperationDispatchService', () => {
  it('marks the operation successful after the exact CLI acknowledgement', async () => {
    const context = createService({
      acknowledged: true,
      machineId: 'machine-1',
      acknowledgement: {
        status: 'ACCEPTED',
        operationId,
        operationFingerprint: 'a'.repeat(64),
        replayed: true,
        inputDisposition: 'QUEUED',
      },
    });

    await context.service.dispatchOne();

    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        machineId: 'machine-1',
        agentSessionId: 'session-1',
        authorizationId: 'authorization-1',
        grantId: 'grant-1',
        envelopeAuthorization: {
          kind: 'bounded_grant',
          grantId: 'grant-1',
        },
        preferPersistedActivation: false,
      }),
    );
    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operationId,
          state: AgentOperationState.DISPATCH_PENDING,
        }),
        data: expect.objectContaining({ state: AgentOperationState.SUCCEEDED }),
      }),
    );
    expect(context.metrics.recordDeliveryAttempt).toHaveBeenCalledWith(
      'acknowledged',
      'accepted',
      expect.any(Number),
    );
    expect(context.metrics.recordTerminalOutcome).toHaveBeenCalledWith(
      'acknowledged',
      'accepted',
    );
  });

  it.each(['IMMEDIATE', 'QUEUED'] as const)(
    'records a %s admission disposition once on the submitted message with the acknowledgement',
    async (inputDisposition) => {
      const context = createService({
        acknowledged: true,
        machineId: 'machine-1',
        acknowledgement: {
          status: 'ACCEPTED',
          operationId,
          operationFingerprint: 'a'.repeat(64),
          replayed: false,
          inputDisposition,
        },
      });

      await context.service.dispatchOne();

      expect(context.transaction.message.updateMany).toHaveBeenCalledWith({
        where: {
          executionOperationId: operationId,
          executionAdmissionDisposition: null,
        },
        data: { executionAdmissionDisposition: inputDisposition },
      });
    },
  );

  it('records no message disposition when the operation admitted no input', async () => {
    const context = createService({
      acknowledged: true,
      machineId: 'machine-1',
      acknowledgement: {
        status: 'ACCEPTED',
        operationId,
        operationFingerprint: 'a'.repeat(64),
        replayed: false,
        inputDisposition: 'NONE',
      },
    });

    await context.service.dispatchOne();

    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: AgentOperationState.SUCCEEDED }),
      }),
    );
    expect(context.transaction.message.updateMany).not.toHaveBeenCalled();
  });

  it('records no message disposition when the acknowledgement loses its claim', async () => {
    const context = createService({
      acknowledged: true,
      machineId: 'machine-1',
      acknowledgement: {
        status: 'ACCEPTED',
        operationId,
        operationFingerprint: 'a'.repeat(64),
        replayed: false,
        inputDisposition: 'IMMEDIATE',
      },
    });
    context.dispatch
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 0 });

    await context.service.dispatchOne();

    expect(context.transaction.message.updateMany).not.toHaveBeenCalled();
  });

  it('records queue wait once on a first attempt with its dispatch wake source', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    const logger = (
      context.service as unknown as { logger: { log: jest.Mock } }
    ).logger;
    const log = jest.spyOn(logger, 'log');

    await context.service.nudgeForOperation(operationId);

    expect(context.metrics.recordDispatchQueueWait).toHaveBeenCalledTimes(1);
    expect(context.metrics.recordDispatchQueueWait).toHaveBeenCalledWith(
      'submission',
      expect.any(Number),
    );
    expect(log).toHaveBeenCalledWith(
      '[AgentOperationDispatchService] first dispatch attempt',
      expect.objectContaining({
        operationId,
        wakeSource: 'submission',
        queueWaitMs: expect.any(Number),
      }),
    );
  });

  it('does not record queue wait for a retry, and records commit-to-ack on acknowledgement', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    context.triggerEmitter.emitConversationTriggerWithAck
      .mockReset()
      .mockResolvedValueOnce({ acknowledged: false, reason: 'timeout' })
      .mockResolvedValueOnce({
        acknowledged: true,
        machineId: 'machine-1',
        acknowledgement: {
          status: 'ACCEPTED',
          operationId,
          operationFingerprint: 'a'.repeat(64),
          replayed: false,
          inputDisposition: 'QUEUED',
        },
      });
    context.prisma.db.agentOperationDispatch.findUnique
      .mockResolvedValueOnce(dispatchRecord())
      .mockResolvedValueOnce({ ...dispatchRecord(), attemptCount: 2 });

    await context.service.dispatchOne();
    await context.service.dispatchOne();

    expect(context.metrics.recordDispatchQueueWait).toHaveBeenCalledTimes(1);
    expect(context.metrics.recordDispatchQueueWait).toHaveBeenCalledWith(
      'sweep',
      expect.any(Number),
    );
    expect(context.metrics.recordDispatchCommitToAck).toHaveBeenCalledTimes(1);
    expect(context.metrics.recordDispatchCommitToAck).toHaveBeenCalledWith(
      expect.any(Number),
    );
  });

  it('reconstructs persisted activation only for fresh controller evidence', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findUnique)
      .mockResolvedValue({
        ...dispatchRecord(),
        authorizationKind: AgentOperationAuthorizationKind.CONTROLLER_ASSERTION,
        operation: {
          ...dispatchRecord().operation,
          authorizationKind:
            AgentOperationAuthorizationKind.CONTROLLER_ASSERTION,
        },
      });

    await context.service.dispatchOne();

    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        envelopeAuthorization: undefined,
        preferPersistedActivation: true,
      }),
    );
  });

  it('releases timeout delivery back to the pending queue with backoff', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });

    await context.service.dispatchOne();

    expect(context.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationDispatchState.PENDING,
          lastFailureCode: 'timeout',
          claimOwner: null,
          claimExpiresAt: null,
        }),
      }),
    );
    expect(context.operation).not.toHaveBeenCalled();
    expect(context.metrics.recordDeliveryAttempt).toHaveBeenCalledWith(
      'retry_scheduled',
      'acknowledgement_timeout',
      expect.any(Number),
    );
  });

  it.each([
    'no_recipient',
    'exact_machine_not_ready',
    'exact_machine_credential_unavailable',
    'invalid_acknowledgement',
    'acknowledgement_identity_mismatch',
  ])('keeps %s pending for the same durable operation', async (reason) => {
    const context = createService({ acknowledged: false, reason });

    await context.service.dispatchOne();

    expect(context.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operationId,
          state: AgentOperationDispatchState.CLAIMED,
        }),
        data: expect.objectContaining({
          state: AgentOperationDispatchState.PENDING,
          lastFailureCode: reason,
        }),
      }),
    );
    expect(context.operation).not.toHaveBeenCalled();
  });

  it('reclaims an expired lease and retries the same durable delivery', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findFirst)
      .mockResolvedValue({
        ...dispatchRecord(),
        state: AgentOperationDispatchState.CLAIMED,
        claimExpiresAt: new Date(Date.now() - 1_000),
      });

    await context.service.dispatchOne();

    expect(context.dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          operationId,
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  state: AgentOperationDispatchState.CLAIMED,
                  claimExpiresAt: expect.any(Object),
                }),
              ]),
            }),
          ]),
        }),
        data: expect.objectContaining({
          state: AgentOperationDispatchState.CLAIMED,
          attemptCount: { increment: 1 },
        }),
      }),
    );
    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).toHaveBeenCalledTimes(1);
    expect(context.metrics.recordExpiredClaimRecovery).toHaveBeenCalledTimes(1);
  });

  it('records an explicit CLI rejection as terminal denial', async () => {
    const context = createService({
      acknowledged: false,
      reason: 'cli_rejected',
    });

    await context.service.dispatchOne();

    expect(context.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationDispatchState.REJECTED,
          lastFailureCode: 'cli_rejected',
        }),
      }),
    );
    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: AgentOperationState.DENIED }),
      }),
    );
    expect(context.metrics.recordDeliveryAttempt).toHaveBeenCalledWith(
      'denied',
      'cli_rejected',
      expect.any(Number),
    );
    expect(context.metrics.recordTerminalOutcome).toHaveBeenCalledWith(
      'denied',
      'cli_rejected',
    );
  });

  it.each([
    ['cli_rejected', 'START_RUN_REJECTED'],
    ['agent_session_missing', 'START_RUN_FAILED'],
    ['no_recipient', 'START_RUN_FAILED'],
    ['exact_machine_not_ready', 'START_RUN_FAILED'],
    ['exact_machine_credential_unavailable', 'START_RUN_FAILED'],
    ['timeout', 'START_RUN_FAILED'],
  ])(
    'fails the project report attempt bound to a START_RUN terminalized by %s',
    async (reason, code) => {
      const context = createService({ acknowledged: false, reason });
      context.prisma.db.executionGrant.findUniqueOrThrow.mockResolvedValue({
        expiresAt: new Date(Date.now() - 1),
      });
      const record = dispatchRecord();
      context.prisma.db.agentOperationDispatch.findUnique.mockResolvedValue({
        ...record,
        operation: { ...record.operation, kind: AgentOperationKind.START_RUN },
      });
      const attemptUpdate = jest.fn().mockResolvedValue({ count: 1 });
      const requestUpdate = jest.fn();
      Object.assign(context.transaction, {
        $queryRaw: jest.fn(),
        projectReportAttempt: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'attempt-1', requestId: 'request-1' }),
          findFirst: jest.fn().mockResolvedValue({ id: 'attempt-1' }),
          updateMany: attemptUpdate,
        },
        projectReportRequest: { update: requestUpdate },
      });

      await context.service.dispatchOne();

      expect(
        (
          context.transaction as unknown as {
            projectReportAttempt: { findUnique: jest.Mock };
          }
        ).projectReportAttempt.findUnique,
      ).toHaveBeenCalledWith({
        where: { agentSessionId: 'session-1' },
        select: { id: true, requestId: true },
      });
      expect(attemptUpdate).toHaveBeenCalledWith({
        where: {
          id: 'attempt-1',
          requestId: 'request-1',
          status: { in: ['QUEUED', 'RUNNING'] },
        },
        data: expect.objectContaining({
          status: 'FAILED',
          failure: expect.objectContaining({ stage: 'LAUNCH', code }),
        }),
      });
      expect(requestUpdate).toHaveBeenCalledWith({
        where: { id: 'request-1' },
        data: { status: 'FAILED' },
      });
      expect(attemptUpdate.mock.calls[0][0].data.failure.retryable).toBe(true);
    },
  );

  it('retries an offline launch until expiry, then fails it without a client wake-up', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const context = createService({
      acknowledged: false,
      reason: 'no_recipient',
    });
    const record = dispatchRecord();
    context.prisma.db.agentOperationDispatch.findUnique.mockResolvedValue({
      ...record,
      operation: { ...record.operation, kind: AgentOperationKind.START_RUN },
    });
    Object.assign(context.transaction, {
      projectReportAttempt: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const expiresAt = new Date(now + 100);
    context.prisma.db.executionGrant.findUniqueOrThrow.mockResolvedValue({
      expiresAt,
    });

    await context.service.dispatchOne();

    expect(context.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationDispatchState.PENDING,
          nextAttemptAt: expiresAt,
        }),
      }),
    );
    expect(context.operation).not.toHaveBeenCalled();
    clock.mockReturnValue(expiresAt.getTime());

    await context.service.dispatchOne();

    expect(context.operation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationState.FAILED,
          failureCode: 'START_RUN_GRANT_EXPIRED',
        }),
      }),
    );
    expect(context.metrics.recordTerminalOutcome).toHaveBeenCalledTimes(1);
    clock.mockRestore();
  });

  it('preserves a START_RUN acknowledged just before grant expiry', async () => {
    const context = createService({
      acknowledged: true,
      machineId: 'machine-1',
      acknowledgement: {
        status: 'ACCEPTED',
        operationId,
        operationFingerprint: 'a'.repeat(64),
        replayed: false,
        inputDisposition: 'NONE',
      },
    });
    const record = dispatchRecord();
    context.prisma.db.agentOperationDispatch.findUnique.mockResolvedValue({
      ...record,
      operation: { ...record.operation, kind: AgentOperationKind.START_RUN },
    });
    context.prisma.db.executionGrant.findUniqueOrThrow.mockResolvedValue({
      expiresAt: new Date(Date.now() + 1),
    });

    await context.service.dispatchOne();

    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: AgentOperationState.SUCCEEDED }),
      }),
    );
    expect(
      context.prisma.db.executionGrant.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
  });

  it('records a lost lease only after the acknowledgement transition loses its claim', async () => {
    const context = createService({
      acknowledged: true,
      machineId: 'machine-1',
      acknowledgement: {
        status: 'ACCEPTED',
        operationId,
        operationFingerprint: 'a'.repeat(64),
        replayed: false,
        inputDisposition: 'QUEUED',
      },
    });
    context.dispatch
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await context.service.dispatchOne();

    expect(context.operation).not.toHaveBeenCalled();
    expect(context.metrics.recordDeliveryAttempt).toHaveBeenCalledWith(
      'claim_lost',
      'lease_lost',
      expect.any(Number),
    );
    expect(context.metrics.recordTerminalOutcome).not.toHaveBeenCalled();
  });

  it('records a detailed CLI rejection as terminal denial', async () => {
    const context = createService({
      acknowledged: false,
      reason: 'cli_rejected:ADMISSION:AUTHORIZATION_REJECTED',
    });

    await context.service.dispatchOne();

    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: AgentOperationState.DENIED }),
      }),
    );
  });

  it.each([
    'agent_session_missing',
    'machine_binding_missing',
    'exact_machine_missing',
    'exact_machine_revoked',
    'exact_machine_foreign',
    'exact_machine_protocol_invalid',
  ])('terminalizes the provable %s contradiction once', async (reason) => {
    const context = createService({ acknowledged: false, reason });

    await context.service.dispatchOne();

    expect(context.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operationId,
          state: AgentOperationDispatchState.CLAIMED,
        }),
        data: expect.objectContaining({
          state: AgentOperationDispatchState.REJECTED,
          lastFailureCode: reason,
        }),
      }),
    );
    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ state: AgentOperationState.FAILED }),
      }),
    );
  });

  it('wakes only delayed pending rows for the exact recovered machine', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findFirst)
      .mockResolvedValueOnce({
        ...dispatchRecord(),
        state: AgentOperationDispatchState.PENDING,
      })
      .mockResolvedValueOnce(null);

    await context.service.nudgeForMachine('machine-1');

    expect(context.dispatch).toHaveBeenCalledWith({
      where: {
        machineId: 'machine-1',
        state: AgentOperationDispatchState.PENDING,
        nextAttemptAt: { gt: expect.any(Date) },
      },
      data: { nextAttemptAt: expect.any(Date) },
    });
    expect(
      context.prisma.db.agentOperationDispatch.findFirst,
    ).toHaveBeenCalledTimes(2);
    for (const [query] of jest.mocked(
      context.prisma.db.agentOperationDispatch.findFirst,
    ).mock.calls) {
      expect(query).toEqual(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: expect.arrayContaining([{ machineId: 'machine-1' }]),
          }),
        }),
      );
    }
  });

  it('claims the committed operation instead of an older unrelated row', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });

    await context.service.nudgeForOperation(operationId);

    expect(
      context.prisma.db.agentOperationDispatch.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ operationId }]),
        }),
      }),
    );
    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).toHaveBeenCalledTimes(1);
  });

  it('runs an exact wake-up while the global nudge is still active', async () => {
    const olderOperationId = '22222222-2222-4222-8222-222222222222';
    const context = createService({ acknowledged: false, reason: 'timeout' });
    let releaseGlobal!: () => void;
    const globalDelivery = new Promise<void>((resolve) => {
      releaseGlobal = resolve;
    });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findFirst)
      .mockResolvedValueOnce({
        ...dispatchRecord(
          AgentOperationState.DISPATCH_PENDING,
          olderOperationId,
        ),
        state: AgentOperationDispatchState.PENDING,
      })
      .mockResolvedValueOnce({
        ...dispatchRecord(),
        state: AgentOperationDispatchState.PENDING,
      });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findUnique)
      .mockResolvedValueOnce(
        dispatchRecord(AgentOperationState.DISPATCH_PENDING, olderOperationId),
      )
      .mockResolvedValueOnce(dispatchRecord());
    jest
      .mocked(context.triggerEmitter.emitConversationTriggerWithAck)
      .mockImplementationOnce(async () => {
        await globalDelivery;
        return { acknowledged: false, reason: 'timeout' };
      })
      .mockResolvedValueOnce({ acknowledged: false, reason: 'timeout' });

    context.service.nudge();
    await new Promise((resolve) => setImmediate(resolve));
    await context.service.nudgeForOperation(operationId);

    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).toHaveBeenCalledTimes(2);
    expect(
      context.prisma.db.agentOperationDispatch.findFirst,
    ).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{ operationId }]),
        }),
      }),
    );
    releaseGlobal();
    await new Promise((resolve) => setImmediate(resolve));
  });

  it('grants one lease under concurrent exact wake-ups', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findFirst)
      .mockResolvedValue({
        ...dispatchRecord(),
        state: AgentOperationDispatchState.PENDING,
      });
    context.dispatch
      .mockReset()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValue({ count: 1 });

    await Promise.all([
      context.service.nudgeForOperation(operationId),
      context.service.nudgeForOperation(operationId),
    ]);

    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).toHaveBeenCalledTimes(1);
  });

  it('keeps the periodic recovery claim global', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });

    await context.service.dispatchOne();

    expect(
      context.prisma.db.agentOperationDispatch.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([{}]),
        }),
      }),
    );
  });

  it('terminalizes a changed dispatch binding without reopening the terminal operation', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    context.operation.mockResolvedValue({ count: 0 });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findUnique)
      .mockResolvedValue(dispatchRecord(AgentOperationState.SUCCEEDED));

    await context.service.dispatchOne();

    expect(
      context.triggerEmitter.emitConversationTriggerWithAck,
    ).not.toHaveBeenCalled();
    expect(context.operation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          state: AgentOperationState.DISPATCH_PENDING,
        }),
        data: expect.objectContaining({
          state: AgentOperationState.FAILED,
          failureCode: 'DISPATCH_BINDING_CONTRADICTION',
        }),
      }),
    );
    expect(context.metrics.recordDeliveryAttempt).toHaveBeenCalledWith(
      'terminal_failure',
      'binding_contradiction',
      expect.any(Number),
    );
  });

  it('terminalizes a still-pending operation whose dispatch binding changed', async () => {
    const context = createService({ acknowledged: false, reason: 'timeout' });
    context.operation
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    jest
      .mocked(context.prisma.db.agentOperationDispatch.findUnique)
      .mockResolvedValue({
        ...dispatchRecord(),
        operation: {
          ...dispatchRecord().operation,
          grantId: 'changed-grant',
        },
      });

    await context.service.dispatchOne();

    expect(context.operation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          operationId,
          state: AgentOperationState.DISPATCH_PENDING,
        },
        data: expect.objectContaining({
          state: AgentOperationState.FAILED,
          failureCode: 'DISPATCH_BINDING_CONTRADICTION',
        }),
      }),
    );
  });
});
