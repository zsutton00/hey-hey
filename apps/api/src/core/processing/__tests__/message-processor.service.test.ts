/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { Client } from '@temporalio/client';
import {
  MessageCreatedEvent,
  MessageUpdatedEvent,
} from '../../events/types/domain-events';
import { EventEnvelope } from '../../events/types/event-envelope';
import { MessageService } from '../../../services/message.service';
import { MessageProcessor } from '../message-processor.service';
import { DomainEventPublisher } from '../../events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../events/tokens';
import { WorkflowSignals } from '../../../utils/workflow-signals.util';
import { MessageStatus } from '../../../constants/message-status.constants';
import {
  CreateSystemMessage,
  MessageCreatedUserMessage,
  SystemMessage,
  UserMessage,
} from '../../../generated';
import { MessageUpdatedEventPayloadAllOfUpdate } from '../../../generated/model/messageUpdatedEventPayloadAllOfUpdate';
import { buildMessageCreatedEventPayload } from '../../../utils/message-event.util';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../../types';
import * as TestUtils from '../../../utils/testUtils';

// Import the new service classes
import { EventRouter } from '../../events/event-router';
import { ConversationService } from '../../../services/conversation.service';
import { FlowExecutionService } from '../../../services/workflows/flow-execution.service';
import { ConversationWorkflowService } from '../../../services/workflows/conversation-workflow.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { NodeType } from '../../../types/flow-internal.types';
import { RedisService } from '../../redis/redis.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';

const { testIds } = TestUtils;

