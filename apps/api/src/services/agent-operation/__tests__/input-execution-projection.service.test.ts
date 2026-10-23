import { InputExecutionProjectionService } from '../input-execution-projection.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { MessageService } from '../../message.service';
import type { TriggerEnvelopeSigner } from '../../../core/websockets/trigger-envelope-signer.service';
import type { WebsocketGateway } from '../../../core/websockets/websocket.gateway';
import { testIds } from '../../../utils/testUtils';
import type { InputExecutionProjection } from '../../../generated';
import type { AuthenticatedMachine } from '../../machine-pairing/machine-pairing.service';

describe('InputExecutionProjectionService', () => {
  const operationId = '09f33263-4e9d-4302-a3bb-ccbb03968ee1';
  const admissionId = 'd7e7b0a5-f048-4b5d-93ba-67bd10d0c9f8';
  const turnId = '93556875-a626-40b0-ac02-ce2c40d7aa99';
  const sessionId = 'dd782d32-b949-4a4f-ad19-aecb21772361';
  const machine = {
    machineId: '19df89c6-e153-4447-b1b2-6c392b558609',
    userId: testIds.user,
  } as AuthenticatedMachine;
  const input = (
    executionStatus: InputExecutionProjection['executionStatus'],
    revision: number,
  ): InputExecutionProjection => ({
    operationId,
    operationFingerprint: 'a'.repeat(64),
    messageId: testIds.message,
    admissionId,
    revision,
    executionStatus,
    ...(executionStatus === 'started' ? { turnId } : {}),
  });
  function setup() {
    const row = {
      id: testIds.message,
      conversationId: testIds.conversation,
      executionOperationId: operationId,
      executionStatus: 'queued',
      executionAdmissionId: null as string | null,
      executionTurnId: null as string | null,
      executionRevision: 0,
      executionCancellationRequested: false,
      createdAt: null as Date | null,
      contentUpdatedAt: null as Date | null,
    };
    const tx = {
      $executeRaw: jest.fn(),
      agentOperation: {
        findFirst: jest.fn().mockResolvedValue({ operationId }),
      },
      message: {
        findUnique: jest.fn(async () => ({ ...row })),
        update: jest.fn(async ({ data }) => Object.assign(row, data)),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
        ),
        message: { findMany: jest.fn().mockResolvedValue([]) },
        $queryRaw: jest.fn(async () =>
          row.executionStatus === 'queued' && row.executionCancellationRequested
            ? [{ id: row.id, executionOperationId: operationId }]
            : [],
        ),
        agentOperation: {
          findUnique: jest.fn().mockResolvedValue({
            operationId,
            fingerprint: 'private-fingerprint',
            agentSessionId: sessionId,
            conversationId: testIds.conversation,
            organizationId: testIds.organization,
            projectId: testIds.project,
            userId: testIds.user,
            dispatch: { machineId: machine.machineId },
          }),
        },
      },
    };
    const messages = {
      publishMessageUpdatedEvent: jest.fn(),
      getQueuedInputs: jest.fn().mockResolvedValue([]),
    };
    const signer = {
      signConversationReduction: jest.fn().mockReturnValue({ signed: true }),
    };
    const gateway = { emitConversationReduction: jest.fn() };
    const service = new InputExecutionProjectionService(
      prisma as unknown as PrismaService,
      messages as unknown as MessageService,
      signer as unknown as TriggerEnvelopeSigner,
      gateway as unknown as WebsocketGateway,
    );
    const project = (value: InputExecutionProjection) =>
      service.project(
        testIds.organization,
        testIds.project,
        sessionId,
        machine,
        value,
      );
    return { row, tx, prisma, messages, service, project, signer, gateway };
  }
  it('retries every two seconds until an accepted cancellation projection clears the durable obligation', async () => {
    jest.useFakeTimers();
    const { row, service, project, gateway } = setup();
    row.executionCancellationRequested = true;
    service.onModuleInit();
    try {
      await jest.advanceTimersByTimeAsync(4_000);
      expect(gateway.emitConversationReduction).toHaveBeenCalledTimes(2);
      expect(row.executionStatus).toBe('queued');
      expect(await project(input('cancelled', 2))).toEqual({ accepted: true });
      await jest.advanceTimersByTimeAsync(4_000);
      expect(gateway.emitConversationReduction).toHaveBeenCalledTimes(2);
      expect(row.executionCancellationRequested).toBe(false);
    } finally {
      service.onModuleDestroy();
      jest.useRealTimers();
    }
  });

  it('keeps resending after rejected projection and unavailable delivery', async () => {
    const { row, service, project, gateway, prisma } = setup();
    row.executionCancellationRequested = true;
    row.executionAdmissionId = admissionId;
    await expect(
      project({
        ...input('cancelled', 2),
        admissionId: 'bd985efd-4276-4b6e-8d7b-7c3f5d794dc0',
      }),
    ).rejects.toThrow();
    prisma.db.agentOperation.findUnique.mockResolvedValueOnce(null);
    await service.deliverCancellations();
    expect(gateway.emitConversationReduction).not.toHaveBeenCalled();
    row.executionTurnId = turnId;
    expect(await project(input('cancelled', 2))).toEqual({ accepted: false });
    await service.deliverCancellations();
    await service.deliverCancellations();
    expect(gateway.emitConversationReduction).toHaveBeenCalledTimes(2);
    expect(row.executionStatus).toBe('queued');
    expect(row.executionCancellationRequested).toBe(true);
  });

  it('does not report platform acceptance when the transaction fails to commit', async () => {
    const { row, service, project, prisma, tx } = setup();
    row.executionCancellationRequested = true;
    const debug = jest.spyOn(service['logger'], 'debug');
    prisma.db.$transaction.mockImplementationOnce(async (execute) => {
      await execute(tx);
      throw new Error('transaction commit failed');
    });
    try {
      await expect(project(input('cancelled', 2))).rejects.toThrow(
        'commit failed',
      );
      expect(debug).not.toHaveBeenCalledWith(
        'Input execution projected',
        expect.anything(),
      );
    } finally {
      debug.mockRestore();
    }
  });

  it.each(['lookup', 'sign', 'send'] as const)(
    'isolates a %s failure to its item and leaves durable pending work for retry',
    async (stage) => {
      const { row, service, gateway, signer, prisma } = setup();
      row.executionCancellationRequested = true;
      prisma.db.$queryRaw.mockResolvedValue([
        { id: testIds.parentMessage, executionOperationId: operationId },
        { id: row.id, executionOperationId: operationId },
      ]);
      if (stage === 'lookup')
        prisma.db.agentOperation.findUnique.mockRejectedValueOnce(
          new Error('lookup failed'),
        );
      if (stage === 'sign')
        signer.signConversationReduction.mockImplementationOnce(() => {
          throw new Error('sign failed');
        });
      if (stage === 'send')
        gateway.emitConversationReduction.mockImplementationOnce(() => {
          throw new Error('send failed');
        });
      const warning = jest.spyOn(service['logger'], 'warn');
      await service.deliverCancellations();
      expect(warning).toHaveBeenCalledWith(
        'Input cancellation item delivery deferred',
        expect.objectContaining({
          operationId,
          messageId: testIds.parentMessage,
          stage,
        }),
      );
      expect(JSON.stringify(warning.mock.calls)).not.toContain(
        'private-fingerprint',
      );
      warning.mockRestore();
      expect(gateway.emitConversationReduction).toHaveBeenCalledTimes(
        stage === 'send' ? 2 : 1,
      );
      expect(signer.signConversationReduction).toHaveBeenLastCalledWith(
        expect.objectContaining({ messageId: row.id }),
        machine.machineId,
        testIds.user,
      );
      expect(row.executionCancellationRequested).toBe(true);
      await service.deliverCancellations();
      expect(gateway.emitConversationReduction).toHaveBeenCalledTimes(
        stage === 'send' ? 4 : 3,
      );
    },
  );

  it('keeps cancellation pending until the owning machine confirms it', async () => {
    const { row, service, project } = setup();
    expect(
      await service.cancel(
        testIds.organization,
        testIds.project,
        testIds.user,
        operationId,
        { agentSessionId: sessionId, messageId: testIds.message },
      ),
    ).toEqual({ executionStatus: 'queued', cancellationRequested: true });
    expect(row.executionStatus).toBe('queued');
    expect(await project(input('cancelled', 2))).toEqual({ accepted: true });
    expect(row.executionStatus).toBe('cancelled');
    expect(row.executionCancellationRequested).toBe(false);
    expect(await project(input('queued', 1))).toEqual({ accepted: false });
  });
  it.each(['projection', 'cancellation'] as const)(
    'locks the text message ID with a bound text parameter for %s',
    async (action) => {
      const { service, project, tx } = setup();
      if (action === 'projection') {
        await project(input('started', 1));
      } else {
        await service.cancel(
          testIds.organization,
          testIds.project,
          testIds.user,
          operationId,
          { agentSessionId: sessionId, messageId: testIds.message },
        );
      }
      // Message.id is TEXT, unlike the UUID operation/admission columns.
      // Keep the parameter bound and the row locked across authorization/update.
      expect(tx.$executeRaw).toHaveBeenCalledWith(
        ['SELECT id FROM messages WHERE id = ', '::text FOR UPDATE'],
        testIds.message,
      );
      const lockOrder = tx.$executeRaw.mock.invocationCallOrder[0];
      const readOrder = tx.message.findUnique.mock.invocationCallOrder[0];
      if (lockOrder === undefined || readOrder === undefined) {
        throw new Error('Expected both the row lock and message read.');
      }
      expect(lockOrder).toBeLessThan(readOrder);
    },
  );
  it('retains started when pickup wins a pending cancellation', async () => {
    const { row, project } = setup();
    row.executionCancellationRequested = true;
    await project(input('started', 3));
    expect(row.executionStatus).toBe('started');
    expect(row.executionCancellationRequested).toBe(false);
    expect(await project(input('cancelled', 4))).toEqual({ accepted: false });
    expect(await project(input('queued', 8))).toEqual({ accepted: false });
  });
  it('joins duplicate terminal projection and publishes only once', async () => {
    const { project, messages } = setup();
    await project(input('started', 3));
    expect(await project(input('started', 3))).toEqual({ accepted: true });
    expect(messages.publishMessageUpdatedEvent).toHaveBeenCalledTimes(1);
  });
  it('rejects a different admission or execution identity', async () => {
    const { project } = setup();
    await project(input('started', 3));
    await expect(
      project({
        ...input('started', 4),
        admissionId: 'bd985efd-4276-4b6e-8d7b-7c3f5d794dc0',
      }),
    ).rejects.toThrow('identity changed');
    expect(
      await project({
        ...input('started', 4),
        turnId: '42a3bc81-9ff0-4321-8f11-82c7bc2fcb27',
      }),
    ).toEqual({ accepted: false });
  });
  it('requires exact machine, session, operation, and fingerprint ownership', async () => {
    const { project, tx } = setup();
    tx.agentOperation.findFirst.mockResolvedValue(null);
    await expect(project(input('started', 3))).rejects.toThrow('does not own');
    expect(tx.agentOperation.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        operationId,
        fingerprint: 'a'.repeat(64),
        agentSessionId: sessionId,
        userId: machine.userId,
        dispatch: { machineId: machine.machineId },
      }),
    });
  });
  it('rejects unsupported cancellation and missing execution identity', async () => {
    const { project } = setup();
    expect(await project(input('cancelled', 2))).toEqual({ accepted: false });
    await expect(
      project({ ...input('started', 2), turnId: undefined }),
    ).rejects.toThrow('requires');
  });
  it('does not replace a definitive failure with queued or started', async () => {
    const { project, row } = setup();
    await project(input('failed', 2));
    expect(await project(input('queued', 3))).toEqual({ accepted: false });
    expect(await project(input('started', 4))).toEqual({ accepted: false });
    expect(row.executionStatus).toBe('failed');
  });
  it('dates the input once, when its start is first accepted', async () => {
    const { row, project } = setup();
    expect(row.createdAt).toBeNull();
    await project(input('started', 3));
    const startedAt = row.createdAt;
    expect(startedAt).toBeInstanceOf(Date);
    expect(row.contentUpdatedAt).toEqual(startedAt);
    // A retried or later started revision never moves the timeline position.
    expect(await project(input('started', 3))).toEqual({ accepted: true });
    expect(await project(input('started', 5))).toEqual({ accepted: true });
    expect(row.createdAt).toBe(startedAt);
    expect(row.contentUpdatedAt).toBe(startedAt);
  });
  it.each(['cancelled', 'failed'] as const)(
    'leaves a %s input undated',
    async (status) => {
      const { row, project, service } = setup();
      if (status === 'cancelled') {
        await service.cancel(
          testIds.organization,
          testIds.project,
          testIds.user,
          operationId,
          { agentSessionId: sessionId, messageId: testIds.message },
        );
      }
      expect(await project(input(status, 2))).toEqual({ accepted: true });
      expect(row.createdAt).toBeNull();
      expect(row.contentUpdatedAt).toBeNull();
    },
  );
  it('reads the queue in send order through the message service', async () => {
    const { service, prisma, messages } = setup();
    (prisma.db as Record<string, unknown>).agentSession = {
      findFirst: jest.fn().mockResolvedValue({ id: sessionId }),
    };
    messages.getQueuedInputs.mockResolvedValue([{ id: 'first' }]);
    await expect(
      service.queued(
        testIds.organization,
        testIds.project,
        testIds.user,
        testIds.conversation,
      ),
    ).resolves.toEqual([{ id: 'first' }]);
    expect(messages.getQueuedInputs).toHaveBeenCalledWith(testIds.conversation);
  });
});
