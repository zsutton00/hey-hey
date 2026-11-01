import { SubmitWorkflowAnswerRequestDto } from '../../../generated';
import { WorkflowName } from '../../../generated/model/workflowName';
import {
  AgentOperationWorkflowAnswerService,
  buildWorkflowAnswerEvidenceData,
} from '../agent-operation-workflow-answer.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AgentOperationRegistryService } from '../agent-operation-registry.service';
import { MessageService } from '../../message.service';
import { ExecutionGrantService } from '../../controller-authorization/execution-grant.service';
import { AgentOperationDispatchService } from '../../../core/websockets/agent-operation-dispatch.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
} from '../../../types';
import {
  AgentOperationAuthorizationKind,
  AgentOperationState,
} from '@prisma/client';

const buildService = (): AgentOperationWorkflowAnswerService =>
  new AgentOperationWorkflowAnswerService(
    {} as PrismaService,
    {} as AgentOperationRegistryService,
    {} as MessageService,
    {} as ExecutionGrantService,
    {} as AgentOperationDispatchService,
  );

const triggerMessage = {
  id: 'trigger-1',
  type: 'SYSTEM',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  data: {
    triggersAgent: {
      promptType: 'user_message',
      triggerMessageId: 'trigger-1',
    },
  },
} as const;

const admittedOperation = (
  authorizationKind: AgentOperationAuthorizationKind | null,
) => ({
  operationId: 'operation-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  userId: 'user-1',
  agentSessionId: 'agent-session-1',
  conversationId: 'conversation-1',
  kind: 'WORKFLOW_ANSWER',
  state: AgentOperationState.ROUTING_PENDING,
  authorizationId: 'authorization-1',
  authorizationKind,
  grantId: 'grant-1',
  messageId: 'message-1',
  triggerMessageId: null,
  result: {
    authorizationKind: 'controller_assertion',
    legacyMarker: true,
  },
  dispatch: null,
});

type BindingOperation = Omit<
  ReturnType<typeof admittedOperation>,
  'dispatch' | 'state' | 'triggerMessageId'
> & {
  dispatch: {
    authorizationId: string;
    authorizationKind: AgentOperationAuthorizationKind;
    grantId: string;
    triggerMessageId: string;
  } | null;
  state: AgentOperationState;
  triggerMessageId: string | null;
};

const buildBindingService = (operation: BindingOperation) => {
  const dispatchCreate = jest.fn();
  const operationUpdate = jest.fn().mockResolvedValue({
    ...operation,
    state: AgentOperationState.DISPATCH_PENDING,
    triggerMessageId: 'trigger-1',
  });
  const tx = {
    message: { update: jest.fn() },
    $executeRaw: jest.fn(),
    agentOperation: {
      findUnique: jest.fn().mockResolvedValue(operation),
      update: operationUpdate,
    },
    executionGrant: {
      findUnique: jest.fn().mockResolvedValue({ machineId: 'machine-1' }),
    },
    agentOperationDispatch: { create: dispatchCreate },
  };
  const prisma = {
    db: {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
    },
  } as unknown as PrismaService;
  const messageService = {
    addMessageInTransaction: jest.fn().mockResolvedValue({ id: 'trigger-1' }),
    getMessage: jest.fn().mockResolvedValue({ id: 'trigger-1' }),
  } as unknown as MessageService;
  const dispatchService = { nudge: jest.fn() };
  const service = new AgentOperationWorkflowAnswerService(
    prisma,
    {} as AgentOperationRegistryService,
    messageService,
    {} as ExecutionGrantService,
    dispatchService as unknown as AgentOperationDispatchService,
  );
  return {
    service,
    tx,
    dispatchCreate,
    operationUpdate,
    messageService,
    dispatchService,
  };
};

