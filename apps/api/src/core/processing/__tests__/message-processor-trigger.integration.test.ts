/* eslint-disable @typescript-eslint/unbound-method */
import { Logger } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Client } from '@temporalio/client';
import { MessageCreatedEvent } from '../../events/types/domain-events';
import { MessageService } from '../../../services/message.service';
import { MessageProcessor } from '../message-processor.service';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../events/tokens';
import { MessageCreatedUserMessage, UserMessage } from '../../../generated';
import * as TestUtils from '../../../utils/testUtils';
import { EventRouter } from '../../events/event-router';
import { ConversationService } from '../../../services/conversation.service';
import { FlowExecutionService } from '../../../services/workflows/flow-execution.service';
import { ConversationWorkflowService } from '../../../services/workflows/conversation-workflow.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { NodeType } from '../../../types/flow-internal.types';
import { RedisService } from '../../redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';
import { TriggerEmitter } from '../../websockets/trigger-emitter.service';
import { ConversationId, MessageId, OrganizationId } from '../../../types';

const { testIds } = TestUtils;

/**
 * Covers the full chain inside `api/src` for an action-bearing USER message
 * landing on a live, engine-bound Temporal-backed conversation:
 *
 *   1. handleUserMessageCreated sees the unstamped action submission as
 *      evidence only. Generic USER messages no longer signal Temporal; the
 *      dedicated workflow-answer endpoint owns that routing. The processor
 *      never authors a follow-up message for a USER turn.
 *   2. Downstream, the EXTERNAL_AGENT node persists a SYSTEM message that
 *      carries its own `data.triggersAgent` body.
 *   3. The `conversation.updated.messageAdded` handler in WebsocketBridge
 *      forwards that message to `TriggerEmitter.emitConversationTriggerForMessage`.
 *   4. Exactly one `trigger.conversation` frame is signed and emitted to
 *      the resolved machine.
 *
 * Steps 2+3 are exercised by calling `emitConversationTriggerForMessage`
 * directly with the persisted SYSTEM message id — the bridge's only job is
 * to relay that call, so testing the boundary it crosses is equivalent.
 */
