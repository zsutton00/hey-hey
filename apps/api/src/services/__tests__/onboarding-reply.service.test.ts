import { BadRequestException, ConflictException } from '@nestjs/common';
import { FlowExecutionStatus } from '@prisma/client';
import {
  ConversationStatus,
  MessageStatus,
  WorkflowName,
} from '../../generated';
import { NodeType } from '../../types/flow-internal.types';
import { ONBOARDING_NODES } from '../../flows/constants/node-ids';
import { REPOSITORY_GROUNDING_FIELDS } from '../../flows/nodes/onboarding/repository-grounding.contract';
import { OnboardingReplyFormValidator } from '../onboarding-reply-form-validator';
import { OnboardingReplyService } from '../onboarding-reply.service';

describe('OnboardingReplyService', () => {
  const ids = {
    organizationId: 'organization-id',
    projectId: 'project-id',
    conversationId: 'conversation-id',
    userId: 'user-id',
    parentMessageId: 'parent-id',
    workflowId: 'workflow-id',
  };
  const request = {
    parentMessageId: ids.parentMessageId,
    expectedConversationVersion: 4,
    answers: { project_name: 'Hey Hey' },
  };
  const serializedWaitingState = {
    step: 'waiting_for_user_input',
    phase: 'waiting_for_user',
    nodeConfig: { id: 'questions', type: 'questions', supportsPhases: false },
    version: 1,
    context: {},
  };
  const featureListUiElement = {
    id: 'feature-list',
    type: 'feature_list',
    label: 'Generated Features',
    required: true,
  };

  const build = () => {
    const tx = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.conversationId,
          version: 4,
          workflowId: ids.workflowId,
          workflowName: WorkflowName.Onboarding,
          workflowAboutId: ids.projectId,
          workflowAboutType: 'project',
          status: ConversationStatus.InProgress,
        }),
      },
      flowExecution: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'execution-id',
          currentNode: 'questions',
          status: FlowExecutionStatus.IN_PROGRESS,
          flowState: serializedWaitingState,
          startedAt: new Date('2026-08-29T01:00:00.000Z'),
        }),
        update: jest.fn().mockResolvedValue(undefined),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue({
          id: ids.parentMessageId,
          data: {
            type: 'QUESTIONS',
            nodeId: 'questions',
            uiElements: [
              {
                id: 'project_name',
                type: 'text_input',
                label: 'Project name',
                required: true,
              },
            ],
          },
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn((callback) => callback(tx)),
    };
    const messageService = {
      addMessageInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'message-id' }),
    };
    const nodeExecutionService = {
      getNode: jest.fn().mockReturnValue({
        node: { type: NodeType.QUESTIONS },
        routing: {},
      }),
    };
    const formValidator = new OnboardingReplyFormValidator();
    const projectService = {
      recordOnboardingExistingWorkIntent: jest
        .fn()
        .mockResolvedValue(undefined),
    };
    const service = new OnboardingReplyService(
      prisma as never,
      messageService as never,
      nodeExecutionService as never,
      formValidator,
      projectService as never,
    );
    return {
      service,
      tx,
      messageService,
      nodeExecutionService,
      projectService,
    };
  };

  it('atomically records one USER reply with a retryable onboarding marker', async () => {
    const { service, tx, messageService } = build();
    await expect(service.admit({ ...ids, request } as never)).resolves.toEqual({
      id: 'message-id',
    });
    expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        type: 'USER',
        status: MessageStatus.Completed,
        data: request.answers,
      }),
      ids.organizationId,
      'onboardingReplyAdmission',
      {
        expectedConversationVersion: 4,
        onboardingReplyDelivery: {
          workflowId: ids.workflowId,
          nodeId: 'questions',
        },
        suppressExecutableDelivery: true,
      },
    );
    expect(messageService.addMessageInTransaction).toHaveBeenCalledTimes(1);
    expect(tx.message.findFirst).toHaveBeenCalledWith({
      where: {
        id: ids.parentMessageId,
        conversationId: ids.conversationId,
        projectId: ids.projectId,
        type: 'SYSTEM',
        responses: { none: {} },
      },
    });
  });

  it.each([
    ['yes', 'selected', { choice: 'yes' }],
    ['no', 'declined', { choice: 'no' }],
    ['direct yes select value', 'selected', 'yes'],
    ['direct no select value', 'declined', 'no'],
  ] as const)(
    'persists a %s existing-work intent with the reply',
    async (_label, existingWorkIntent, intentAnswer) => {
      const {
        service,
        tx,
        messageService,
        nodeExecutionService,
        projectService,
      } = build();
      const intentNodeId = ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT;
      tx.flowExecution.findFirst.mockResolvedValueOnce({
        id: 'execution-id',
        currentNode: intentNodeId,
        status: FlowExecutionStatus.IN_PROGRESS,
        flowState: serializedWaitingState,
        startedAt: new Date('2026-08-29T01:00:00.000Z'),
      });
      nodeExecutionService.getNode.mockReturnValueOnce({
        node: { type: NodeType.QUESTIONS },
        routing: {},
      });
      tx.message.findFirst.mockResolvedValueOnce({
        id: ids.parentMessageId,
        data: {
          type: 'QUESTIONS',
          nodeId: intentNodeId,
          uiElements: [
            {
              id: REPOSITORY_GROUNDING_FIELDS.intent,
              type: 'select',
              label: 'Existing work',
              required: true,
            },
          ],
        },
      });

      await expect(
        service.admit({
          ...ids,
          request: {
            ...request,
            answers: {
              [REPOSITORY_GROUNDING_FIELDS.intent]: intentAnswer,
            },
          },
        } as never),
      ).resolves.toEqual({ id: 'message-id' });

      expect(
        projectService.recordOnboardingExistingWorkIntent,
      ).toHaveBeenCalledWith(tx, {
        projectId: ids.projectId,
        organizationId: ids.organizationId,
        existingWorkIntent,
      });
      expect(messageService.addMessageInTransaction).toHaveBeenCalledTimes(1);
    },
  );

  it('does not mutate Project config for an invalid existing-work answer', async () => {
    const {
      service,
      tx,
      messageService,
      nodeExecutionService,
      projectService,
    } = build();
    const intentNodeId = ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT;
    tx.flowExecution.findFirst.mockResolvedValueOnce({
      id: 'execution-id',
      currentNode: intentNodeId,
      status: FlowExecutionStatus.IN_PROGRESS,
      flowState: serializedWaitingState,
      startedAt: new Date('2026-08-29T01:00:00.000Z'),
    });
    nodeExecutionService.getNode.mockReturnValueOnce({
      node: { type: NodeType.QUESTIONS },
      routing: {},
    });
    tx.message.findFirst.mockResolvedValueOnce({
      id: ids.parentMessageId,
      data: {
        type: 'QUESTIONS',
        nodeId: intentNodeId,
        uiElements: [
          {
            id: REPOSITORY_GROUNDING_FIELDS.intent,
            type: 'select',
            label: 'Existing work',
            required: true,
          },
        ],
      },
    });

    await expect(
      service.admit({
        ...ids,
        request: {
          ...request,
          answers: {
            [REPOSITORY_GROUNDING_FIELDS.intent]: { choice: 'maybe' },
          },
        },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(
      projectService.recordOnboardingExistingWorkIntent,
    ).not.toHaveBeenCalled();
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ['approval', { action: 'APPROVED', payload: {} }],
    [
      'refinement',
      {
        action: 'REFINE',
        payload: { sections: {}, overall: 'Group reporting by audience.' },
      },
    ],
  ])(
    'admits generated feature-list %s exactly once',
    async (_label, featureListAnswer) => {
      const { service, tx, messageService, nodeExecutionService } = build();
      const generatedReviewRequest = {
        ...request,
        answers: { 'feature-list': featureListAnswer },
      };
      tx.flowExecution.findFirst.mockResolvedValueOnce({
        id: 'execution-id',
        currentNode: 'shared-generate-features',
        status: FlowExecutionStatus.IN_PROGRESS,
        flowState: serializedWaitingState,
        startedAt: new Date('2026-08-29T01:00:00.000Z'),
      });
      nodeExecutionService.getNode.mockReturnValueOnce({
        node: { type: NodeType.GENERATE },
        routing: {},
      });
      tx.message.findFirst.mockResolvedValueOnce({
        id: ids.parentMessageId,
        status: MessageStatus.Completed,
        data: {
          type: 'FEATURE_LIST',
          nodeId: 'shared-generate-features',
          uiElements: [featureListUiElement],
        },
      });

      await expect(
        service.admit({ ...ids, request: generatedReviewRequest } as never),
      ).resolves.toEqual({ id: 'message-id' });
      expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'USER',
          status: MessageStatus.Completed,
          data: generatedReviewRequest.answers,
        }),
        ids.organizationId,
        'onboardingReplyAdmission',
        expect.objectContaining({
          onboardingReplyDelivery: {
            workflowId: ids.workflowId,
            nodeId: 'shared-generate-features',
          },
          suppressExecutableDelivery: true,
        }),
      );
      expect(messageService.addMessageInTransaction).toHaveBeenCalledTimes(1);
      expect(tx.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: ids.parentMessageId,
          conversationId: ids.conversationId,
          projectId: ids.projectId,
          type: 'SYSTEM',
          responses: { none: {} },
        },
      });
    },
  );

  it.each([FlowExecutionStatus.PAUSED, FlowExecutionStatus.COMPLETED])(
    'admits a reply to a %s resumable onboarding execution without a live workflow',
    async (status) => {
      const { service, tx, messageService } = build();
      tx.conversation.findFirst.mockResolvedValueOnce({
        id: ids.conversationId,
        version: 4,
        workflowId: null,
        workflowName: WorkflowName.Onboarding,
        workflowAboutId: ids.projectId,
        workflowAboutType: 'project',
        status: ConversationStatus.Recoverable,
      });
      tx.flowExecution.findFirst.mockResolvedValueOnce({
        id: 'execution-id',
        currentNode: 'questions',
        status,
        resumable: true,
        flowState: serializedWaitingState,
        startedAt: new Date('2026-08-29T01:00:00.000Z'),
      });

      await expect(
        service.admit({ ...ids, request } as never),
      ).resolves.toEqual({ id: 'message-id' });
      expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        ids.organizationId,
        'onboardingReplyAdmission',
        expect.objectContaining({
          onboardingReplyDelivery: { nodeId: 'questions' },
          suppressExecutableDelivery: true,
        }),
      );
    },
  );

  it('repairs and admits a completed resumable opener with an unanswered form', async () => {
    const { service, tx, messageService, nodeExecutionService } = build();
    tx.conversation.findFirst.mockResolvedValueOnce({
      id: ids.conversationId,
      version: 4,
      workflowId: ids.workflowId,
      workflowName: WorkflowName.Onboarding,
      workflowAboutId: ids.projectId,
      workflowAboutType: 'project',
      status: ConversationStatus.Completed,
    });
    tx.flowExecution.findFirst.mockResolvedValueOnce({
      id: 'execution-id',
      currentNode: 'onboarding-welcome',
      status: FlowExecutionStatus.COMPLETED,
      resumable: true,
      flowState: {
        core: {
          user: { id: ids.userId, role: 'member' },
        },
      },
      startedAt: new Date('2026-08-29T01:00:00.000Z'),
    });
    nodeExecutionService.getNode.mockReturnValueOnce({
      node: { type: NodeType.OPENER, twoPhase: false },
      routing: { nextNode: 'onboarding-clarify-concept' },
    });
    tx.message.findFirst.mockResolvedValueOnce({
      id: ids.parentMessageId,
      data: {
        type: 'QUESTIONS',
        nodeId: 'onboarding-welcome',
        uiElements: [
          {
            id: 'project_name',
            type: 'text_input',
            label: 'Project name',
            required: true,
          },
        ],
      },
    });

    await expect(service.admit({ ...ids, request } as never)).resolves.toEqual({
      id: 'message-id',
    });
    expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ids.organizationId,
      'onboardingReplyAdmission',
      expect.objectContaining({
        onboardingReplyDelivery: {
          workflowId: ids.workflowId,
          nodeId: 'onboarding-welcome',
        },
      }),
    );
    expect(tx.flowExecution.update).toHaveBeenCalledWith({
      where: {
        id: 'execution-id',
        organizationId: ids.organizationId,
      },
      data: {
        flowState: expect.objectContaining({
          step: 'waiting_for_user_input',
          phase: 'waiting_for_user',
          currentNodeId: 'onboarding-welcome',
          currentNodeExecutionId: ids.parentMessageId,
          lastSystemMessageId: ids.parentMessageId,
          context: expect.objectContaining({
            flowId: WorkflowName.Onboarding,
            lastSystemMessageId: ids.parentMessageId,
            pendingTransition: {
              nextNodeId: 'onboarding-clarify-concept',
              reason: 'opener_complete',
            },
          }),
        }),
      },
    });
  });

  it.each([ConversationStatus.Failed, ConversationStatus.Deleted])(
    'rejects a %s conversation even when an execution appears resumable',
    async (status) => {
      const { service, tx, messageService } = build();
      tx.conversation.findFirst.mockResolvedValueOnce({
        id: ids.conversationId,
        version: 4,
        workflowId: ids.workflowId,
        workflowName: WorkflowName.Onboarding,
        workflowAboutId: ids.projectId,
        workflowAboutType: 'project',
        status,
      });

      await expect(
        service.admit({ ...ids, request } as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(tx.flowExecution.findFirst).not.toHaveBeenCalled();
      expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
    },
  );

  it('does not admit a non-resumable paused onboarding execution', async () => {
    const { service, tx, messageService } = build();
    tx.conversation.findFirst.mockResolvedValueOnce({
      id: ids.conversationId,
      version: 4,
      workflowId: null,
      workflowName: WorkflowName.Onboarding,
      workflowAboutId: ids.projectId,
      workflowAboutType: 'project',
      status: ConversationStatus.Recoverable,
    });
    tx.flowExecution.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.admit({ ...ids, request } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });

  it.each([
    [
      'stale version',
      (ctx: ReturnType<typeof build>) => {
        ctx.tx.conversation.findFirst.mockResolvedValueOnce({
          id: ids.conversationId,
          version: 5,
          workflowId: ids.workflowId,
          workflowName: WorkflowName.Onboarding,
          workflowAboutId: ids.projectId,
          workflowAboutType: 'project',
          status: ConversationStatus.InProgress,
        });
      },
    ],
    [
      'wrong workflow',
      (ctx: ReturnType<typeof build>) => {
        ctx.tx.conversation.findFirst.mockResolvedValueOnce({
          id: ids.conversationId,
          version: 4,
          workflowId: ids.workflowId,
          workflowName: WorkflowName.TaskRefinement,
          workflowAboutId: ids.projectId,
          workflowAboutType: 'project',
          status: ConversationStatus.InProgress,
        });
      },
    ],
    [
      'non-input node',
      (ctx: ReturnType<typeof build>) => {
        ctx.nodeExecutionService.getNode.mockReturnValueOnce({
          node: { type: NodeType.NON_INTERACTIVE },
          routing: {},
        });
      },
    ],
    [
      'wrong current parent',
      (ctx: ReturnType<typeof build>) => {
        ctx.tx.flowExecution.findFirst.mockResolvedValueOnce({
          id: 'execution-id',
          currentNode: 'shared-generate-features',
          status: FlowExecutionStatus.IN_PROGRESS,
          flowState: serializedWaitingState,
          startedAt: new Date('2026-08-29T01:00:00.000Z'),
        });
        ctx.nodeExecutionService.getNode.mockReturnValueOnce({
          node: { type: NodeType.GENERATE },
          routing: {},
        });
        ctx.tx.message.findFirst.mockResolvedValueOnce({
          id: ids.parentMessageId,
          data: {
            type: 'FEATURE_LIST',
            nodeId: 'onboarding-clarify-concept',
            uiElements: [featureListUiElement],
          },
        });
      },
    ],
  ])('rejects %s before recording either effect', async (_label, arrange) => {
    const ctx = build();
    arrange(ctx);
    await expect(
      ctx.service.admit({ ...ids, request } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(ctx.messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });

  it('rejects schema-invalid feature-list answers before recording either effect', async () => {
    const ctx = build();
    ctx.tx.flowExecution.findFirst.mockResolvedValueOnce({
      id: 'execution-id',
      currentNode: 'shared-generate-features',
      status: FlowExecutionStatus.IN_PROGRESS,
      flowState: serializedWaitingState,
      startedAt: new Date('2026-08-29T01:00:00.000Z'),
    });
    ctx.nodeExecutionService.getNode.mockReturnValueOnce({
      node: { type: NodeType.GENERATE },
      routing: {},
    });
    ctx.tx.message.findFirst.mockResolvedValueOnce({
      id: ids.parentMessageId,
      data: {
        type: 'FEATURE_LIST',
        nodeId: 'shared-generate-features',
        uiElements: [featureListUiElement],
      },
    });

    await expect(
      ctx.service.admit({
        ...ids,
        request: {
          ...request,
          answers: {
            'feature-list': {
              action: 'APPROVED',
              payload: { feedback: 'This payload is not allowed.' },
            },
          },
        },
      } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });
});