describe('MessageProcessor', () => {
  let messageProcessor: MessageProcessor;
  let mockMessageService: jest.Mocked<MessageService>;
  let mockTemporalClient: jest.Mocked<Client>;
  let mockEventPublisher: jest.Mocked<DomainEventPublisher>;
  let mockEventRouter: jest.Mocked<EventRouter>;
  let mockConversationService: jest.Mocked<ConversationService>;
  let mockFlowExecutionService: jest.Mocked<FlowExecutionService>;
  let mockConversationWorkflowService: jest.Mocked<ConversationWorkflowService>;
  let mockNodeExecutionService: jest.Mocked<NodeExecutionService>;
  let mockRedisService: jest.Mocked<RedisService>;

  beforeEach(async () => {
    mockMessageService = TestUtils.createMockMessageService();
    mockTemporalClient = TestUtils.createMockTemporalClient();
    mockEventPublisher = TestUtils.createMockDomainEventPublisher();
    mockEventRouter = {
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
    mockConversationWorkflowService = {
      startWorkflowForExistingConversation: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ConversationWorkflowService>;
    mockNodeExecutionService = {
      getNode: jest.fn(),
      getFlow: jest.fn(),
    } as unknown as jest.Mocked<NodeExecutionService>;
    const redisMockProvider = createRedisServiceMock();
    mockRedisService =
      redisMockProvider.useValue as unknown as jest.Mocked<RedisService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageProcessor,
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
        {
          provide: EventRouter,
          useValue: mockEventRouter,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
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
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize without throwing errors', () => {
      expect(messageProcessor).toBeDefined();
    });

    it('should track singleton instances', () => {
      const loggerSpy = jest.spyOn(Logger.prototype, 'log');

      // Create another instance in test mode (should not throw)
      const anotherProcessor = new MessageProcessor(
        mockMessageService,
        mockTemporalClient,
        mockEventRouter,
        mockEventPublisher,
        mockConversationService,
        mockFlowExecutionService,
        mockConversationWorkflowService,
        mockNodeExecutionService,
        mockRedisService,
      );

      expect(anotherProcessor).toBeDefined();
      const initCall = loggerSpy.mock.calls.find(([msg]) =>
        `${msg}`.includes(
          'MessageProcessor initialized for workflow signaling',
        ),
      );
      expect(initCall).toBeDefined();
    });
  });

  describe('handleUserMessageCreated', () => {
    const createUserMessageEvent = (
      overrides: Partial<MessageCreatedEvent> = {},
    ): MessageCreatedEvent => ({
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
          parentMessage: {
            id: testIds.parentMessage,
            content: 'Parent message content',
          },
          shouldProcess: true,
        } as unknown as MessageCreatedUserMessage,
      },
      ...overrides,
    });

    it('should return early if message type is not USER', async () => {
      const event = createUserMessageEvent({
        payload: {
          payloadType: 'message.created',
          organizationId: testIds.organization,
          projectId: testIds.project,
          message: {
            type: 'SYSTEM',
            workflowId: testIds.workflow,
            projectId: testIds.project,
            conversationId: testIds.conversation,
            parentMessageId: undefined,
            shouldProcess: false,
          } as unknown as MessageCreatedUserMessage,
        },
      });

      await messageProcessor['handleUserMessageCreated'](event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
    });

    it('should not signal Temporal when conversation has no workflowId', async () => {
      const event = createUserMessageEvent({
        payload: {
          payloadType: 'message.created',
          organizationId: testIds.organization,
          projectId: testIds.project,
          message: {
            type: 'USER',
            workflowId: undefined as unknown as WorkflowId,
            projectId: testIds.project,
            conversationId: testIds.conversation,
            parentMessageId: testIds.parentMessage,
            parentMessage: {
              id: testIds.parentMessage,
              content: 'Parent message content',
            },
            shouldProcess: false,
          } as unknown as MessageCreatedUserMessage,
        },
      });

      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'USER',
        conversationId: testIds.conversation,
      }) as UserMessage;
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: undefined,
        }),
      );

      await messageProcessor['handleUserMessageCreated'](event);

      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
    });

    it('should return early if stored message is not found', async () => {
      const event = createUserMessageEvent();
      mockMessageService.getMessage.mockResolvedValue(null);

      await messageProcessor['handleUserMessageCreated'](event);

      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
    });

    it('should process user message successfully', async () => {
      const event = createUserMessageEvent();
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'USER',
        conversationId: testIds.conversation,
        data: { message: 'Test user message' },
      }) as UserMessage;

      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
        }),
      );

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      await messageProcessor['handleUserMessageCreated'](event);

      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(mockWorkflowHandle.signal).not.toHaveBeenCalled();
    });

    describe.skip('retired QUESTIONS field-action bridge', () => {
      const FIELD_ID = '28c1d1a9-6c3d-4878-848c-39de9f460aac';

      const setupSignal = (data: Record<string, unknown>) => {
        const event = createUserMessageEvent();
        const storedMessage = TestUtils.createMockMessage({
          id: testIds.message,
          type: 'USER',
          conversationId: testIds.conversation,
          data,
        }) as UserMessage;
        mockMessageService.getMessage.mockResolvedValue(storedMessage);
        mockConversationService.findOne.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: testIds.workflow,
          }),
        );
        const mockWorkflowHandle = { signal: jest.fn() };
        (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
          mockWorkflowHandle,
        );
        return { event, storedMessage, mockWorkflowHandle };
      };

      it('flattens a field-keyed {action, payload} entry to top-level data.action / data.payload before signaling', async () => {
        const fieldKeyedData = {
          [FIELD_ID]: {
            action: 'approve_all',
            payload: { feedback: '' },
          },
        };
        const { event, mockWorkflowHandle } = setupSignal(fieldKeyedData);

        await messageProcessor['handleUserMessageCreated'](event);

        expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
          WorkflowSignals.getWorkflowUserMessageSignalName(testIds.workflow),
          expect.objectContaining({
            data: expect.objectContaining({
              action: 'approve_all',
              payload: { feedback: '' },
              [FIELD_ID]: { action: 'approve_all', payload: { feedback: '' } },
            }),
          }),
        );
      });

      it('is idempotent — already-flat data.action passes through unchanged', async () => {
        const flatData = {
          action: 'approve_all',
          payload: { feedback: 'already flat' },
        };
        const { event, mockWorkflowHandle } = setupSignal(flatData);

        await messageProcessor['handleUserMessageCreated'](event);

        expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
          WorkflowSignals.getWorkflowUserMessageSignalName(testIds.workflow),
          expect.objectContaining({ data: flatData }),
        );
      });

      it('passes free-text submissions through unchanged when no field-keyed action entry is present', async () => {
        const freeTextData = { comment: 'plain user reply' };
        const { event, mockWorkflowHandle } = setupSignal(freeTextData);

        await messageProcessor['handleUserMessageCreated'](event);

        expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
          WorkflowSignals.getWorkflowUserMessageSignalName(testIds.workflow),
          expect.objectContaining({ data: freeTextData }),
        );
      });

      it('does not mutate the stored message — flatten produces a shallow clone for the signal only', async () => {
        const fieldKeyedData = {
          [FIELD_ID]: {
            action: 'continue_revising',
            payload: { feedback: 'tweak stage 2' },
          },
        };
        const { event, storedMessage } = setupSignal(fieldKeyedData);

        await messageProcessor['handleUserMessageCreated'](event);

        expect(storedMessage.data).toEqual(fieldKeyedData);
        expect(
          (storedMessage.data as Record<string, unknown>).action,
        ).toBeUndefined();
      });
    });

    it('should handle parent message completion when parent exists', async () => {
      const event = createUserMessageEvent();
      const parentMessage = TestUtils.createMockMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        status: MessageStatus.Open,
      }) as SystemMessage;
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'USER',
        parentMessageId: testIds.parentMessage,
      }) as UserMessage;

      mockMessageService.getMessage
        .mockResolvedValueOnce(storedMessage)
        .mockResolvedValueOnce(parentMessage);

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      await messageProcessor['handleUserMessageCreated'](event);

      expect(mockMessageService.getMessage).toHaveBeenCalledTimes(2);
      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        testIds.parentMessage,
        testIds.organization,
        { status: MessageStatus.Completed },
        {
          source: 'handleUserMessageCreatedEvent',
          suppressConversationEvent: true,
        },
      );
    });

    it('short-circuits with no Temporal dispatch when the USER row is stamped with data.triggersAgent at create time', async () => {
      // The controller stamps `data.triggersAgent` onto the USER row before
      // insert for the promptType / non-Temporal-workflowName / terminated-
      // workflowName cases. A stamped row has already emitted its trigger
      // frame via the create-path projection, so the processor owes no
      // post-commit Temporal side-effect: no conversation lookup, no signal,
      // no resume.
      const event = createUserMessageEvent();
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'USER',
        conversationId: testIds.conversation,
        data: {
          message: 'stamped user turn',
          triggersAgent: {
            operationId: '55555555-5555-4555-8555-555555555555',
            operationFingerprint: '0'.repeat(64),
            promptType: 'user_message',
            triggerMessageId: testIds.message,
            sourceUserMessageId: testIds.message,
            admittedServiceScope: { serviceIds: [], launchServiceId: null },
            payload: {
              handlerPromptType: 'feature_sync_analyze',
              userMessage: 'stamped user turn',
              attachments: [],
            },
          },
        },
      }) as UserMessage;
      mockMessageService.getMessage.mockResolvedValue(storedMessage);

      await messageProcessor['handleUserMessageCreated'](event);

      expect(mockConversationService.findOne).not.toHaveBeenCalled();
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(
        mockFlowExecutionService.findPausedByConversation,
      ).not.toHaveBeenCalled();
      expect(mockMessageService.addMessage).not.toHaveBeenCalled();
    });

    it('still completes the parent message before short-circuiting on a stamped row', async () => {
      const event = createUserMessageEvent();
      const parentMessage = TestUtils.createMockMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        status: MessageStatus.Open,
      }) as SystemMessage;
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'USER',
        conversationId: testIds.conversation,
        parentMessageId: testIds.parentMessage,
        data: {
          message: 'stamped user turn',
          triggersAgent: {
            operationId: '55555555-5555-4555-8555-555555555555',
            operationFingerprint: '0'.repeat(64),
            promptType: 'user_message',
            triggerMessageId: testIds.message,
            sourceUserMessageId: testIds.message,
            admittedServiceScope: { serviceIds: [], launchServiceId: null },
            payload: {
              handlerPromptType: 'implement',
              userMessage: 'x',
              attachments: [],
            },
          },
        },
      }) as UserMessage;

      mockMessageService.getMessage
        .mockResolvedValueOnce(storedMessage)
        .mockResolvedValueOnce(parentMessage);

      await messageProcessor['handleUserMessageCreated'](event);

      // Parent completion runs regardless of the stamp short-circuit.
      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        testIds.parentMessage,
        testIds.organization,
        { status: MessageStatus.Completed },
        {
          source: 'handleUserMessageCreatedEvent',
          suppressConversationEvent: true,
        },
      );
      // No Temporal side-effect owed for a stamped row.
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
    });

    describe.skip('retired generic workflow signal errors', () => {
      it('should handle workflow not found error gracefully', async () => {
        const event = createUserMessageEvent();
        const storedMessage = TestUtils.createMockMessage({
          type: 'USER',
          conversationId: testIds.conversation,
        }) as UserMessage;

        mockMessageService.getMessage.mockResolvedValue(storedMessage);
        mockConversationService.findOne.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: testIds.workflow,
          }),
        );

        const mockWorkflowHandle = {
          signal: jest.fn().mockRejectedValue({
            name: 'WorkflowNotFoundError',
            message: 'Workflow not found',
          }),
        };
        (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
          mockWorkflowHandle,
        );

        const loggerSpy = jest.spyOn(Logger.prototype, 'warn');

        await messageProcessor['handleUserMessageCreated'](event);

        const warnCall = loggerSpy.mock.calls.find(([msg]) => {
          const text = `${msg}`;
          return text.includes('[signalWorkflow] Signal failed');
        });
        expect(warnCall).toBeDefined();
      });

      it('should handle non-workflow-not-found errors and log them', async () => {
        const event = createUserMessageEvent();
        const storedMessage = TestUtils.createMockMessage({
          type: 'USER',
          conversationId: testIds.conversation,
        }) as UserMessage;

        mockMessageService.getMessage.mockResolvedValue(storedMessage);
        mockConversationService.findOne.mockResolvedValue(
          TestUtils.createMockConversation({
            id: testIds.conversation,
            workflowId: testIds.workflow,
          }),
        );

        const mockWorkflowHandle = {
          signal: jest.fn().mockRejectedValue({
            name: 'OtherError',
            message: 'Some other error',
          }),
        };
        (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
          mockWorkflowHandle,
        );

        const loggerSpy = jest.spyOn(Logger.prototype, 'error');

        await messageProcessor['handleUserMessageCreated'](event);

        // Verify that both error logs are called: signal error and overall processing error
        const signalError = loggerSpy.mock.calls.find(([msg]) =>
          `${msg}`.includes(
            '[signalWorkflow] Unexpected signal error - not a workflow-gone error',
          ),
        );
        const processingError = loggerSpy.mock.calls.find(([msg]) =>
          `${msg}`.includes(
            `[handleUserMessageCreated] FAILED TO PROCESS USER MESSAGE EVENT ${testIds.message}:`,
          ),
        );
        expect(signalError).toBeDefined();
        expect(processingError).toBeDefined();
      });
    });

    it('should handle errors during event processing', async () => {
      const event = createUserMessageEvent();
      mockMessageService.getMessage.mockRejectedValue(
        new Error('Database error'),
      );

      const loggerSpy = jest.spyOn(Logger.prototype, 'error');

      await messageProcessor['handleUserMessageCreated'](event);

      const errCall = loggerSpy.mock.calls.find(([msg]) =>
        `${msg}`.includes(
          `[handleUserMessageCreated] FAILED TO PROCESS USER MESSAGE EVENT ${testIds.message}:`,
        ),
      );
      expect(errCall).toBeDefined();
    });

    describe.skip('retired acceptsUserMessages signal gate', () => {
      const FLOW_ID = 'feature-sync';
      const NODE_ID = 'iterate';

      type AcceptsGateSetupOptions = {
        nodeAccepts?: boolean;
        workflowAccepts?: boolean;
        omitNode?: boolean;
      };

      const setupAcceptsGate = ({
        nodeAccepts,
        workflowAccepts,
        omitNode,
      }: AcceptsGateSetupOptions) => {
        const event = createUserMessageEvent();
        const storedMessage = TestUtils.createMockMessage({
          id: testIds.message,
          type: 'USER',
          conversationId: testIds.conversation,
          data: { message: 'paused-node reply' },
        }) as UserMessage;

        mockMessageService.getMessage.mockResolvedValue(storedMessage);
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
          ...(workflowAccepts !== undefined
            ? { acceptsUserMessages: workflowAccepts }
            : {}),
        });
        (mockNodeExecutionService.getNode as jest.Mock).mockReturnValue(
          omitNode
            ? undefined
            : {
                node: {
                  id: NODE_ID,
                  type: NodeType.EXTERNAL_AGENT,
                  twoPhase: true,
                  ...(nodeAccepts !== undefined
                    ? { acceptsUserMessages: nodeAccepts }
                    : {}),
                },
                routing: { transitions: {} },
              },
        );

        const handle = {
          signal: jest.fn().mockResolvedValue(undefined),
        };
        (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
          handle,
        );

        return { event, handle };
      };

      it('skips signalWorkflow when node.acceptsUserMessages=false', async () => {
        const { event, handle } = setupAcceptsGate({ nodeAccepts: false });
        const debugSpy = jest.spyOn(Logger.prototype, 'debug');

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).not.toHaveBeenCalled();
        expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
        const skipLog = debugSpy.mock.calls.find(([msg]) => {
          const text = `${msg}`;
          return (
            text.includes(
              '[handleUserMessageCreated] skipping signalWorkflow',
            ) && text.includes('"resolvedFrom": "node"')
          );
        });
        expect(skipLog).toBeDefined();
      });

      it('skips signalWorkflow when workflow.acceptsUserMessages=false and node is unset', async () => {
        const { event, handle } = setupAcceptsGate({
          workflowAccepts: false,
        });
        const debugSpy = jest.spyOn(Logger.prototype, 'debug');

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).not.toHaveBeenCalled();
        const skipLog = debugSpy.mock.calls.find(([msg]) => {
          const text = `${msg}`;
          return (
            text.includes(
              '[handleUserMessageCreated] skipping signalWorkflow',
            ) && text.includes('"resolvedFrom": "workflow"')
          );
        });
        expect(skipLog).toBeDefined();
      });

      it('calls signalWorkflow when both node and workflow are unset (baseline)', async () => {
        const { event, handle } = setupAcceptsGate({});

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).toHaveBeenCalledWith(
          WorkflowSignals.getWorkflowUserMessageSignalName(testIds.workflow),
          expect.objectContaining({
            id: testIds.message,
            type: 'USER',
          }),
        );
      });

      it('calls signalWorkflow when node=true overrides workflow=false', async () => {
        const { event, handle } = setupAcceptsGate({
          nodeAccepts: true,
          workflowAccepts: false,
        });

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).toHaveBeenCalledTimes(1);
      });
    });

    describe.skip('retired generic USER signal path', () => {
      // Unstamped USER rows on a live Temporal-backed workflow reach the
      // signal path. Action-bearing submissions (QUESTIONS gate button clicks)
      // ALWAYS signal so the node advances; free-text submissions are gated by
      // acceptsUserMessages so agent-driven nodes suppress free-text without
      // dropping it from the conversation log. (aa892c1d coverage, retained.)
      const FLOW_ID = 'feature-sync';
      const NODE_ID = 'iterate';

      const setupGate = (
        data: Record<string, unknown>,
        nodeAccepts: boolean,
      ) => {
        const event = createUserMessageEvent();
        const storedMessage = TestUtils.createMockMessage({
          id: testIds.message,
          type: 'USER',
          conversationId: testIds.conversation,
          projectId: testIds.project,
          data,
        }) as UserMessage;
        mockMessageService.getMessage.mockResolvedValue(storedMessage);
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
            acceptsUserMessages: nodeAccepts,
          },
          routing: { transitions: {} },
        });
        const handle = { signal: jest.fn().mockResolvedValue(undefined) };
        (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
          handle,
        );
        return { event, handle };
      };

      it('signals an action-bearing (already-flat) USER message even when acceptsUserMessages=false', async () => {
        const { event, handle } = setupGate(
          { action: 'approve', payload: { reason: 'lgtm' } },
          false,
        );

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).toHaveBeenCalledTimes(1);
      });

      it('signals an action-bearing (field-keyed) USER message even when acceptsUserMessages=false', async () => {
        const { event, handle } = setupGate(
          { 'field-id-abc': { action: 'approve', payload: { reason: 'ok' } } },
          false,
        );

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).toHaveBeenCalledTimes(1);
      });

      it('suppresses a free-text USER message when acceptsUserMessages=false', async () => {
        const { event, handle } = setupGate(
          { message: 'plain free text' },
          false,
        );

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).not.toHaveBeenCalled();
      });

      it('signals a free-text USER message when acceptsUserMessages=true', async () => {
        const { event, handle } = setupGate(
          { message: 'plain free text' },
          true,
        );

        await messageProcessor['handleUserMessageCreated'](event);

        expect(handle.signal).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('handleUserMessageUpdatedEvent', () => {
    it('should be a stub that does nothing', async () => {
      const event = {
        id: testIds.event,
        type: 'message.updated',
        aggregateId: testIds.message,
        payload: {
          payloadType: 'message.updated',
          organizationId: testIds.organization,
          projectId: testIds.project,
          update: {
            shouldProcess: false,
            contentChanged: false,
          },
        },
      } as MessageUpdatedEvent;

      await expect(
        messageProcessor.handleUserMessageUpdatedEvent(event),
      ).resolves.toBeUndefined();
    });
  });

  describe('advanceContentUpdatedAtOnContentChange', () => {
    const createEvent = (contentChanged: boolean): MessageUpdatedEvent =>
      ({
        id: testIds.event,
        type: 'message.updated',
        aggregateId: testIds.message,
        payload: {
          payloadType: 'message.updated',
          organizationId: testIds.organization,
          projectId: testIds.project,
          update: { shouldProcess: false, contentChanged },
        },
      }) as MessageUpdatedEvent;

    beforeEach(() => {
      mockMessageService.advanceContentUpdatedAt = jest
        .fn()
        .mockResolvedValue(new Date());
    });

    it('advances contentUpdatedAt when the update changed content', async () => {
      await messageProcessor.advanceContentUpdatedAtOnContentChange(
        createEvent(true),
      );

      expect(mockMessageService.advanceContentUpdatedAt).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
    });

    it('leaves contentUpdatedAt alone for bookkeeping-only updates', async () => {
      await messageProcessor.advanceContentUpdatedAtOnContentChange(
        createEvent(false),
      );

      expect(mockMessageService.advanceContentUpdatedAt).not.toHaveBeenCalled();
    });
  });

  describe('handleSystemMessageUpdatedEvent', () => {
    const createSystemMessageUpdateEvent = (
      overrides: Partial<MessageUpdatedEvent> = {},
    ): MessageUpdatedEvent => ({
      id: testIds.event,
      type: 'message.updated',
      aggregateId: testIds.message,
      payload: {
        payloadType: 'message.updated',

        organizationId: testIds.organization,
        projectId: testIds.project,
        update: {
          status: MessageStatus.Completed,
          shouldProcess: true,
          contentChanged: false,
        },
      },
      ...overrides,
    });

    it('should return early if update data is missing', async () => {
      const event = createSystemMessageUpdateEvent({
        payload: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          update: undefined as unknown as MessageUpdatedEventPayloadAllOfUpdate,
          payloadType: 'message.updated',
        },
      });

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
    });

    it('should return early if organizationId is missing', async () => {
      const event = createSystemMessageUpdateEvent({
        payload: {
          organizationId: undefined as unknown as OrganizationId,
          projectId: testIds.project,
          update: {
            status: MessageStatus.Completed,
            shouldProcess: true,
            contentChanged: false,
          },
          payloadType: 'message.updated',
        },
      });

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
    });

    it('should return early if updated message is not found', async () => {
      const event = createSystemMessageUpdateEvent();
      mockMessageService.getMessage.mockResolvedValue(null);

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
    });

    it('should return early if updated message is not SYSTEM type', async () => {
      const event = createSystemMessageUpdateEvent();
      const updatedMessage = TestUtils.createMockMessage({
        type: 'USER',
      });
      mockMessageService.getMessage.mockResolvedValue(updatedMessage);

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
      expect(mockMessageService.updateMessage).not.toHaveBeenCalled();
    });

    it('should handle system message completion with parent message', async () => {
      const event = createSystemMessageUpdateEvent();
      const updatedMessage = TestUtils.createMockMessage({
        type: 'SYSTEM',
        status: MessageStatus.Completed,
        parentMessageId: testIds.parentMessage,
      }) as SystemMessage;
      const parentMessage = TestUtils.createMockMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        status: MessageStatus.Open,
      }) as SystemMessage;

      mockMessageService.getMessage
        .mockResolvedValueOnce(updatedMessage)
        .mockResolvedValueOnce(parentMessage);

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.getMessage).toHaveBeenCalledTimes(2);
      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        testIds.parentMessage,
        testIds.organization,
        { status: MessageStatus.Completed },
        {
          source: 'handleSystemMessageUpdatedEvent',
          suppressConversationEvent: true,
        },
      );
    });

    it('should not update parent if parent is already completed', async () => {
      const event = createSystemMessageUpdateEvent();
      const updatedMessage = TestUtils.createMockMessage({
        type: 'SYSTEM',
        status: MessageStatus.Completed,
        parentMessageId: testIds.parentMessage,
      }) as SystemMessage;
      const parentMessage = TestUtils.createMockMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        status: MessageStatus.Completed,
      }) as SystemMessage;

      mockMessageService.getMessage
        .mockResolvedValueOnce(updatedMessage)
        .mockResolvedValueOnce(parentMessage);

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.updateMessage).not.toHaveBeenCalled();
    });

    it('should handle Open status for system message completion', async () => {
      const event = createSystemMessageUpdateEvent({
        payload: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          update: {
            status: MessageStatus.Open,
            shouldProcess: true,
            contentChanged: false,
          },
          payloadType: 'message.updated',
        },
      });
      const updatedMessage = TestUtils.createMockMessage({
        type: 'SYSTEM',
        status: MessageStatus.Open,
        parentMessageId: testIds.parentMessage,
      }) as SystemMessage;
      const parentMessage = TestUtils.createMockMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        status: MessageStatus.SystemProcessing,
      }) as SystemMessage;

      mockMessageService.getMessage
        .mockResolvedValueOnce(updatedMessage)
        .mockResolvedValueOnce(parentMessage);

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        testIds.parentMessage,
        testIds.organization,
        { status: MessageStatus.Completed },
        {
          source: 'handleSystemMessageUpdatedEvent',
          suppressConversationEvent: true,
        },
      );
    });

    it('should handle errors during system message update processing', async () => {
      const event = createSystemMessageUpdateEvent();
      mockMessageService.getMessage.mockRejectedValue(
        new Error('Database error'),
      );

      const loggerSpy = jest.spyOn(Logger.prototype, 'error');

      await messageProcessor.handleSystemMessageUpdatedEvent(event);

      const errorCall = loggerSpy.mock.calls.find(([msg]) =>
        `${msg}`.includes(
          '[MESSAGE_PROCESSOR] Failed to process system message update event',
        ),
      );
      expect(errorCall).toBeDefined();
    });
  });

  describe('handleMessageCreatedEvent', () => {
    let mockEvent: MessageCreatedEvent;
    let mockEnvelope: EventEnvelope<MessageCreatedEvent>;

    beforeEach(() => {
      // Create test message payload matching UserMessage structure
      const testMessage = {
        type: 'USER' as const,
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        status: MessageStatus.Open,
        createdAt: new Date().toISOString(),
        parentMessageId: testIds.message,
        parentMessage: {
          id: testIds.message,
          content: 'Parent message content',
        },
        shouldProcess: true,
      };

      mockEvent = {
        id: testIds.event,
        type: 'message.created',
        aggregateId: testIds.message,
        payload: {
          payloadType: 'message.created',

          message: testMessage as unknown as MessageCreatedUserMessage,
          organizationId: testIds.organization,
          conversationId: testIds.conversation,
          userId: testIds.user,
          projectId: testIds.project,
        },
      };

      mockEnvelope = {
        event: mockEvent,
        timestamp: new Date().toISOString(),
        correlationId: 'test-correlation-id',
        organizationId: testIds.organization,
        projectId: testIds.project,
      };

      // Setup default mocks for user message processing
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'USER',
        conversationId: testIds.conversation,
        data: { message: 'I think we should update the login system' },
      });
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
        }),
      );

      const mockWorkflowHandle = {
        signal: jest.fn(),
      };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );
    });

    it('should process user message without signaling workflow', async () => {
      await messageProcessor.handleMessageCreatedEvent(mockEvent);

      // Generic USER creation is evidence only; dedicated workflow-answer
      // submission owns Temporal routing.
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();

      // Verify no event publishing occurs (artifact generation is now handled separately)
      expect(mockEventPublisher.publish).not.toHaveBeenCalled();
    });

    it('signals only a tagged onboarding reply through its owning Temporal workflow', async () => {
      const signal = jest.fn().mockResolvedValue(undefined);
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
        signal,
      });
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: {
            workflowId: testIds.workflow,
            nodeId: 'questions',
          },
        },
      } as MessageCreatedEvent;

      await messageProcessor.handleMessageCreatedEvent(taggedEvent);

      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        testIds.workflow,
      );
      expect(signal).toHaveBeenCalledTimes(1);
    });

    it('signals only a tagged repository import reply through its owning Temporal workflow', async () => {
      const signal = jest.fn().mockResolvedValue(undefined);
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
        signal,
      });
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          repositoryImportReplyDelivery: {
            workflowId: testIds.workflow,
            nodeId: 'onboarding-repository-grounding-configuration',
          },
        },
      } as MessageCreatedEvent;

      await messageProcessor.handleMessageCreatedEvent(taggedEvent);

      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        testIds.workflow,
      );
      expect(signal).toHaveBeenCalledTimes(1);
    });

    it('propagates tagged onboarding signal failures for outbox retry', async () => {
      const signalError = new Error('Temporal unavailable');
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
        signal: jest.fn().mockRejectedValue(signalError),
      });
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: {
            workflowId: testIds.workflow,
            nodeId: 'questions',
          },
        },
      } as MessageCreatedEvent;

      await expect(
        messageProcessor.handleMessageCreatedEvent(taggedEvent),
      ).rejects.toBe(signalError);
    });

    it('retries tagged onboarding delivery when a gone workflow cannot resume', async () => {
      const signalError = Object.assign(new Error('workflow not found'), {
        name: 'WorkflowNotFoundError',
      });
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
        signal: jest.fn().mockRejectedValue(signalError),
      });
      mockFlowExecutionService.findPausedByConversation.mockResolvedValue(null);
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: {
            workflowId: testIds.workflow,
            nodeId: 'questions',
          },
        },
      } as MessageCreatedEvent;

      await expect(
        messageProcessor.handleMessageCreatedEvent(taggedEvent),
      ).rejects.toBe(signalError);
      expect(
        mockFlowExecutionService.findPausedByConversation,
      ).toHaveBeenCalledWith(testIds.conversation, testIds.organization);
    });

    it('delivers a retried onboarding reply to the replacement workflow', async () => {
      const replacementWorkflowId =
        `${testIds.workflow}-replacement` as WorkflowId;
      const goneError = Object.assign(new Error('workflow not found'), {
        name: 'WorkflowNotFoundError',
      });
      const staleSignal = jest.fn().mockRejectedValue(goneError);
      const replacementSignal = jest.fn().mockResolvedValue(undefined);
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockImplementation(
        (workflowId: string) => ({
          signal:
            workflowId === replacementWorkflowId
              ? replacementSignal
              : staleSignal,
        }),
      );
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: replacementWorkflowId,
          workflowName: 'onboarding',
        }),
      );
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: {
            workflowId: testIds.workflow,
            nodeId: 'questions',
          },
        },
      } as MessageCreatedEvent;

      await messageProcessor.handleMessageCreatedEvent(taggedEvent);

      expect(mockTemporalClient.workflow.getHandle).toHaveBeenNthCalledWith(
        1,
        testIds.workflow,
      );
      expect(mockTemporalClient.workflow.getHandle).toHaveBeenNthCalledWith(
        2,
        replacementWorkflowId,
      );
      expect(replacementSignal).toHaveBeenCalledTimes(1);
      expect(
        mockFlowExecutionService.findPausedByConversation,
      ).not.toHaveBeenCalled();
    });

    it('resumes a tagged onboarding reply when admission found only saved workflow state', async () => {
      const pausedExecution = {
        id: testIds.flowExecution,
        flowId: 'onboarding',
        status: 'PAUSED',
        currentNode: 'questions',
        flowState: { currentNode: 'questions' },
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      };
      mockFlowExecutionService.findPausedByConversation.mockResolvedValue(
        pausedExecution as never,
      );
      mockFlowExecutionService.tryClaimPausedExecution = jest
        .fn()
        .mockResolvedValue(pausedExecution) as never;
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: undefined,
          workflowName: 'onboarding',
        }),
      );
      mockConversationWorkflowService.startWorkflowForExistingConversation.mockResolvedValue(
        { workflowId: testIds.workflow } as never,
      );
      const signal = jest.fn().mockResolvedValue(undefined);
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
        signal,
      });
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: { nodeId: 'questions' },
        },
      } as MessageCreatedEvent;

      await messageProcessor.handleMessageCreatedEvent(taggedEvent);

      expect(
        mockConversationWorkflowService.startWorkflowForExistingConversation,
      ).toHaveBeenCalledWith(
        testIds.conversation,
        'onboarding',
        testIds.organization,
      );
      expect(signal).toHaveBeenCalledTimes(1);
    });

    it('delivers a marker without a workflow id to an already-started replacement', async () => {
      const replacementWorkflowId =
        `${testIds.workflow}-replacement` as WorkflowId;
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: replacementWorkflowId,
          workflowName: 'onboarding',
        }),
      );
      const signal = jest.fn().mockResolvedValue(undefined);
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue({
        signal,
      });
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: { nodeId: 'questions' },
        },
      } as MessageCreatedEvent;

      await messageProcessor.handleMessageCreatedEvent(taggedEvent);

      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        replacementWorkflowId,
      );
      expect(signal).toHaveBeenCalledTimes(1);
      expect(
        mockFlowExecutionService.findPausedByConversation,
      ).not.toHaveBeenCalled();
    });

    it('retries tagged onboarding delivery when saved workflow state cannot be resumed', async () => {
      mockFlowExecutionService.findPausedByConversation.mockResolvedValue(null);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: undefined,
          workflowName: 'onboarding',
        }),
      );
      const taggedEvent = {
        ...mockEvent,
        payload: {
          ...mockEvent.payload,
          onboardingReplyDelivery: { nodeId: 'questions' },
        },
      } as MessageCreatedEvent;

      await expect(
        messageProcessor.handleMessageCreatedEvent(taggedEvent),
      ).rejects.toThrow('could not resume its workflow');
    });

    it('should handle system messages without processing', async () => {
      mockEvent.payload.message.type = 'SYSTEM';

      await messageProcessor.handleMessageCreatedEvent(mockEvent);

      // Should not call user message processing
      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
    });

    it('end-to-end: user message on a paused node with acceptsUserMessages=false lands in the log without advancing the workflow', async () => {
      const FLOW_ID = 'feature-sync';
      const NODE_ID = 'iterate';
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
        id: testIds.flowExecution,
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
        startNode: NODE_ID,
        nodes: {},
      });
      (mockNodeExecutionService.getNode as jest.Mock).mockReturnValue({
        node: {
          id: NODE_ID,
          type: NodeType.EXTERNAL_AGENT,
          twoPhase: true,
          acceptsUserMessages: false,
        },
        routing: { transitions: {} },
      });

      await messageProcessor.handleMessageCreatedEvent(mockEvent);

      // Message was persisted (getMessage is called on the stored record)
      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
      // Workflow was not advanced — no Temporal signal fired
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      // No other side effects (e.g. no domain events published from signalling)
      expect(mockEventPublisher.publish).not.toHaveBeenCalled();
    });
  });

  describe('handleMessageCreatedEvent - EXTERNAL_AGENT completion bridge', () => {
    const FLOW_ID = 'feature-sync';
    const NODE_ID = 'analyze';

    // Drives the real publisher so the strip+elevate path runs end-to-end —
    // any future drift between producer and consumer fails here instead of
    // silently passing on hand-crafted fixtures.
    const buildSystemEvent = (
      data: Record<string, unknown>,
    ): MessageCreatedEvent => {
      const message = {
        type: 'SYSTEM',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        data,
      } as unknown as CreateSystemMessage;
      const payload = buildMessageCreatedEventPayload({
        organizationId: testIds.organization as OrganizationId,
        projectId: testIds.project as ProjectId,
        workflowId: testIds.workflow as WorkflowId,
        conversationId: testIds.conversation as ConversationId,
        message,
      });
      return {
        id: testIds.event,
        type: 'message.created',
        aggregateId: testIds.message,
        payload,
      } as MessageCreatedEvent;
    };

    const completionData = (overrides: Record<string, unknown> = {}) =>
      ({
        type: 'AGENT',
        response: 'completion',
        detectedIntent: 'external_agent_completion',
        intentConfidence: 1,
        completesExternalAgentNode: {
          nodeId: NODE_ID,
          action: 'NO_DISCREPANCY',
          payload: { ok: true },
        },
        ...overrides,
      }) as unknown as Record<string, unknown>;

    it('regression: SYSTEM message without discriminator is a no-op (no signal, no rejection)', async () => {
      const event = buildSystemEvent({
        type: 'AGENT',
        response: 'normal agent message',
        detectedIntent: 'something',
        intentConfidence: 0.9,
      });

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
      expect(
        mockFlowExecutionService.findActiveByConversation,
      ).not.toHaveBeenCalled();
      expect(mockNodeExecutionService.getNode).not.toHaveBeenCalled();
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(mockMessageService.updateMessage).not.toHaveBeenCalled();
    });

    it('regression: consumer routes only on the elevated payload root, not on a leftover data blob', async () => {
      // Simulate an event whose `message.data` blob still carries a
      // completion envelope but the producer forgot to elevate it onto
      // the payload root. The consumer must no-op: the contract is
      // "routing fields live at the payload root", and a producer that
      // forgets to populate them should fail to advance the workflow
      // (visible regression) rather than silently fall back to the blob
      // (hidden regression — exactly the failure mode this task fixes).
      const event = {
        id: testIds.event,
        type: 'message.created',
        aggregateId: testIds.message,
        payload: {
          payloadType: 'message.created',
          organizationId: testIds.organization,
          projectId: testIds.project,
          message: {
            type: 'SYSTEM',
            workflowId: testIds.workflow,
            projectId: testIds.project,
            conversationId: testIds.conversation,
            shouldProcess: true,
            data: completionData(),
          } as unknown as MessageCreatedUserMessage,
          // completesExternalAgentNode intentionally absent at the root
        },
      } as MessageCreatedEvent;

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(mockMessageService.getMessage).not.toHaveBeenCalled();
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
    });

    it('signals the active workflow when the paused execution matches the declared EXTERNAL_AGENT node', async () => {
      const event = buildSystemEvent(completionData());
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'SYSTEM',
        conversationId: testIds.conversation,
        userId: 'system',
        data: completionData() as unknown as SystemMessage['data'],
      });
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockFlowExecutionService.findActiveByConversation.mockResolvedValue({
        id: testIds.flowExecution,
        flowId: FLOW_ID,
        status: 'PAUSED',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      } as unknown as Awaited<
        ReturnType<typeof mockFlowExecutionService.findActiveByConversation>
      >);
      mockNodeExecutionService.getNode.mockReturnValue({
        node: { type: NodeType.EXTERNAL_AGENT, id: NODE_ID },
        routing: {},
      } as unknown as ReturnType<typeof mockNodeExecutionService.getNode>);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
        }),
      );

      const mockWorkflowHandle = { signal: jest.fn() };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        testIds.workflow,
      );
      expect(mockWorkflowHandle.signal).toHaveBeenCalledTimes(1);
      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        WorkflowSignals.getWorkflowUserMessageSignalName(testIds.workflow),
        expect.objectContaining({
          id: testIds.message,
          type: 'SYSTEM',
          userId: 'system',
          conversationId: testIds.conversation,
        }),
      );
      expect(mockMessageService.updateMessage).not.toHaveBeenCalled();
    });

    it('normalizes payload-less ERROR completions with the stored agent response before signaling', async () => {
      const errorResponse =
        'submit_step_review received an invalid payload: plan.steps.2.stageId: stageId must be a UUID';
      const errorCompletionData = completionData({
        response: errorResponse,
        completesExternalAgentNode: {
          nodeId: NODE_ID,
          action: 'ERROR',
          completesTriggerMessageId: 'trigger-message-id',
        },
      });
      const event = buildSystemEvent(errorCompletionData);
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'SYSTEM',
        conversationId: testIds.conversation,
        userId: 'system',
        data: errorCompletionData as unknown as SystemMessage['data'],
      });
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockFlowExecutionService.findActiveByConversation.mockResolvedValue({
        id: testIds.flowExecution,
        flowId: FLOW_ID,
        status: 'PAUSED',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      } as unknown as Awaited<
        ReturnType<typeof mockFlowExecutionService.findActiveByConversation>
      >);
      mockNodeExecutionService.getNode.mockReturnValue({
        node: { type: NodeType.EXTERNAL_AGENT, id: NODE_ID },
        routing: {},
      } as unknown as ReturnType<typeof mockNodeExecutionService.getNode>);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: testIds.workflow,
        }),
      );

      const mockWorkflowHandle = { signal: jest.fn() };
      (mockTemporalClient.workflow.getHandle as jest.Mock).mockReturnValue(
        mockWorkflowHandle,
      );

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(mockWorkflowHandle.signal).toHaveBeenCalledWith(
        WorkflowSignals.getWorkflowUserMessageSignalName(testIds.workflow),
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'ERROR',
            payload: {
              reason: 'agent_submission_error',
              message: errorResponse,
            },
          }),
        }),
      );
    });

    it('falls back to attemptResumeFromPaused when the conversation has no workflowId but a matching paused execution exists', async () => {
      const event = buildSystemEvent(completionData());
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'SYSTEM',
        conversationId: testIds.conversation,
        userId: 'system',
        data: completionData() as unknown as SystemMessage['data'],
      });
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      const pausedExecution = {
        id: testIds.flowExecution,
        flowId: FLOW_ID,
        status: 'PAUSED',
        currentNode: NODE_ID,
        flowState: { some: 'state' },
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      };
      mockFlowExecutionService.findActiveByConversation.mockResolvedValue(
        pausedExecution as unknown as Awaited<
          ReturnType<typeof mockFlowExecutionService.findActiveByConversation>
        >,
      );
      mockFlowExecutionService.findPausedByConversation.mockResolvedValue(
        pausedExecution as unknown as Awaited<
          ReturnType<typeof mockFlowExecutionService.findPausedByConversation>
        >,
      );
      mockNodeExecutionService.getNode.mockReturnValue({
        node: { type: NodeType.EXTERNAL_AGENT, id: NODE_ID },
        routing: {},
      } as unknown as ReturnType<typeof mockNodeExecutionService.getNode>);
      mockConversationService.findOne.mockResolvedValue(
        TestUtils.createMockConversation({
          id: testIds.conversation,
          workflowId: undefined,
        }),
      );
      (mockFlowExecutionService.tryClaimPausedExecution as jest.Mock) = jest
        .fn()
        .mockResolvedValue(null); // race loss path — exercises the resume branch

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(
        mockFlowExecutionService.findActiveByConversation,
      ).toHaveBeenCalled();
      expect(
        mockFlowExecutionService.tryClaimPausedExecution,
      ).toHaveBeenCalled();
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(mockMessageService.updateMessage).not.toHaveBeenCalled();
    });

    it('rejects and warns when the paused execution is on a different nodeId', async () => {
      const event = buildSystemEvent(completionData());
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'SYSTEM',
        conversationId: testIds.conversation,
        userId: 'system',
        data: completionData() as unknown as SystemMessage['data'],
      });
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockFlowExecutionService.findActiveByConversation.mockResolvedValue({
        id: testIds.flowExecution,
        flowId: FLOW_ID,
        status: 'PAUSED',
        currentNode: 'some-other-node',
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      } as unknown as Awaited<
        ReturnType<typeof mockFlowExecutionService.findActiveByConversation>
      >);

      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(mockNodeExecutionService.getNode).not.toHaveBeenCalled();
      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
        expect.objectContaining({
          status: MessageStatus.Failed,
        }),
        expect.objectContaining({
          source: 'handleExternalAgentCompletionCreated',
        }),
      );
      expect(
        warnSpy.mock.calls.find(([msg]) =>
          `${msg}`.includes(
            '[handleExternalAgentCompletionCreated] rejecting completion',
          ),
        ),
      ).toBeDefined();
    });

    it('rejects and warns when the paused node is not an EXTERNAL_AGENT node', async () => {
      const event = buildSystemEvent(completionData());
      const storedMessage = TestUtils.createMockMessage({
        id: testIds.message,
        type: 'SYSTEM',
        conversationId: testIds.conversation,
        userId: 'system',
        data: completionData() as unknown as SystemMessage['data'],
      });
      mockMessageService.getMessage.mockResolvedValue(storedMessage);
      mockFlowExecutionService.findActiveByConversation.mockResolvedValue({
        id: testIds.flowExecution,
        flowId: FLOW_ID,
        status: 'PAUSED',
        currentNode: NODE_ID,
        flowState: null,
        resumable: true,
        startedAt: new Date(),
        completedAt: null,
      } as unknown as Awaited<
        ReturnType<typeof mockFlowExecutionService.findActiveByConversation>
      >);
      mockNodeExecutionService.getNode.mockReturnValue({
        node: { type: NodeType.QUESTIONS, id: NODE_ID },
        routing: {},
      } as unknown as ReturnType<typeof mockNodeExecutionService.getNode>);

      const warnSpy = jest.spyOn(Logger.prototype, 'warn');

      await messageProcessor.handleMessageCreatedEvent(event);

      expect(mockTemporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(mockMessageService.updateMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
        expect.objectContaining({
          status: MessageStatus.Failed,
        }),
        expect.objectContaining({
          source: 'handleExternalAgentCompletionCreated',
        }),
      );
      expect(
        warnSpy.mock.calls.find(([msg]) =>
          `${msg}`.includes(
            '[handleExternalAgentCompletionCreated] rejecting completion',
          ),
        ),
      ).toBeDefined();
    });
  });

  describe('getMessageType', () => {
    it('should return message type when message exists', async () => {
      const message = TestUtils.createMockMessage({
        type: 'USER',
      });
      mockMessageService.getMessage.mockResolvedValue(message);

      const result = await messageProcessor.getMessageType(
        testIds.message,
        testIds.organization,
      );

      expect(result).toBe('USER');
      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
    });

    it('should return null when message does not exist', async () => {
      mockMessageService.getMessage.mockResolvedValue(null);

      const result = await messageProcessor.getMessageType(
        testIds.message,
        testIds.organization,
      );

      expect(result).toBeNull();
      expect(mockMessageService.getMessage).toHaveBeenCalledWith(
        testIds.message,
        testIds.organization,
      );
    });

    it('should return null when message type is undefined', async () => {
      const message = TestUtils.createMockMessage({
        type: 'USER',
      });
      // Override the type to be undefined after creation
      const messageWithUndefinedType = {
        ...message,
        type: undefined,
      } as unknown as typeof message;
      mockMessageService.getMessage.mockResolvedValue(messageWithUndefinedType);

      const result = await messageProcessor.getMessageType(
        testIds.message,
        testIds.organization,
      );

      expect(result).toBeNull();
    });
  });
});
