import {
  AgentOperationAuthorizationKind,
  AgentOperationKind,
  AgentOperationState,
  type AgentOperation,
} from '@prisma/client';
import { AgentOperationRegistryService } from '../agent-operation-registry.service';
import type { PrismaService } from '../../../prisma/prisma.service';
import type {
  AgentSessionId,
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import {
  BoundedGrantReference,
  ControllerAssertionEvidence,
} from '../../../generated';

describe('AgentOperationRegistryService', () => {
  it.each([
    [
      ControllerAssertionEvidence.KindEnum.ControllerAssertion,
      AgentOperationAuthorizationKind.CONTROLLER_ASSERTION,
    ],
    [
      BoundedGrantReference.KindEnum.BoundedGrant,
      AgentOperationAuthorizationKind.BOUNDED_GRANT,
    ],
  ])(
    'records authorization and grant with admitted kind %s in one transaction',
    async (admittedKind, persistedKind) => {
      const updateMany = jest.fn().mockResolvedValue({ count: 1 });
      const service = new AgentOperationRegistryService({} as PrismaService);

      await service.recordAuthorizationInTransaction(
        { agentOperation: { updateMany } } as never,
        'operation-id',
        'execution-owner',
        'authorization-id',
        'grant-id',
        admittedKind,
      );

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          operationId: 'operation-id',
          executionOwner: 'execution-owner',
          state: AgentOperationState.SUBMITTING,
        },
        data: {
          authorizationId: 'authorization-id',
          authorizationKind: persistedKind,
          grantId: 'grant-id',
        },
      });
    },
  );

  it('persists terminal correlation in the dedicated replay columns', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest
      .fn()
      .mockResolvedValue({ operationId: 'operation' });
    const service = new AgentOperationRegistryService({
      db: { agentOperation: { updateMany, findUnique } },
    } as unknown as PrismaService);

    await service.succeed({
      operationId: '55555555-5555-4555-8555-555555555555',
      executionOwner: '77777777-7777-4777-8777-777777777777',
      messageId: 'message' as MessageId,
      triggerMessageId: 'trigger' as MessageId,
    });

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: 'message',
          triggerMessageId: 'trigger',
        }),
      }),
    );
  });

  it('terminalizes an abandoned lease instead of admitting duplicate work', async () => {
    const expiredOperation = {
      operationId: '55555555-5555-4555-8555-555555555555',
      organizationId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      agentSessionId: '44444444-4444-4444-8444-444444444444',
      conversationId: '66666666-6666-4666-8666-666666666666',
      kind: AgentOperationKind.START_RUN,
      fingerprint: 'a'.repeat(64),
      state: AgentOperationState.SUBMITTING,
      authorizationId: null,
      authorizationKind: null,
      grantId: null,
      messageId: null,
      triggerMessageId: null,
      result: {
        reservedMessageId: 'message',
        reservedTriggerMessageId: 'trigger',
      },
      failureCode: null,
      failureMessage: null,
      executionOwner: '77777777-7777-4777-8777-777777777777',
      executionLeaseExpiresAt: new Date(0),
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      terminalAt: null,
    } satisfies AgentOperation;
    const terminalOperation = {
      ...expiredOperation,
      state: AgentOperationState.FAILED,
      failureCode: 'AGENT_OPERATION_EXECUTION_OUTCOME_UNKNOWN',
      failureMessage:
        'The original executor did not record a terminal outcome before its lease expired.',
      executionOwner: null,
      executionLeaseExpiresAt: null,
      version: 2,
      terminalAt: new Date(),
    } satisfies AgentOperation;
    const update = jest.fn().mockResolvedValue(terminalOperation);
    const attemptUpdate = jest.fn().mockResolvedValue({ count: 1 });
    const requestUpdate = jest.fn();
    const service = new AgentOperationRegistryService({
      db: {
        $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            $executeRaw: jest.fn(),
            $queryRaw: jest.fn(),
            agentSession: {
              findFirst: jest.fn().mockResolvedValue({ id: 'session' }),
            },
            agentOperation: {
              findUnique: jest.fn().mockResolvedValue(expiredOperation),
              update,
            },
            projectReportAttempt: {
              findUnique: jest
                .fn()
                .mockResolvedValue({ id: 'attempt', requestId: 'request' }),
              findFirst: jest.fn().mockResolvedValue({ id: 'attempt' }),
              updateMany: attemptUpdate,
            },
            projectReportRequest: { update: requestUpdate },
          }),
      },
    } as unknown as PrismaService);

    const result = await service.begin({
      operationId: expiredOperation.operationId,
      organizationId: expiredOperation.organizationId as OrganizationId,
      projectId: expiredOperation.projectId as ProjectId,
      userId: expiredOperation.userId as UserId,
      agentSessionId: expiredOperation.agentSessionId as AgentSessionId,
      conversationId: expiredOperation.conversationId as ConversationId,
      kind: expiredOperation.kind,
      fingerprint: expiredOperation.fingerprint,
    });

    expect(result.disposition).toBe('RETURN');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationState.FAILED,
          failureCode: 'AGENT_OPERATION_EXECUTION_OUTCOME_UNKNOWN',
          executionOwner: null,
        }),
      }),
    );
    // A project report attempt bound to the abandoned START_RUN fails with it.
    expect(attemptUpdate).toHaveBeenCalledWith({
      where: {
        id: 'attempt',
        requestId: 'request',
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      data: expect.objectContaining({
        status: 'FAILED',
        failure: expect.objectContaining({
          stage: 'LAUNCH',
          code: 'START_RUN_FAILED',
          retryable: true,
        }),
      }),
    });
    expect(requestUpdate).toHaveBeenCalledWith({
      where: { id: 'request' },
      data: { status: 'FAILED' },
    });
  });

  it('re-admits a reconciling operation without replacing its reserved identities', async () => {
    const reconcilingOperation = {
      operationId: '55555555-5555-4555-8555-555555555555',
      organizationId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      agentSessionId: '44444444-4444-4444-8444-444444444444',
      conversationId: '66666666-6666-4666-8666-666666666666',
      kind: AgentOperationKind.START_RUN,
      fingerprint: 'a'.repeat(64),
      state: AgentOperationState.RECONCILING,
      authorizationId: null,
      authorizationKind: null,
      grantId: null,
      messageId: null,
      triggerMessageId: null,
      result: {
        reservedMessageId: 'message',
        reservedTriggerMessageId: 'trigger',
      },
      failureCode: null,
      failureMessage: null,
      executionOwner: null,
      executionLeaseExpiresAt: null,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      terminalAt: null,
    } satisfies AgentOperation;
    const update = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        ...reconcilingOperation,
        ...data,
        state: AgentOperationState.SUBMITTING,
      }),
    );
    const service = new AgentOperationRegistryService({
      db: {
        $transaction: (callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            $executeRaw: jest.fn(),
            agentSession: {
              findFirst: jest.fn().mockResolvedValue({ id: 'session' }),
            },
            agentOperation: {
              findUnique: jest.fn().mockResolvedValue(reconcilingOperation),
              update,
            },
          }),
      },
    } as unknown as PrismaService);

    const result = await service.begin({
      operationId: reconcilingOperation.operationId,
      organizationId: reconcilingOperation.organizationId as OrganizationId,
      projectId: reconcilingOperation.projectId as ProjectId,
      userId: reconcilingOperation.userId as UserId,
      agentSessionId: reconcilingOperation.agentSessionId as AgentSessionId,
      conversationId: reconcilingOperation.conversationId as ConversationId,
      kind: reconcilingOperation.kind,
      fingerprint: reconcilingOperation.fingerprint,
    });

    expect(result.disposition).toBe('EXECUTE');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationState.SUBMITTING,
          executionOwner: expect.any(String),
        }),
      }),
    );
    expect(result.operation.result).toEqual(reconcilingOperation.result);
  });

  it('projects the recorded terminal correlation without restarting work', () => {
    const service = new AgentOperationRegistryService({} as PrismaService);
    const operation = {
      operationId: '55555555-5555-4555-8555-555555555555',
      organizationId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      userId: '33333333-3333-4333-8333-333333333333',
      agentSessionId: '44444444-4444-4444-8444-444444444444',
      conversationId: '66666666-6666-4666-8666-666666666666',
      kind: AgentOperationKind.START_RUN,
      fingerprint: 'a'.repeat(64),
      state: AgentOperationState.SUCCEEDED,
      authorizationId: null,
      authorizationKind: null,
      grantId: null,
      messageId: null,
      triggerMessageId: null,
      result: { messageId: 'message', triggerMessageId: 'trigger' },
      failureCode: null,
      failureMessage: null,
      executionOwner: null,
      executionLeaseExpiresAt: null,
      version: 2,
      createdAt: new Date(),
      updatedAt: new Date(),
      terminalAt: new Date(),
    } satisfies AgentOperation;
    expect(service.toSnapshot(operation)).toMatchObject({
      state: 'SUCCEEDED',
      messageId: 'message',
      triggerMessageId: 'trigger',
    });
  });
});
