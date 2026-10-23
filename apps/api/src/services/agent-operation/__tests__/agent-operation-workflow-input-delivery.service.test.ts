import {
  AgentOperationKind,
  AgentOperationState,
  AgentOperationWorkflowInputKind,
  AgentOperationWorkflowInputState,
} from '@prisma/client';
import { Client } from '@temporalio/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { MessageService } from '../../message.service';
import { ConversationWorkflowService } from '../../workflows/conversation-workflow.service';
import { FlowExecutionService } from '../../workflows/flow-execution.service';
import { AgentOperationWorkflowAnswerService } from '../agent-operation-workflow-answer.service';
import { AgentOperationWorkflowInputDeliveryService } from '../agent-operation-workflow-input-delivery.service';

describe('AgentOperationWorkflowInputDeliveryService', () => {
  it('keeps START_RUN kickoff delivery ineligible before CLI acknowledgement', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      db: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        agentOperationWorkflowInputDelivery: { findFirst },
      },
    } as unknown as PrismaService;
    const service = new AgentOperationWorkflowInputDeliveryService(
      prisma,
      {} as MessageService,
      {} as AgentOperationWorkflowAnswerService,
      {} as FlowExecutionService,
      {} as ConversationWorkflowService,
      {} as Client,
    );

    await service.deliverOne();

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                expect.objectContaining({
                  kind: AgentOperationWorkflowInputKind.START_RUN_KICKOFF,
                  operation: {
                    kind: AgentOperationKind.START_RUN,
                    state: AgentOperationState.SUCCEEDED,
                  },
                }),
              ]),
            }),
          ]),
        }),
      }),
    );
  });

  it('delivers an acknowledged empty CONTROL kickoff directly and completes only after correlation confirmation', async () => {
    const delivery = {
      operationId: 'operation-1',
      kind: AgentOperationWorkflowInputKind.START_RUN_KICKOFF,
      workflowId: 'workflow-1',
      workflowName: 'plan-from-design-doc',
      nodeId: null,
      action: null,
      answer: null,
      state: AgentOperationWorkflowInputState.CLAIMED,
      attemptCount: 1,
      claimOwner: 'worker-1',
      claimExpiresAt: new Date(),
      nextAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      deliveredAt: null,
      lastFailureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      operation: {
        operationId: 'operation-1',
        kind: AgentOperationKind.START_RUN,
        state: AgentOperationState.SUCCEEDED,
        messageId: 'message-1',
        organizationId: 'organization-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      db: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        agentOperationWorkflowInputDelivery: {
          findFirst: jest.fn().mockResolvedValue(delivery),
          updateMany,
          findUnique: jest.fn().mockResolvedValue(delivery),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'NOT_STARTED',
            workflowId: 'workflow-1',
          }),
        },
      },
    } as unknown as PrismaService;
    const message = {
      id: 'message-1',
      type: 'USER',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      userId: 'user-1',
      status: 'completed',
      data: { type: 'CONTROL', comment: ' ' },
      createdAt: '2026-08-22T00:00:00.000Z',
    };
    const messageService = {
      getMessage: jest.fn().mockResolvedValue(message),
    } as unknown as MessageService;
    const handle = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ userMessageSignalReady: true })
        .mockResolvedValueOnce(true),
      signal: jest.fn().mockResolvedValue(undefined),
    };
    const temporal = {
      workflow: { getHandle: jest.fn().mockReturnValue(handle) },
    } as unknown as Client;
    const markDelivered = jest.fn();
    const startConversationWorkflow = jest.fn().mockResolvedValue({
      workflowId: 'workflow-1',
    });
    const service = new AgentOperationWorkflowInputDeliveryService(
      prisma,
      messageService,
      { markDelivered } as unknown as AgentOperationWorkflowAnswerService,
      {} as FlowExecutionService,
      { startConversationWorkflow } as unknown as ConversationWorkflowService,
      temporal,
    );

    await service.deliverOne();

    expect(handle.signal).toHaveBeenCalledWith(
      'startRunKickoff-workflow-1',
      expect.objectContaining({
        operationId: 'operation-1',
        message: expect.objectContaining({
          id: 'message-1',
          data: { type: 'CONTROL', comment: ' ' },
        }),
      }),
    );
    expect(startConversationWorkflow).toHaveBeenCalledWith(
      'conversation-1',
      'organization-1',
      'user-1',
      { startRunKickoffRequired: true },
    );
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationWorkflowInputState.DELIVERED,
        }),
      }),
    );
    expect(markDelivered).not.toHaveBeenCalled();
    // A kickoff stranded queued/undated by the old classification is dated in
    // place under the same operation before delivery.
    expect(
      (prisma.db.message.updateMany as jest.Mock).mock.calls[0][0],
    ).toEqual({
      where: {
        id: 'message-1',
        type: 'USER',
        createdAt: null,
        executionOperationId: 'operation-1',
        executionStatus: 'queued',
      },
      data: expect.objectContaining({
        createdAt: expect.any(Date),
        executionStatus: null,
        executionOperationId: null,
      }),
    });
  });

  it('resends after an ambiguous signal result and relies on Temporal correlation deduplication', async () => {
    const delivery = {
      operationId: 'operation-1',
      kind: AgentOperationWorkflowInputKind.START_RUN_KICKOFF,
      workflowId: 'workflow-1',
      workflowName: 'plan-from-design-doc',
      nodeId: null,
      action: null,
      answer: null,
      state: AgentOperationWorkflowInputState.CLAIMED,
      attemptCount: 1,
      claimOwner: 'worker-1',
      claimExpiresAt: new Date(),
      nextAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      deliveredAt: null,
      lastFailureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      operation: {
        operationId: 'operation-1',
        kind: AgentOperationKind.START_RUN,
        state: AgentOperationState.SUCCEEDED,
        messageId: 'message-1',
        organizationId: 'organization-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      db: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        agentOperationWorkflowInputDelivery: {
          findFirst: jest.fn().mockResolvedValue(delivery),
          updateMany,
          findUnique: jest.fn().mockResolvedValue(delivery),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            status: 'STARTED',
            workflowId: 'workflow-1',
          }),
        },
      },
    } as unknown as PrismaService;
    const messageService = {
      getMessage: jest.fn().mockResolvedValue({
        id: 'message-1',
        type: 'USER',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        status: 'completed',
        data: { comment: 'Plan this.' },
        createdAt: '2026-08-22T00:00:00.000Z',
      }),
    } as unknown as MessageService;
    const handle = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ userMessageSignalReady: true })
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce({ userMessageSignalReady: true })
        .mockResolvedValueOnce(true),
      signal: jest.fn().mockResolvedValue(undefined),
    };
    const temporal = {
      workflow: { getHandle: jest.fn().mockReturnValue(handle) },
    } as unknown as Client;
    const service = new AgentOperationWorkflowInputDeliveryService(
      prisma,
      messageService,
      {} as AgentOperationWorkflowAnswerService,
      {} as FlowExecutionService,
      {} as ConversationWorkflowService,
      temporal,
    );

    await service.deliverOne();
    await service.deliverOne();

    expect(handle.signal).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationWorkflowInputState.PENDING,
          lastFailureCode: 'START_RUN_KICKOFF_NOT_HANDLED',
        }),
      }),
    );
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          state: AgentOperationWorkflowInputState.DELIVERED,
        }),
      }),
    );
  });

  it('marks an answer delivered only after the workflow confirms its operation identity', async () => {
    const delivery = {
      operationId: 'operation-1',
      workflowId: 'workflow-1',
      workflowName: 'feature-sync',
      nodeId: 'review-step',
      action: 'APPROVED',
      answer: {},
      state: AgentOperationWorkflowInputState.CLAIMED,
      attemptCount: 1,
      claimOwner: 'worker-1',
      claimExpiresAt: new Date(),
      nextAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      deliveredAt: null,
      lastFailureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      operation: {
        messageId: 'message-1',
        organizationId: 'organization-1',
      },
    };
    const findFirst = jest.fn().mockResolvedValue(delivery);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findUnique = jest.fn().mockResolvedValue(delivery);
    const prisma = {
      db: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        agentOperationWorkflowInputDelivery: {
          findFirst,
          updateMany,
          findUnique,
        },
      },
    } as unknown as PrismaService;
    const messageService = {
      getMessage: jest.fn().mockResolvedValue({
        id: 'message-1',
        type: 'USER',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        status: 'completed',
        data: { action: 'APPROVED' },
        createdAt: '2026-08-22T00:00:00.000Z',
      }),
    } as unknown as MessageService;
    const handle = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ currentNodeId: 'review-step' })
        .mockResolvedValueOnce(true),
      signal: jest.fn().mockResolvedValue(undefined),
    };
    const temporal = {
      workflow: { getHandle: jest.fn().mockReturnValue(handle) },
    } as unknown as Client;
    const markDelivered = jest.fn().mockResolvedValue(undefined);
    const workflowAnswer = {
      markDelivered,
    } as unknown as AgentOperationWorkflowAnswerService;
    const flowExecution = {} as FlowExecutionService;
    const conversationWorkflow = {} as ConversationWorkflowService;
    const service = new AgentOperationWorkflowInputDeliveryService(
      prisma,
      messageService,
      workflowAnswer,
      flowExecution,
      conversationWorkflow,
      temporal,
    );

    await service.deliverOne();

    expect(handle.signal).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith('operation-1');
  });

  it('normalizes a persisted field-keyed workflow answer before signaling Temporal', async () => {
    const delivery = {
      operationId: 'operation-1',
      workflowId: 'workflow-1',
      workflowName: 'feature-sync',
      nodeId: 'review-step',
      action: 'REFINE',
      answer: {},
      state: AgentOperationWorkflowInputState.CLAIMED,
      attemptCount: 1,
      claimOwner: 'worker-1',
      claimExpiresAt: new Date(),
      nextAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      deliveredAt: null,
      lastFailureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      operation: {
        messageId: 'message-1',
        organizationId: 'organization-1',
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      db: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        agentOperationWorkflowInputDelivery: {
          findFirst: jest.fn().mockResolvedValue(delivery),
          updateMany,
          findUnique: jest.fn().mockResolvedValue(delivery),
        },
      },
    } as unknown as PrismaService;
    const messageService = {
      getMessage: jest.fn().mockResolvedValue({
        id: 'message-1',
        type: 'USER',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        status: 'completed',
        data: {
          action: 'REFINE',
          payload: {
            reviewField: {
              action: 'REFINE',
              payload: { feedback: '2' },
            },
          },
        },
        createdAt: '2026-08-26T23:04:00.000Z',
      }),
    } as unknown as MessageService;
    const handle = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ currentNodeId: 'review-step' })
        .mockResolvedValueOnce(true),
      signal: jest.fn().mockResolvedValue(undefined),
    };
    const temporal = {
      workflow: { getHandle: jest.fn().mockReturnValue(handle) },
    } as unknown as Client;
    const markDelivered = jest.fn().mockResolvedValue(undefined);
    const service = new AgentOperationWorkflowInputDeliveryService(
      prisma,
      messageService,
      { markDelivered } as unknown as AgentOperationWorkflowAnswerService,
      {} as FlowExecutionService,
      {} as ConversationWorkflowService,
      temporal,
    );

    await service.deliverOne();

    expect(handle.signal).toHaveBeenCalledWith(
      'workflowAnswer-workflow-1',
      expect.objectContaining({
        message: expect.objectContaining({
          data: {
            action: 'REFINE',
            payload: { feedback: '2' },
          },
        }),
      }),
    );
    expect(markDelivered).toHaveBeenCalledWith('operation-1');
  });

  it('resumes a paused execution before delivering an answer whose workflow already completed', async () => {
    const delivery = {
      operationId: 'operation-1',
      workflowId: 'workflow-old',
      workflowName: 'feature-sync',
      nodeId: 'review-step',
      action: 'APPROVED',
      answer: {},
      state: AgentOperationWorkflowInputState.CLAIMED,
      attemptCount: 1,
      claimOwner: 'worker-1',
      claimExpiresAt: new Date(),
      nextAttemptAt: new Date(),
      lastAttemptAt: new Date(),
      deliveredAt: null,
      lastFailureCode: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      operation: {
        messageId: 'message-1',
        organizationId: 'organization-1',
        conversationId: 'conversation-1',
      },
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      db: {
        message: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        agentOperationWorkflowInputDelivery: {
          findFirst: jest.fn().mockResolvedValue(delivery),
          updateMany,
          findUnique: jest.fn().mockResolvedValue(delivery),
        },
      },
    } as unknown as PrismaService;
    const messageService = {
      getMessage: jest.fn().mockResolvedValue({
        id: 'message-1',
        type: 'USER',
        projectId: 'project-1',
        conversationId: 'conversation-1',
        userId: 'user-1',
        status: 'completed',
        data: { action: 'APPROVED' },
        createdAt: '2026-08-22T00:00:00.000Z',
      }),
    } as unknown as MessageService;
    const completedHandle = {
      query: jest
        .fn()
        .mockRejectedValue(new Error('workflow execution already completed')),
    };
    const resumedHandle = {
      query: jest
        .fn()
        .mockResolvedValueOnce({ currentNodeId: 'review-step' })
        .mockResolvedValueOnce(true),
      signal: jest.fn().mockResolvedValue(undefined),
    };
    const temporal = {
      workflow: {
        getHandle: jest.fn((workflowId: string) =>
          workflowId === 'workflow-old' ? completedHandle : resumedHandle,
        ),
      },
    } as unknown as Client;
    const markDelivered = jest.fn().mockResolvedValue(undefined);
    const workflowAnswer = {
      markDelivered,
    } as unknown as AgentOperationWorkflowAnswerService;
    const pausedExecution = {
      id: 'execution-1',
      currentNode: 'review-step',
      flowState: { step: 'WAITING_FOR_USER_INPUT' },
    };
    const tryClaimPausedExecution = jest
      .fn()
      .mockResolvedValue(pausedExecution);
    const markPaused = jest.fn().mockResolvedValue(undefined);
    const flowExecution = {
      findPausedByConversation: jest.fn().mockResolvedValue(pausedExecution),
      tryClaimPausedExecution,
      markPaused,
    } as unknown as FlowExecutionService;
    const startWorkflowForExistingConversation = jest.fn().mockResolvedValue({
      workflowId: 'workflow-new',
      conversationId: 'conversation-1',
      success: true,
    });
    const conversationWorkflow = {
      startWorkflowForExistingConversation,
    } as unknown as ConversationWorkflowService;
    const service = new AgentOperationWorkflowInputDeliveryService(
      prisma,
      messageService,
      workflowAnswer,
      flowExecution,
      conversationWorkflow,
      temporal,
    );

    await service.deliverOne();

    expect(tryClaimPausedExecution).toHaveBeenCalledWith(
      'execution-1',
      'organization-1',
    );
    expect(startWorkflowForExistingConversation).toHaveBeenCalledWith(
      'conversation-1',
      'feature-sync',
      'organization-1',
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { workflowId: 'workflow-new' } }),
    );
    expect(resumedHandle.signal).toHaveBeenCalledTimes(1);
    expect(markDelivered).toHaveBeenCalledWith('operation-1');
    expect(markPaused).not.toHaveBeenCalled();
  });
});