describe('AgentOperationWorkflowAnswerService', () => {
  it('persists accepted workflow-answer evidence under its validated SYSTEM parent message', async () => {
    const tx = {
      $executeRaw: jest.fn(),
      agentOperation: {
        findUnique: jest.fn().mockResolvedValue({
          operationId: 'operation-1',
          executionOwner: 'owner-1',
          state: AgentOperationState.SUBMITTING,
        }),
        update: jest.fn(),
      },
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-1',
          workflowId: 'workflow-1',
        }),
      },
      message: {
        findFirst: jest.fn().mockResolvedValue({ id: 'question-message-1' }),
      },
      agentOperationWorkflowInputDelivery: { create: jest.fn() },
      agentOperationDispatch: { create: jest.fn() },
    };
    const prisma = {
      db: {
        $transaction: jest.fn(
          async (callback: (client: typeof tx) => Promise<unknown>) =>
            callback(tx),
        ),
      },
    } as unknown as PrismaService;
    const messageService = {
      addMessageInTransaction: jest
        .fn()
        .mockResolvedValue({ id: 'answer-message-1' }),
    } as unknown as MessageService;
    const registry = {
      reservedMessageIds: jest.fn().mockReturnValue({
        messageId: 'answer-message-1',
      }),
      recordAuthorizationInTransaction: jest.fn(),
      markRoutingPendingInTransaction: jest.fn().mockResolvedValue({
        operationId: 'operation-1',
        fingerprint: 'f'.repeat(64),
        state: AgentOperationState.ROUTING_PENDING,
      }),
      toSnapshot: jest.fn((snapshot) => snapshot),
    } as unknown as AgentOperationRegistryService;
    const executionGrantService = {
      deriveInteractiveGrantInTransaction: jest.fn().mockResolvedValue({
        id: 'authorization-1',
        kind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
        grant: { id: 'grant-1' },
      }),
    } as unknown as ExecutionGrantService;
    const service = new AgentOperationWorkflowAnswerService(
      prisma,
      registry,
      messageService,
      executionGrantService,
      {} as AgentOperationDispatchService,
    );
    const request = {
      operationId: 'operation-1',
      operationFingerprint: 'f'.repeat(64),
      agentSessionId: 'agent-session-1',
      conversationId: 'conversation-1' as ConversationId,
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      input: {
        kind: 'WORKFLOW_ANSWER',
        workflowName: WorkflowName.FeatureSync,
        nodeId: 'review-step',
        parentMessageId: 'question-message-1' as MessageId,
        action: 'APPROVED',
        payload: {},
      },
    } satisfies SubmitWorkflowAnswerRequestDto;

    await service.admit({
      request,
      principal: {
        organizationId: 'organization-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
        userId: 'user-1' as never,
      },
      admission: {
        authorizationId: 'authorization-1',
        envelopeAuthorization: {
          kind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
        },
      } as never,
      executionOwner: 'owner-1',
    });

    expect(tx.message.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'question-message-1',
        conversationId: 'conversation-1',
        projectId: 'project-1',
        type: 'SYSTEM',
      },
      select: { id: true },
    });
    expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        id: 'answer-message-1',
        parentMessageId: 'question-message-1' as MessageId,
        type: 'USER',
      }),
      'organization-1',
      'workflowAnswer:evidence',
    );
  });

  it.each([
    'valid',
    'missing',
    'malformed',
    'refine',
    'unknown',
    'stale',
    'unreviewed',
  ] as const)(
    'admits only a current explicit conversational approval: %s',
    async (scenario) => {
      const tx = {
        $executeRaw: jest.fn(),
        agentOperation: {
          findUnique: jest.fn().mockResolvedValue({
            operationId: 'operation-1',
            executionOwner: 'owner-1',
            state: AgentOperationState.SUBMITTING,
          }),
          update: jest.fn(),
        },
        conversation: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'conversation-1',
            workflowId: 'workflow-1',
          }),
        },
        message: {
          findFirst: jest.fn().mockResolvedValue({ id: 'question-message-1' }),
          findMany: jest.fn().mockResolvedValue(
            scenario === 'missing'
              ? []
              : [
                  {
                    id: 'c2d9e41a-4391-4cab-a113-d829722eb02d',
                    type: 'SYSTEM',
                    data: {
                      uiElements: [
                        {
                          type: 'coding_plan_version',
                          payload: {
                            responseType: 'coding_plan_version_v1',
                            markdown:
                              'Preserve explicit approval. Retain the existing Run.',
                            requiredServiceIds: [
                              'a8fb6fbb-5747-4480-89e3-fc4a43ab7745',
                            ],
                          },
                        },
                      ],
                    },
                  },
                  ...(scenario === 'unreviewed'
                    ? [
                        {
                          id: 'new-feedback',
                          type: 'USER',
                          data: { comment: 'Change point E.' },
                        },
                      ]
                    : []),
                ],
          ),
        },
        agentOperationWorkflowInputDelivery: { create: jest.fn() },
        agentOperationDispatch: { create: jest.fn() },
      };
      const prisma = {
        db: {
          $transaction: jest.fn(
            async (callback: (client: typeof tx) => Promise<unknown>) =>
              callback(tx),
          ),
        },
      } as unknown as PrismaService;
      const messageService = {
        addMessageInTransaction: jest
          .fn()
          .mockResolvedValue({ id: 'answer-message-1' }),
      } as unknown as MessageService;
      const registry = {
        reservedMessageIds: jest.fn().mockReturnValue({
          messageId: 'answer-message-1',
        }),
        recordAuthorizationInTransaction: jest.fn(),
        markRoutingPendingInTransaction: jest.fn().mockResolvedValue({
          operationId: 'operation-1',
          fingerprint: 'f'.repeat(64),
          state: AgentOperationState.ROUTING_PENDING,
        }),
        toSnapshot: jest.fn((snapshot) => snapshot),
      } as unknown as AgentOperationRegistryService;
      const executionGrantService = {
        deriveInteractiveGrantInTransaction: jest.fn().mockResolvedValue({
          id: 'authorization-1',
          kind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
          grant: { id: 'grant-1' },
        }),
      } as unknown as ExecutionGrantService;
      const service = new AgentOperationWorkflowAnswerService(
        prisma,
        registry,
        messageService,
        executionGrantService,
        {} as AgentOperationDispatchService,
      );
      const request = {
        operationId: 'operation-1',
        operationFingerprint: 'f'.repeat(64),
        agentSessionId: 'agent-session-1',
        conversationId: 'conversation-1' as ConversationId,
        authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
        input: {
          kind: 'WORKFLOW_ANSWER',
          workflowName: WorkflowName.FeatureSync,
          nodeId: 'feature-sync-coding-plan',
          parentMessageId: 'question-message-1' as MessageId,
          action:
            scenario === 'refine'
              ? 'REFINE'
              : scenario === 'unknown'
                ? 'REVISED'
                : 'APPROVED',
          payload:
            scenario === 'malformed'
              ? {}
              : {
                  responseType: 'coding_plan_version_approval_v1',
                  versionMessageId:
                    scenario === 'stale'
                      ? '7160c056-e0be-4234-afdd-178ec589f612'
                      : 'c2d9e41a-4391-4cab-a113-d829722eb02d',
                  feedback: 'Retain keyboard access.',
                  runtime: {
                    provider: 'codex',
                    model: 'implementation-model',
                    reasoningEffort: 'high',
                    fastMode: true,
                  },
                },
        },
      } satisfies SubmitWorkflowAnswerRequestDto;

      const admissionResult = service.admit({
        request,
        principal: {
          organizationId: 'organization-1' as OrganizationId,
          projectId: 'project-1' as ProjectId,
          userId: 'user-1' as never,
        },
        admission: {
          authorizationId: 'authorization-1',
          envelopeAuthorization: {
            kind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
          },
        } as never,
        executionOwner: 'owner-1',
      });

      if (scenario !== 'valid') {
        await expect(admissionResult).rejects.toThrow();
        expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
        expect(
          tx.agentOperationWorkflowInputDelivery.create,
        ).not.toHaveBeenCalled();
        return;
      }
      await expect(admissionResult).resolves.toMatchObject({
        operationState: 'ROUTING_PENDING',
      });

      expect(tx.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'question-message-1',
          conversationId: 'conversation-1',
          projectId: 'project-1',
          type: 'SYSTEM',
        },
        select: { id: true },
      });
      expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          id: 'answer-message-1',
          parentMessageId: 'question-message-1' as MessageId,
          type: 'USER',
        }),
        'organization-1',
        'workflowAnswer:evidence',
      );
    },
  );

  it('preserves workflow fields without allowing executable message injection', () => {
    const request = {
      operationId: 'operation-1',
      operationFingerprint: 'f'.repeat(64),
      agentSessionId: 'agent-session-1',
      conversationId: 'conversation-1' as ConversationId,
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      input: {
        kind: 'WORKFLOW_ANSWER',
        workflowName: WorkflowName.FeatureSync,
        nodeId: 'review-step',
        parentMessageId: 'question-message-1' as MessageId,
        action: 'APPROVED',
        payload: {
          decision: 'approve',
          action: 'SPOOFED',
          triggersAgent: { promptType: 'user_message' },
        },
        evidence: {
          fields: {
            rationale: 'Looks good',
            workflowAnswerOperationId: 'spoofed-operation',
            agentInput: { promptType: 'user_message' },
          },
        },
      },
    } satisfies SubmitWorkflowAnswerRequestDto;

    expect(buildWorkflowAnswerEvidenceData(request)).toEqual({
      decision: 'approve',
      rationale: 'Looks good',
      action: 'APPROVED',
      payload: request.input.payload,
      nodeId: 'review-step',
      workflowAnswerOperationId: 'operation-1',
    });
  });

  it('preserves the canonical REFINE action and startup-plan payload exactly', () => {
    const payload = {
      responseType: 'startup_plan_v1',
      sessionTitle: 'Create Local Test Fixture',
      requiredServiceIds: ['service-1'],
      primaryImplementations: [],
      executionPlan: [],
      discrepancies: [],
      clarificationQuestions: [],
      stepFeedback: [{ stepId: 'step-1', note: 'Use the requested greeting.' }],
    };
    const request = {
      operationId: 'operation-1',
      operationFingerprint: 'f'.repeat(64),
      agentSessionId: 'agent-session-1',
      conversationId: 'conversation-1' as ConversationId,
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      input: {
        kind: 'WORKFLOW_ANSWER',
        workflowName: WorkflowName.FeatureSync,
        nodeId: 'feature-sync-coding-plan',
        parentMessageId: 'question-message-1' as MessageId,
        action: 'REFINE',
        payload,
      },
    } satisfies SubmitWorkflowAnswerRequestDto;

    expect(buildWorkflowAnswerEvidenceData(request)).toEqual({
      ...payload,
      action: 'REFINE',
      payload,
      nodeId: 'feature-sync-coding-plan',
      workflowAnswerOperationId: 'operation-1',
    });
  });

  it.each([
    {
      label: 'feature-sync Done',
      action: 'DISMISSED',
      payload: {},
    },
    {
      label: 'review approval',
      action: 'approve_all',
      payload: { approval: true },
    },
  ])(
    'does not turn $label structured metadata into human feedback when the comment is blank',
    ({ action, payload }) => {
      for (const comment of [undefined, '', ' \n\t ']) {
        const request = {
          operationId: 'operation-1',
          operationFingerprint: 'f'.repeat(64),
          agentSessionId: 'agent-session-1',
          conversationId: 'conversation-1' as ConversationId,
          authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
          input: {
            kind: 'WORKFLOW_ANSWER',
            workflowName: WorkflowName.FeatureSync,
            nodeId: 'review-step',
            parentMessageId: 'question-message-1' as MessageId,
            action,
            payload,
            ...(comment === undefined ? {} : { evidence: { comment } }),
          },
        } satisfies SubmitWorkflowAnswerRequestDto;

        const evidence = buildWorkflowAnswerEvidenceData(request);

        expect(evidence).toEqual(
          expect.objectContaining({
            action,
            payload,
            nodeId: 'review-step',
            workflowAnswerOperationId: 'operation-1',
          }),
        );
        expect(evidence).not.toHaveProperty('comment');
      }
    },
  );

  it('keeps non-empty human feedback as the only visible prose field', () => {
    const request = {
      operationId: 'operation-1',
      operationFingerprint: 'f'.repeat(64),
      agentSessionId: 'agent-session-1',
      conversationId: 'conversation-1' as ConversationId,
      authorization: { kind: 'bounded_grant', grantId: 'grant-1' },
      input: {
        kind: 'WORKFLOW_ANSWER',
        workflowName: WorkflowName.FeatureSync,
        nodeId: 'review-step',
        parentMessageId: 'question-message-1' as MessageId,
        action: 'approve_all',
        payload: { approval: true },
        evidence: { comment: 'Keep the completed items as-is.' },
      },
    } satisfies SubmitWorkflowAnswerRequestDto;

    expect(buildWorkflowAnswerEvidenceData(request)).toEqual({
      action: 'approve_all',
      approval: true,
      payload: { approval: true },
      nodeId: 'review-step',
      workflowAnswerOperationId: 'operation-1',
      comment: 'Keep the completed items as-is.',
    });
  });

  it('fingerprints the semantic answer independently of authorization', () => {
    const service = buildService();
    const request = {
      operationId: 'operation-1',
      agentSessionId: 'agent-session-1',
      conversationId: 'conversation-1' as ConversationId,
      input: {
        kind: 'WORKFLOW_ANSWER',
        workflowName: WorkflowName.FeatureSync,
        nodeId: 'review-step',
        parentMessageId: 'question-message-1' as MessageId,
        action: 'APPROVED',
        payload: { decision: 'approve' },
      },
    } satisfies Omit<
      SubmitWorkflowAnswerRequestDto,
      'operationFingerprint' | 'authorization'
    >;

    expect(
      service.fingerprint(request, {
        organizationId: 'organization-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
      }),
    ).toBe(
      service.fingerprint(request, {
        organizationId: 'organization-1' as OrganizationId,
        projectId: 'project-1' as ProjectId,
      }),
    );
  });

  it('binds delayed dispatch from typed operation state instead of legacy result metadata', async () => {
    const context = buildBindingService(
      admittedOperation(AgentOperationAuthorizationKind.BOUNDED_GRANT),
    );

    await context.service.bindWorkflowTriggerAndDispatch({
      operationId: 'operation-1',
      triggerMessage: triggerMessage as never,
    });

    expect(context.dispatchCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationId: 'operation-1',
        authorizationId: 'authorization-1',
        authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
        grantId: 'grant-1',
        triggerMessageId: 'trigger-1',
      }),
    });
    expect(context.operationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          result: {
            messageId: 'message-1',
            resolution: 'DISPATCH',
            triggerMessageId: 'trigger-1',
          },
        }),
      }),
    );
  });

  it('fails closed when delayed dispatch has no persisted authorization kind', async () => {
    const context = buildBindingService(admittedOperation(null));

    await expect(
      context.service.bindWorkflowTriggerAndDispatch({
        operationId: 'operation-1',
        triggerMessage: triggerMessage as never,
      }),
    ).rejects.toMatchObject({
      response: { code: 'WORKFLOW_ANSWER_AUTHORIZATION_KIND_MISSING' },
    });
    expect(context.dispatchCreate).not.toHaveBeenCalled();
  });

  it('returns a matching delayed dispatch retry without replacing its binding', async () => {
    const operation = {
      ...admittedOperation(AgentOperationAuthorizationKind.BOUNDED_GRANT),
      state: AgentOperationState.DISPATCH_PENDING,
      triggerMessageId: 'trigger-1',
      dispatch: {
        authorizationId: 'authorization-1',
        authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
        grantId: 'grant-1',
        triggerMessageId: 'trigger-1',
      },
    };
    const context = buildBindingService(operation);

    await expect(
      context.service.bindWorkflowTriggerAndDispatch({
        operationId: 'operation-1',
        triggerMessage: triggerMessage as never,
      }),
    ).resolves.toMatchObject({ id: 'trigger-1' });
    expect(context.dispatchCreate).not.toHaveBeenCalled();
  });

  it.each([
    AgentOperationState.SUCCEEDED,
    AgentOperationState.DENIED,
    AgentOperationState.FAILED,
  ])(
    'returns the exact existing trigger when an activity retries after dispatch reaches %s',
    async (state) => {
      const operation = {
        ...admittedOperation(AgentOperationAuthorizationKind.BOUNDED_GRANT),
        state,
        triggerMessageId: 'trigger-1',
        dispatch: {
          authorizationId: 'authorization-1',
          authorizationKind: AgentOperationAuthorizationKind.BOUNDED_GRANT,
          grantId: 'grant-1',
          triggerMessageId: 'trigger-1',
        },
      };
      const context = buildBindingService(operation);

      await expect(
        context.service.bindWorkflowTriggerAndDispatch({
          operationId: 'operation-1',
          triggerMessage: triggerMessage as never,
        }),
      ).resolves.toMatchObject({ id: 'trigger-1' });
      expect(context.operationUpdate).not.toHaveBeenCalled();
      expect(context.dispatchCreate).not.toHaveBeenCalled();
      expect(
        context.messageService.addMessageInTransaction,
      ).not.toHaveBeenCalled();
    },
  );

  it('rejects a delayed dispatch retry whose authorization kind contradicts the operation', async () => {
    const operation = {
      ...admittedOperation(AgentOperationAuthorizationKind.BOUNDED_GRANT),
      state: AgentOperationState.DISPATCH_PENDING,
      triggerMessageId: 'trigger-1',
      dispatch: {
        authorizationId: 'authorization-1',
        authorizationKind: AgentOperationAuthorizationKind.CONTROLLER_ASSERTION,
        grantId: 'grant-1',
        triggerMessageId: 'trigger-1',
      },
    };
    const context = buildBindingService(operation);

    await expect(
      context.service.bindWorkflowTriggerAndDispatch({
        operationId: 'operation-1',
        triggerMessage: triggerMessage as never,
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_ANSWER_DISPATCH_BINDING_CONTRADICTION',
      },
    });
    expect(context.dispatchCreate).not.toHaveBeenCalled();
  });
});