describe('action-bearing signal × trigger emission (integration)', () => {
  const FLOW_ID = 'feature-sync';
  const NODE_ID = 'iterate';
  const SYSTEM_MESSAGE_ID = '00000000-0000-4000-8000-000000000sys' as MessageId;
  const RECIPIENT = {
    machineId: 'machine-int-1',
    userId: 'user-int-1',
    agentSessionId: 'session-int-1',
    projectId: testIds.project,
  };
  const SIGNED_ENVELOPE = { signature: 'sig-int', nonce: 'nonce-int' };

  let messageProcessor: MessageProcessor;
  let triggerEmitter: TriggerEmitter;
  let mockMessageService: jest.Mocked<MessageService>;
  let mockTemporalClient: jest.Mocked<Client>;
  let mockConversationService: jest.Mocked<ConversationService>;
  let mockFlowExecutionService: jest.Mocked<FlowExecutionService>;
  let mockNodeExecutionService: jest.Mocked<NodeExecutionService>;
  // TriggerEmitter collaborators
  let mockPrisma: { db: { message: { findUnique: jest.Mock } } };
  let mockResolver: {
    resolveConversationRecipient: jest.Mock;
    resolveMachineForUser: jest.Mock;
  };
  let mockSigner: {
    signConversationTrigger: jest.Mock;
    signConversationTriggerAuthorized: jest.Mock;
    signPlatformEvent: jest.Mock;
  };
  let mockGateway: {
    emitConversationTrigger: jest.Mock;
    emitPlatformEventTrigger: jest.Mock;
  };
  let mockExecutableFrameAuthorization: {
    resolveSelectedAuthorization: jest.Mock;
    resolveBoundedGrant: jest.Mock;
  };

  const createActionBearingUserMessageEvent = (): MessageCreatedEvent => ({
    id: testIds.event,
    type: 'message.created',
    aggregateId: testIds.message,
    payload: {
      payloadType: 'message.created',
      organizationId: testIds.organization,
      projectId: testIds.project,
      message: {
        type: 'USER',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        parentMessageId: testIds.parentMessage,
        shouldProcess: true,
      } as unknown as MessageCreatedUserMessage,
    },
  });

  beforeEach(async () => {
    mockMessageService = TestUtils.createMockMessageService();
    mockTemporalClient = TestUtils.createMockTemporalClient();
    const mockEventPublisher: jest.Mocked<DomainEventPublisher> =
      TestUtils.createMockDomainEventPublisher();
    const mockEventRouter = {
      on: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<EventRouter>;
    mockConversationService =
      TestUtils.createMockConversationService() as jest.Mocked<ConversationService>;
    mockFlowExecutionService = {
      findActiveByConversation: jest.fn().mockResolvedValue(null),
      findByConversation: jest.fn().mockResolvedValue(null),
      findPausedByConversation: jest.fn().mockResolvedValue(null),
      updateFlowState: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<FlowExecutionService>;
    const mockConversationWorkflowService = {
      startWorkflowForExistingConversation: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ConversationWorkflowService>;
    mockNodeExecutionService = {
      getNode: jest.fn(),
      getFlow: jest.fn(),
    } as unknown as jest.Mocked<NodeExecutionService>;
    const redisMockProvider = createRedisServiceMock();
    const mockRedisService =
      redisMockProvider.useValue as unknown as jest.Mocked<RedisService>;
    void mockRedisService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageProcessor,
        { provide: MessageService, useValue: mockMessageService },
        { provide: 'TEMPORAL_CLIENT', useValue: mockTemporalClient },
        { provide: EventRouter, useValue: mockEventRouter },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
        { provide: ConversationService, useValue: mockConversationService },
        {
          provide: FlowExecutionService,
          useValue: mockFlowExecutionService,
        },
        {
          provide: ConversationWorkflowService,
          useValue: mockConversationWorkflowService,
        },
        {
          provide: NodeExecutionService,
          useValue: mockNodeExecutionService,
        },
        redisMockProvider,
      ],
    }).compile();

    messageProcessor = module.get<MessageProcessor>(MessageProcessor);

    // Wire the real TriggerEmitter with mocked boundary collaborators.
    mockPrisma = { db: { message: { findUnique: jest.fn() } } };
    mockResolver = {
      resolveConversationRecipient: jest.fn().mockResolvedValue(RECIPIENT),
      resolveMachineForUser: jest.fn().mockResolvedValue(RECIPIENT),
    };
    mockSigner = {
      signConversationTrigger: jest.fn().mockReturnValue(SIGNED_ENVELOPE),
      signConversationTriggerAuthorized: jest
        .fn()
        .mockReturnValue(SIGNED_ENVELOPE),
      signPlatformEvent: jest.fn().mockReturnValue(SIGNED_ENVELOPE),
    };
    mockGateway = {
      emitConversationTrigger: jest.fn(),
      emitPlatformEventTrigger: jest.fn(),
    };
    mockExecutableFrameAuthorization = {
      resolveSelectedAuthorization: jest.fn().mockResolvedValue({
        kind: 'bounded_grant',
        grantId: 'grant-int-1',
      }),
      resolveBoundedGrant: jest.fn().mockResolvedValue({
        kind: 'bounded_grant',
        grantId: 'grant-int-1',
        target: {
          kind: 'AGENT_SESSION',
          id: RECIPIENT.agentSessionId,
          revision: null,
        },
        agentSessionId: RECIPIENT.agentSessionId,
        authorizedTurnId: SYSTEM_MESSAGE_ID,
        taskMonitorId: null,
      }),
    };
    triggerEmitter = new TriggerEmitter(
      mockPrisma as never,
      mockResolver as never,
      mockSigner as never,
      mockGateway as never,
      mockExecutableFrameAuthorization as never,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('action-bearing USER remains evidence, then EXTERNAL_AGENT trigger emits exactly one trigger.conversation frame', async () => {
    // Phase A — action-bearing USER lands on a live engine-bound conversation.
    // QUESTIONS field-keyed shape (browser-side submission). The gating
    // predicate normalizes this via the same flattener used by the retired
    // generic signaling path. It remains action-bearing evidence, but does
    // not route a generic USER message into Temporal.
    const storedUserMessage = TestUtils.createMockMessage({
      id: testIds.message,
      type: 'USER',
      conversationId: testIds.conversation,
      projectId: testIds.project,
      data: {
        'field-id-approve-reject': {
          action: 'approve',
          payload: { reason: 'lgtm' },
        },
      },
    }) as UserMessage;
    mockMessageService.getMessage.mockResolvedValue(storedUserMessage);
    mockConversationService.findOne.mockResolvedValue(
      TestUtils.createMockConversation({
        id: testIds.conversation,
        workflowId: testIds.workflow,
        workflowName: FLOW_ID,
      }),
    );
    (
      mockFlowExecutionService.findByConversation as jest.Mock
    ).mockResolvedValue({
      id: 'flow-execution-id',
      flowId: FLOW_ID,
      status: 'IN_PROGRESS',
      currentNode: NODE_ID,
      flowState: null,
      resumable: true,
      startedAt: new Date(),
      completedAt: null,
    });
    (mockNodeExecutionService.getFlow as jest.Mock).mockReturnValue({
      id: FLOW_ID,
      name: 'Feature Sync',
      description: 'test flow',
      version: 1,
      nodes: {},
      startNode: NODE_ID,
    });
    (mockNodeExecutionService.getNode as jest.Mock).mockReturnValue({
      node: {
        id: NODE_ID,
        type: NodeType.EXTERNAL_AGENT,
        twoPhase: true,
        acceptsUserMessages: true,
      },
      routing: { transitions: {} },
    });
    const workflowHandle = {
      signal: jest.fn().mockResolvedValue(undefined),
    };
    (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
      workflowHandle,
    );

    await messageProcessor['handleUserMessageCreated'](
      createActionBearingUserMessageEvent(),
    );

    // The processor authors no follow-up message for a USER turn.
    expect(mockMessageService.addMessage).not.toHaveBeenCalled();
    // Generic USER creation is evidence only; workflow routing belongs to the
    // dedicated workflow-answer operation.
    expect(workflowHandle.signal).not.toHaveBeenCalled();

    // Phase B — EXTERNAL_AGENT persists a SYSTEM message carrying its own
    // `data.triggersAgent`. The bridge's `conversation.updated.messageAdded`
    // handler simply calls `emitConversationTriggerForMessage(...)` with
    // the new id, so calling that directly exercises the same boundary.
    const externalAgentTriggerBody = {
      promptType: 'feature_sync_iterate',
      nodeId: 'feature-sync-iterate',
      triggerMessageId: SYSTEM_MESSAGE_ID,
      payload: { iteration: 3 },
    };
    mockPrisma.db.message.findUnique.mockResolvedValue({
      data: { triggersAgent: externalAgentTriggerBody },
    });

    await triggerEmitter.emitConversationTriggerForMessage({
      conversationId: testIds.conversation as ConversationId,
      messageId: SYSTEM_MESSAGE_ID,
      organizationId: testIds.organization as OrganizationId,
    });

    // Recipient resolved against the engine-bound conversation.
    expect(mockResolver.resolveConversationRecipient).toHaveBeenCalledWith(
      testIds.conversation,
    );
    // Envelope was signed for the resolved machine.
    expect(mockSigner.signConversationTriggerAuthorized).toHaveBeenCalledWith(
      externalAgentTriggerBody,
      RECIPIENT.machineId,
      RECIPIENT.userId,
      expect.objectContaining({ grantId: 'grant-int-1' }),
    );
    // Exactly one trigger.conversation frame was emitted to that machine.
    expect(mockGateway.emitConversationTrigger).toHaveBeenCalledTimes(1);
    const emittedFrame = mockGateway.emitConversationTrigger.mock.calls[0][0];
    expect(emittedFrame.type).toBe('trigger.conversation');
    expect(emittedFrame.conversationId).toBe(testIds.conversation);
    expect(emittedFrame.userId).toBe(RECIPIENT.userId);
    expect(emittedFrame.envelope).toBe(SIGNED_ENVELOPE);
  });

  // AC #2 — Recipient resolution path is conversation → AgentSession.userId →
  // Machine, and is independent of the USER message's authoring identity.
  // We vary the USER message id (the per-submission identity that
  // distinguishes one client's tap from another's) while holding the
  // AgentSession owner — i.e. the conversation — constant, and assert the
  // resolver is consulted with the conversation id (and only the
  // conversation id) on every run.
  it('recipient resolution is invariant to USER message author / device (AC #2)', async () => {
    mockConversationService.findOne.mockResolvedValue(
      TestUtils.createMockConversation({
        id: testIds.conversation,
        workflowId: testIds.workflow,
        workflowName: FLOW_ID,
      }),
    );
    (
      mockFlowExecutionService.findByConversation as jest.Mock
    ).mockResolvedValue({
      id: 'flow-execution-id',
      flowId: FLOW_ID,
      status: 'IN_PROGRESS',
      currentNode: NODE_ID,
      flowState: null,
      resumable: true,
      startedAt: new Date(),
      completedAt: null,
    });
    (mockNodeExecutionService.getFlow as jest.Mock).mockReturnValue({
      id: FLOW_ID,
      name: 'Feature Sync',
      description: 'test flow',
      version: 1,
      nodes: {},
      startNode: NODE_ID,
    });
    (mockNodeExecutionService.getNode as jest.Mock).mockReturnValue({
      node: {
        id: NODE_ID,
        type: NodeType.EXTERNAL_AGENT,
        twoPhase: true,
        acceptsUserMessages: true,
      },
      routing: { transitions: {} },
    });
    const workflowHandle = {
      signal: jest.fn().mockResolvedValue(undefined),
    };
    (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
      workflowHandle,
    );

    const externalAgentTriggerBody = {
      promptType: 'feature_sync_iterate',
      nodeId: 'feature-sync-iterate',
      triggerMessageId: SYSTEM_MESSAGE_ID,
      payload: { iteration: 3 },
    };
    mockPrisma.db.message.findUnique.mockResolvedValue({
      data: { triggersAgent: externalAgentTriggerBody },
    });

    const runFlowFor = async (userMessageId: string): Promise<void> => {
      const storedUserMessage = TestUtils.createMockMessage({
        id: userMessageId as MessageId,
        type: 'USER',
        conversationId: testIds.conversation,
        projectId: testIds.project,
        data: {
          'field-id-approve-reject': {
            action: 'approve',
            payload: { reason: 'lgtm' },
          },
        },
      }) as UserMessage;
      mockMessageService.getMessage.mockResolvedValue(storedUserMessage);

      await messageProcessor['handleUserMessageCreated']({
        ...createActionBearingUserMessageEvent(),
        aggregateId: userMessageId as MessageId,
      });

      await triggerEmitter.emitConversationTriggerForMessage({
        conversationId: testIds.conversation as ConversationId,
        messageId: SYSTEM_MESSAGE_ID,
        organizationId: testIds.organization as OrganizationId,
      });
    };

    // Two runs with two different USER-message identities; the AgentSession
    // owner (which the recipient resolver actually keys on) is unchanged.
    await runFlowFor('00000000-0000-4000-8000-00000000host');
    await runFlowFor('00000000-0000-4000-8000-0000nonhost1');

    // The resolver was consulted twice, each time keyed only on the
    // conversation id. The varying USER message identity never reaches it.
    expect(mockResolver.resolveConversationRecipient).toHaveBeenCalledTimes(2);
    expect(mockResolver.resolveConversationRecipient.mock.calls[0]).toEqual([
      testIds.conversation,
    ]);
    expect(mockResolver.resolveConversationRecipient.mock.calls[1]).toEqual([
      testIds.conversation,
    ]);

    // Both runs emitted a frame addressed to the same machine binding,
    // independent of which client authored the USER message.
    expect(mockGateway.emitConversationTrigger).toHaveBeenCalledTimes(2);
    const firstFrame = mockGateway.emitConversationTrigger.mock.calls[0][0];
    const secondFrame = mockGateway.emitConversationTrigger.mock.calls[1][0];
    expect(firstFrame.userId).toBe(RECIPIENT.userId);
    expect(secondFrame.userId).toBe(RECIPIENT.userId);
    expect(firstFrame.envelope).toBe(SIGNED_ENVELOPE);
    expect(secondFrame.envelope).toBe(SIGNED_ENVELOPE);
  });

  // AC #3 — Host-offline failure mode. The recipient resolver returns null
  // (no active paired machine for the AgentSession's user). The emitter
  // must short-circuit: no signing, no gateway emit, no offline-buffer
  // side effect, and the `[trigger-emit] DROP no recipient` warn fires.
  it('host offline → drop with no_recipient, no envelope reaches gateway, nothing buffered (AC #3)', async () => {
    const storedUserMessage = TestUtils.createMockMessage({
      id: testIds.message,
      type: 'USER',
      conversationId: testIds.conversation,
      projectId: testIds.project,
      data: {
        'field-id-approve-reject': {
          action: 'approve',
          payload: { reason: 'lgtm' },
        },
      },
    }) as UserMessage;
    mockMessageService.getMessage.mockResolvedValue(storedUserMessage);
    mockConversationService.findOne.mockResolvedValue(
      TestUtils.createMockConversation({
        id: testIds.conversation,
        workflowId: testIds.workflow,
        workflowName: FLOW_ID,
      }),
    );
    (
      mockFlowExecutionService.findByConversation as jest.Mock
    ).mockResolvedValue({
      id: 'flow-execution-id',
      flowId: FLOW_ID,
      status: 'IN_PROGRESS',
      currentNode: NODE_ID,
      flowState: null,
      resumable: true,
      startedAt: new Date(),
      completedAt: null,
    });
    (mockNodeExecutionService.getFlow as jest.Mock).mockReturnValue({
      id: FLOW_ID,
      name: 'Feature Sync',
      description: 'test flow',
      version: 1,
      nodes: {},
      startNode: NODE_ID,
    });
    (mockNodeExecutionService.getNode as jest.Mock).mockReturnValue({
      node: {
        id: NODE_ID,
        type: NodeType.EXTERNAL_AGENT,
        twoPhase: true,
        acceptsUserMessages: true,
      },
      routing: { transitions: {} },
    });
    const workflowHandle = {
      signal: jest.fn().mockResolvedValue(undefined),
    };
    (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
      workflowHandle,
    );

    // Host machine is revoked / disconnected → resolver returns null.
    mockResolver.resolveConversationRecipient.mockResolvedValue(null);

    const externalAgentTriggerBody = {
      promptType: 'feature_sync_iterate',
      nodeId: 'feature-sync-iterate',
      triggerMessageId: SYSTEM_MESSAGE_ID,
      payload: { iteration: 3 },
    };
    mockPrisma.db.message.findUnique.mockResolvedValue({
      data: { triggersAgent: externalAgentTriggerBody },
    });

    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});

    await messageProcessor['handleUserMessageCreated'](
      createActionBearingUserMessageEvent(),
    );
    await triggerEmitter.emitConversationTriggerForMessage({
      conversationId: testIds.conversation as ConversationId,
      messageId: SYSTEM_MESSAGE_ID,
      organizationId: testIds.organization as OrganizationId,
    });

    // Resolver was consulted and returned null.
    expect(mockResolver.resolveConversationRecipient).toHaveBeenCalledWith(
      testIds.conversation,
    );
    // No signing happened.
    expect(mockSigner.signConversationTrigger).not.toHaveBeenCalled();
    // No frame reached the gateway.
    expect(mockGateway.emitConversationTrigger).not.toHaveBeenCalled();
    // The drop reason fires on the emitter's logger.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[trigger-emit] DROP no recipient'),
    );
    // No offline-buffer side effect: the processor authored no message to
    // stand in for the dropped trigger.
    expect(mockMessageService.addMessage).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
