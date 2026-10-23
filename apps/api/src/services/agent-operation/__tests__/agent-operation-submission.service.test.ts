import {
  AgentOperationAuthorizationKind,
  AgentOperationKind,
  AgentOperationState,
  type AgentOperation,
} from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import type { AgentOperationDispatchService } from '../../../core/websockets/agent-operation-dispatch.service';
import type { CreateMessageInput, MessageService } from '../../message.service';
import type {
  ExecutionGrantService,
  InteractiveGrantAdmission,
} from '../../controller-authorization/execution-grant.service';
import type { AgentOperationRegistryService } from '../agent-operation-registry.service';
import type {
  AgentSessionId,
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../../types';
import { AgentOperationSubmissionService } from '../agent-operation-submission.service';

describe('AgentOperationSubmissionService', () => {
  it.each([
    [
      'foreign project',
      [{ id: 'service-a', projectId: 'other-project' }],
      ['service-a'],
    ],
    ['missing binding', [{ id: 'service-a', projectId: 'project-id' }], []],
  ])(
    'rejects %s before starting the submission transaction',
    async (_case, services, boundIds) => {
      const transaction = jest.fn();
      const submission = new AgentOperationSubmissionService(
        {
          db: {
            agentOperation: { findUnique: jest.fn().mockResolvedValue(null) },
            agentSession: {
              findFirst: jest
                .fn()
                .mockResolvedValue({ serviceId: null, serviceRelations: [] }),
            },
            service: { findMany: jest.fn().mockResolvedValue(services) },
            $transaction: transaction,
          },
        } as unknown as PrismaService,
        {} as AgentOperationRegistryService,
        {} as MessageService,
        {} as ExecutionGrantService,
        {} as AgentOperationDispatchService,
        {} as never,
        {
          getBindings: jest.fn().mockResolvedValue({
            organizationId: 'organization-id',
            bindings: boundIds.map((serviceId) => ({ serviceId })),
          }),
        } as never,
      );

      await expect(
        submission.submit({
          operationId: 'operation-id',
          operationFingerprint: 'f'.repeat(64),
          organizationId: 'organization-id' as OrganizationId,
          projectId: 'project-id' as ProjectId,
          userId: 'user-id' as UserId,
          agentSessionId: 'session-id' as AgentSessionId,
          conversationId: 'conversation-id' as ConversationId,
          kind: AgentOperationKind.DIRECT_TRIGGER,
          admission: { machineId: 'machine-id' } as InteractiveGrantAdmission,
          triggerMessage: {
            data: {
              triggersAgent: {
                promptType: 'user_message',
                payload: { userMessage: 'Inspect @[service:service-a|A].' },
              },
            },
          } as CreateMessageInput,
        }),
      ).rejects.toThrow();
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it('persists the canonical kickoff, delivery obligation, and caller writes in the submission transaction', async () => {
    const eventOrder: string[] = [];
    const operation = {
      operationId: 'operation-id',
      authorizationKind: null,
      organizationId: 'organization-id',
      projectId: 'project-id',
      userId: 'user-id',
      agentSessionId: 'session-id',
      conversationId: 'conversation-id',
      kind: AgentOperationKind.START_RUN,
      fingerprint: 'f'.repeat(64),
      state: AgentOperationState.SUBMITTING,
      authorizationId: null,
      grantId: null,
      messageId: null,
      triggerMessageId: null,
      result: {
        reservedMessageId: 'message-id',
        reservedTriggerMessageId: 'trigger-message-id',
      },
      failureCode: null,
      failureMessage: null,
      executionOwner: 'execution-owner',
      executionLeaseExpiresAt: new Date(),
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      terminalAt: null,
    } satisfies AgentOperation;
    const persistedOperation = {
      ...operation,
      state: AgentOperationState.DISPATCH_PENDING,
      authorizationId: 'authorization-id',
      authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
      grantId: 'grant-id',
      triggerMessageId: 'trigger-message-id',
    } satisfies AgentOperation;
    const tx = {
      message: { update: jest.fn() },
      $executeRaw: jest.fn(),
      agentSession: {
        updateMany: jest.fn(async () => {
          eventOrder.push('binding');
          return { count: 1 };
        }),
      },
      agentOperation: {
        findUnique: jest.fn().mockResolvedValue(operation),
        update: jest.fn().mockResolvedValue(persistedOperation),
      },
      agentOperationDispatch: {
        create: jest.fn(),
      },
      agentOperationWorkflowInputDelivery: {
        create: jest.fn(),
      },
    };
    const messageService = {
      addMessageInTransaction: jest.fn(
        async (
          ...args: [never, CreateMessageInput, string, string, object?]
        ) => {
          eventOrder.push(`message:${args[1].id}`);
          return {} as never;
        },
      ),
    };
    const executionGrantService = {
      deriveInteractiveGrantInTransaction: jest.fn(async () => {
        eventOrder.push('grant');
        return {
          grant: { id: 'grant-id', machineId: 'machine-id' },
          envelopeAuthorization: {},
        } as never;
      }),
    };
    const registry = {
      reservedMessageIds: jest.fn().mockReturnValue({
        messageId: 'message-id',
        triggerMessageId: 'trigger-message-id',
      }),
      recordAuthorizationInTransaction: jest.fn(async () => {
        eventOrder.push('authorization');
      }),
      toSnapshot: jest.fn().mockReturnValue({
        state: AgentOperationState.DISPATCH_PENDING,
      }),
    };
    const dispatchService = {
      nudgeForOperation: jest.fn(() => {
        eventOrder.push('wake:operation-id');
        return Promise.resolve();
      }),
    };
    const recordWake = jest.fn();
    const organizationId = 'organization-id' as OrganizationId;
    const projectId = 'project-id' as ProjectId;
    const userId = 'user-id' as UserId;
    const agentSessionId = 'session-id' as AgentSessionId;
    const conversationId = 'conversation-id' as ConversationId;
    const prisma = {
      db: {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => Promise<unknown>) => {
            const result = await callback(tx);
            eventOrder.push('transaction:resolved');
            return result;
          },
        ),
      },
    };
    const service = new AgentOperationSubmissionService(
      prisma as unknown as PrismaService,
      registry as unknown as AgentOperationRegistryService,
      messageService as unknown as MessageService,
      executionGrantService as unknown as ExecutionGrantService,
      dispatchService as unknown as AgentOperationDispatchService,
      { recordWake } as never,
      {} as never,
    );
    const input = {
      operationId: 'operation-id',
      operationFingerprint: 'f'.repeat(64),
      organizationId,
      projectId,
      userId,
      agentSessionId,
      conversationId,
      kind: AgentOperationKind.START_RUN,
      admission: {
        authorizationId: 'authorization-id',
        requestId: 'request-id',
        controllerInstallationId: 'controller-installation-id',
        machineId: 'machine-id' as never,
        agentSessionId,
        action: {} as never,
        envelopeAuthorization: {
          kind: 'bounded_grant',
          grantId: 'grant-id',
        },
        existingGrantId: 'grant-id',
      } as unknown as InteractiveGrantAdmission,
      triggerMessage: {
        type: 'SYSTEM',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        data: {
          triggersAgent: {
            promptType: 'start_run',
            // Payload-free workflow launch: classified by workflowName alone.
            payload: { workflowName: 'plan-from-design-doc' },
          },
        },
      } as CreateMessageInput,
      userMessage: {
        type: 'USER',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        userId: 'user-id',
        data: { comment: 'Plan this change.' },
      } as CreateMessageInput,
      workflowKickoffDelivery: {
        workflowId: 'workflow-id',
        workflowName: 'plan-from-design-doc',
      },
      executionOwner: 'execution-owner',
      onSubmittedInTx: jest.fn(async (client: unknown) => {
        expect(client).toBe(tx);
        eventOrder.push('caller-write');
      }),
    };

    await service.submitPrepared(input);

    expect(eventOrder).toEqual([
      'message:message-id',
      'message:trigger-message-id',
      'grant',
      'binding',
      'authorization',
      'caller-write',
      'transaction:resolved',
      'wake:operation-id',
    ]);
    expect(
      executionGrantService.deriveInteractiveGrantInTransaction,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ authorizedTurnId: 'trigger-message-id' }),
    );
    expect(messageService.addMessageInTransaction).toHaveBeenNthCalledWith(
      1,
      tx,
      expect.objectContaining({ id: 'message-id', type: 'USER' }),
      organizationId,
      'agentOperationSubmission:userMessage',
      // A workflow kickoff is not an executable input, so it is written dated.
      {},
    );
    expect(tx.agentSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: agentSessionId,
        conversationId,
        organizationId,
        projectId,
        userId,
        OR: [{ machineId: 'machine-id' }, { machineId: null }],
      },
      data: { machineId: 'machine-id' },
    });
    expect(tx.agentOperationDispatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        authorizationId: 'authorization-id',
        authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
        grantId: 'grant-id',
        machineId: 'machine-id',
        triggerMessageId: 'trigger-message-id',
      }),
    });
    expect(tx.agentOperationWorkflowInputDelivery.create).toHaveBeenCalledWith({
      data: {
        operationId: 'operation-id',
        kind: 'START_RUN_KICKOFF',
        workflowId: 'workflow-id',
        workflowName: 'plan-from-design-doc',
      },
    });
    expect(dispatchService.nudgeForOperation).toHaveBeenCalledWith(
      'operation-id',
    );
    await Promise.resolve();
    expect(recordWake).toHaveBeenCalledWith('submission', 'no_eligible_work');
    tx.agentSession.updateMany.mockResolvedValueOnce({ count: 0 });
    tx.agentOperationDispatch.create.mockClear();
    dispatchService.nudgeForOperation.mockClear();
    input.onSubmittedInTx.mockClear();
    await expect(service.submitPrepared(input)).rejects.toThrow(
      'The Agent Session cannot be bound to the admitted machine.',
    );
    expect(input.onSubmittedInTx).not.toHaveBeenCalled();
    expect(tx.agentOperationDispatch.create).not.toHaveBeenCalled();
    expect(dispatchService.nudgeForOperation).not.toHaveBeenCalled();
  });

  it.each([
    [
      'follow-up USER message',
      {
        promptType: 'user_message',
        sourceUserMessageId: 'message-id',
        payload: {
          handlerPromptType: 'implement',
          userMessage:
            'Inspect @[service:service-a|A] and @[service:service-b|B].',
        },
      },
    ],
    [
      'session-starting',
      {
        promptType: 'start_run',
        sourceUserMessageId: 'message-id',
        payload: {
          attachments: [],
          handlerPromptType: 'entity_conversation',
          payload: {
            promptType: 'entity_conversation',
            userMessage:
              'Inspect @[service:service-a|A] and @[service:service-b|B].',
          },
        },
      },
    ],
  ])(
    'commits admitted Service links before persisting or dispatching the %s trigger',
    async (_label, trigger) => {
      const eventOrder: string[] = [];
      const operation = {
        operationId: 'direct-operation-id',
        authorizationKind: null,
        organizationId: 'organization-id',
        projectId: 'project-id',
        userId: 'user-id',
        agentSessionId: 'session-id',
        conversationId: 'conversation-id',
        kind: AgentOperationKind.DIRECT_TRIGGER,
        fingerprint: 'f'.repeat(64),
        state: AgentOperationState.SUBMITTING,
        authorizationId: null,
        grantId: null,
        messageId: null,
        triggerMessageId: null,
        result: {
          reservedMessageId: 'message-id',
          reservedTriggerMessageId: 'trigger-message-id',
        },
        failureCode: null,
        failureMessage: null,
        executionOwner: 'execution-owner',
        executionLeaseExpiresAt: new Date(),
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        terminalAt: null,
      } satisfies AgentOperation;
      const tx = {
        message: { update: jest.fn() },
        $executeRaw: jest.fn(),
        agentOperation: {
          findUnique: jest.fn().mockResolvedValue(operation),
          update: jest.fn().mockResolvedValue({
            ...operation,
            state: AgentOperationState.DISPATCH_PENDING,
            authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
          }),
        },
        agentSession: {
          findUnique: jest.fn().mockResolvedValue({
            serviceId: null,
            serviceRelations: [],
          }),
          update: jest.fn(async () => {
            eventOrder.push('anchor');
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        serviceAgentSession: {
          createMany: jest.fn(async () => {
            eventOrder.push('links');
          }),
        },
        agentOperationDispatch: {
          create: jest.fn(async () => {
            eventOrder.push('dispatch');
          }),
        },
        agentOperationWorkflowInputDelivery: { create: jest.fn() },
      };
      const messageService = {
        addMessageInTransaction: jest.fn(
          async (_tx, message: CreateMessageInput) => {
            eventOrder.push(`message:${message.id}`);
          },
        ),
      };
      const registry = {
        reservedMessageIds: jest.fn().mockReturnValue({
          messageId: 'message-id',
          triggerMessageId: 'trigger-message-id',
        }),
        recordAuthorizationInTransaction: jest.fn(),
        toSnapshot: jest
          .fn()
          .mockReturnValue({ state: AgentOperationState.DISPATCH_PENDING }),
      };
      const service = new AgentOperationSubmissionService(
        {
          db: {
            agentOperation: { findUnique: jest.fn().mockResolvedValue(null) },
            agentSession: {
              findFirst: jest.fn().mockResolvedValue({
                serviceId: null,
                serviceRelations: [],
              }),
            },
            service: {
              findMany: jest.fn().mockResolvedValue([
                { id: 'service-a', projectId: 'project-id' },
                { id: 'service-b', projectId: 'project-id' },
              ]),
            },
            $transaction: jest.fn(
              async (callback: (client: typeof tx) => Promise<unknown>) =>
                callback(tx),
            ),
          },
        } as unknown as PrismaService,
        registry as unknown as AgentOperationRegistryService,
        messageService as unknown as MessageService,
        {
          deriveInteractiveGrantInTransaction: jest.fn().mockResolvedValue({
            grant: { id: 'grant-id', machineId: 'machine-id' },
            envelopeAuthorization: {},
          }),
        } as unknown as ExecutionGrantService,
        {
          nudgeForOperation: jest.fn().mockResolvedValue(false),
        } as unknown as AgentOperationDispatchService,
        { recordWake: jest.fn() } as never,
        {
          getBindings: jest.fn().mockResolvedValue({
            organizationId: 'organization-id',
            bindings: [{ serviceId: 'service-a' }, { serviceId: 'service-b' }],
          }),
        } as never,
      );

      const input = {
        operationId: operation.operationId,
        operationFingerprint: operation.fingerprint,
        organizationId: operation.organizationId as OrganizationId,
        projectId: operation.projectId as ProjectId,
        userId: operation.userId as UserId,
        agentSessionId: operation.agentSessionId as AgentSessionId,
        conversationId: operation.conversationId as ConversationId,
        kind: AgentOperationKind.DIRECT_TRIGGER,
        admission: {
          authorizationId: 'authorization-id',
          machineId: 'machine-id',
          envelopeAuthorization: { kind: 'bounded_grant' },
        } as InteractiveGrantAdmission,
        userMessage: {
          id: 'message-id',
          type: 'USER',
          projectId: operation.projectId,
          conversationId: operation.conversationId,
          userId: operation.userId,
          data: { comment: 'Inspect the Service.' },
        } as CreateMessageInput,
        triggerMessage: {
          id: 'trigger-message-id',
          type: 'SYSTEM',
          projectId: operation.projectId,
          conversationId: operation.conversationId,
          data: {
            type: 'AGENT',
            triggersAgent: {
              ...trigger,
              operationId: operation.operationId,
              operationFingerprint: operation.fingerprint,
              triggerMessageId: 'trigger-message-id',
            },
          },
        } as CreateMessageInput,
        executionOwner: 'execution-owner',
      };
      await service.submitPrepared(input);

      expect(eventOrder).toEqual([
        'anchor',
        'links',
        'message:message-id',
        'message:trigger-message-id',
        'dispatch',
      ]);
      expect(messageService.addMessageInTransaction).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        expect.objectContaining({
          data: expect.objectContaining({
            triggersAgent: expect.objectContaining({
              admittedServiceScope: {
                serviceIds: ['service-a', 'service-b'],
                launchServiceId: 'service-a',
              },
            }),
          }),
        }),
        expect.anything(),
        'agentOperationSubmission:triggerMessage',
        {},
      );
      // The executable USER message is inserted queued and undated in one write.
      expect(messageService.addMessageInTransaction).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({ id: 'message-id', type: 'USER' }),
        expect.anything(),
        'agentOperationSubmission:userMessage',
        { executableOperationId: operation.operationId },
      );
      tx.agentSession.findUnique.mockResolvedValueOnce({
        serviceId: null,
        serviceRelations: [{ serviceId: 'concurrent-service' }],
      });
      eventOrder.length = 0;
      await expect(service.submitPrepared(input)).rejects.toThrow(
        'The Agent Session Service scope changed during admission',
      );
      expect(eventOrder).toEqual([]);
    },
  );

  it('targets a joined operation only after the submission transaction resolves', async () => {
    const eventOrder: string[] = [];
    const operation = {
      operationId: 'joined-operation-id',
      state: AgentOperationState.DISPATCH_PENDING,
    } as AgentOperation;
    const tx = {};
    const prisma = {
      db: {
        agentOperation: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ state: AgentOperationState.DISPATCH_PENDING }),
        },
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => Promise<unknown>) => {
            const result = await callback(tx);
            eventOrder.push('transaction:resolved');
            return result;
          },
        ),
      },
    };
    const registry = {
      beginInTransaction: jest.fn().mockResolvedValue({
        disposition: 'JOIN',
        operation,
      }),
      toSnapshot: jest.fn().mockReturnValue({
        operationId: 'joined-operation-id',
        state: AgentOperationState.DISPATCH_PENDING,
      }),
    };
    let finishAttempt!: () => void;
    const dispatchService = {
      nudgeForOperation: jest.fn(() => {
        eventOrder.push('wake:joined-operation-id');
        return new Promise<boolean>((resolve) => {
          finishAttempt = () => {
            eventOrder.push('attempt:finished');
            resolve(true);
          };
        });
      }),
    };
    const service = new AgentOperationSubmissionService(
      prisma as unknown as PrismaService,
      registry as unknown as AgentOperationRegistryService,
      {} as MessageService,
      {} as ExecutionGrantService,
      dispatchService as unknown as AgentOperationDispatchService,
      { recordWake: jest.fn() } as never,
      {} as never,
    );

    const submitted = service.submit({
      operationId: 'joined-operation-id',
      operationFingerprint: 'f'.repeat(64),
      organizationId: 'organization-id' as OrganizationId,
      projectId: 'project-id' as ProjectId,
      userId: 'user-id' as UserId,
      agentSessionId: 'session-id' as AgentSessionId,
      conversationId: 'conversation-id' as ConversationId,
      kind: AgentOperationKind.DIRECT_TRIGGER,
      admission: {} as InteractiveGrantAdmission,
      triggerMessage: {
        data: {
          triggersAgent: {
            promptType: 'user_message',
            payload: { userMessage: 'Inspect @[service:service-a|A].' },
          },
        },
      } as CreateMessageInput,
    });
    await new Promise((resolve) => setImmediate(resolve));
    let returned = false;
    void submitted.then(() => {
      returned = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    // A follow-up returns only after its bounded delivery attempt, so the response can carry
    // the CLI's recorded disposition.
    expect(returned).toBe(false);
    finishAttempt();
    await submitted;

    expect(eventOrder).toEqual([
      'transaction:resolved',
      'wake:joined-operation-id',
      'attempt:finished',
    ]);
    expect(dispatchService.nudgeForOperation).toHaveBeenCalledWith(
      'joined-operation-id',
    );
  });
});
