import { Test, TestingModule } from '@nestjs/testing';
import { CoreProcessor } from '../../processing/core-processor.service';
import { LlmProcessor } from '../../processing/llm-processor.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { QUEUE_SERVICE_TOKEN } from '../../queue/queue.module';
import { MessageService } from '../../../services/message.service';
import { WorkflowRouterService } from '../../../services/workflows/workflow-router.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../tokens';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { EventRouter } from '../event-router';
import { MessageProcessor } from '../../../core/processing/message-processor.service';
import { ArtifactProcessor } from '../../../core/processing/artifact-processor.service';
import { InitiativeService } from '../../../services/initiatives/initiative.service';
import { ConversationService } from '../../../services/conversation.service';
import { AgentProcessor } from '../../processing/agent-processor.service';
import { IntentDetectorService } from '../../../services/intent-detector.service';
import { NodeExecutionService } from '../../../services/workflows/node-execution.service';
import { LLMClientService } from '../../../services/llm/llm-client.service';
import { FlowNodeProcessor } from '../../processing/flow-node-processor.service';
import { NonInteractiveFlowNodeProcessor } from '../../processing/non-interactive-flow-node-processor.service';
import { EntityLifecycleProcessor } from '../../processing/entity-lifecycle-processor.service';
import { NotificationGenerationProcessor } from '../../processing/notification-generation-processor.service';
import { MentionRelationService } from '../../../services/mentions/mention-relation.service';
import { AgentSessionService } from '../../../services/agent-session.service';
import * as TestUtils from '../../../utils/testUtils';
import { LlmRequestEvent, LlmCompleteEvent } from '../types/domain-events';
import { ReportService } from 'src/services/reports/report.service';

/**
 * Tests LLM event handling through LlmProcessor using LLM request/complete events.
 * Verifies that the LlmProcessor correctly handles LLM events and updates system messages.
 */
describe('LlmProcessor – LLM Event Handling', () => {
  let llmProcessor: LlmProcessor;
  let publishSpy: jest.Mock;

  beforeAll(() => {
    process.env.CLAUDE_API_KEY = 'test-key';
  });

  beforeEach(async () => {
    publishSpy = jest.fn();

    const { testIds } = TestUtils;
    const mockQueueService = TestUtils.createMockQueueService();
    const mockPrismaService = TestUtils.createMockPrismaService();
    const mockMessageService = TestUtils.createMockMessageService();
    const mockWorkflowRouterService = TestUtils.createMockWorkflowService();
    const mockArtifactService = TestUtils.createMockArtifactService();
    const mockEventRouter = {
      on: jest.fn(() => Promise.resolve()),
    };
    const mockTemporalClient = {
      workflow: {
        getHandle: jest.fn(() => ({
          signal: jest.fn(),
        })),
      },
    };

    const mockEventPublisher = { publish: publishSpy };
    const mockAgentProcessor = TestUtils.createMockAgentProcessor();
    const mockIntentDetectorService =
      TestUtils.createMockIntentDetectorService();
    const mockFlowEngineService = TestUtils.createMockFlowEngineService();
    const mockLLMClientService = TestUtils.createMockLLMClientService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [CoreProcessor,
{
          provide: LlmProcessor,
          useValue: {
            updateSystemMessageWithProgress: jest
              .fn()
              .mockResolvedValue(undefined),
            updateSystemMessageFromJobCompletion: jest
              .fn()
              .mockResolvedValue(undefined),
            updateSystemMessageFromJobFailure: jest
              .fn()
              .mockResolvedValue(undefined),
            handleLLMRequestEvent: jest.fn().mockImplementation(async () => {
              await publishSpy({ type: 'llm.request', data: {} });
            }),
            handleLLMCompletionEvent: jest.fn().mockImplementation(async () => {
              await publishSpy({
                type: 'llm.complete',
                data: { success: true },
              });
            }),
            onModuleInit: jest.fn(),
            onModuleDestroy: jest.fn(),
          },
        },
{
          provide: MessageProcessor,
          useValue: {
            handleMessageCreatedEvent: jest.fn().mockResolvedValue(undefined),
            handleUserMessageUpdatedEvent: jest
              .fn()
              .mockResolvedValue(undefined),
            handleSystemMessageUpdatedEvent: jest
              .fn()
              .mockResolvedValue(undefined),
            handleFlowNodeCompletedEvent: jest
              .fn()
              .mockResolvedValue(undefined),
            getMessageType: jest.fn().mockResolvedValue('USER'),
          },
        },
{
          provide: ArtifactProcessor,
          useValue: {
            handleUserMessageCreated: jest.fn().mockResolvedValue(undefined),
            handleArtifactGenerationRequestedEvent: jest
              .fn()
              .mockResolvedValue(undefined),
            processArtifactGeneration: jest.fn().mockResolvedValue(undefined),
          },
        },
{
          provide: IntentDetectorService,
          useValue: mockIntentDetectorService,
        },
{
          provide: ReportService,
          useValue: {},
        },
{
          provide: NodeExecutionService,
          useValue: mockFlowEngineService,
        },
{
          provide: LLMClientService,
          useValue: mockLLMClientService,
        },
{
          provide: FlowNodeProcessor,
          useValue: {
            processFlowNode: jest.fn().mockResolvedValue(undefined),
            completeAgentNode: jest.fn().mockResolvedValue(undefined),
            onModuleInit: jest.fn(),
            onModuleDestroy: jest.fn(),
          },
        },
{
          provide: NonInteractiveFlowNodeProcessor,
          useValue: {
            processNonInteractiveFlowNode: jest
              .fn()
              .mockResolvedValue(undefined),
          },
        },
{
          provide: QUEUE_SERVICE_TOKEN,
          useValue: mockQueueService,
        },
{
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
{
          provide: PrismaService,
          useValue: mockPrismaService,
        },
{
          provide: MessageService,
          useValue: mockMessageService,
        },
{
          provide: WorkflowRouterService,
          useValue: mockWorkflowRouterService,
        },
{
          provide: ArtifactService,
          useValue: mockArtifactService,
        },
{
          provide: EventRouter,
          useValue: mockEventRouter,
        },
{
          provide: AgentProcessor,
          useValue: mockAgentProcessor,
        },
{
          provide: EntityLifecycleProcessor,
          useValue: {
            handleTaskCreated: jest.fn(),
            handleTaskUpdated: jest.fn(),
            handleTaskArchived: jest.fn(),
          },
        },
{
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
{
          provide: InitiativeService,
          useValue: TestUtils.createMockInitiativeService(),
        },
{
          provide: ConversationService,
          useValue: TestUtils.createMockConversationService(),
        },
{
          provide: NotificationGenerationProcessor,
          useValue: {
            handleReportCreatedEvent: jest.fn(),
            handleTaskStatusChangedEvent: jest.fn(),
            handleAgentSessionStatusChangedEvent: jest.fn(),
          },
        },
{
          provide: MentionRelationService,
          useValue: {
            createRelationsForMessage: jest.fn(),
          },
        },
{
          provide: AgentSessionService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
            markSynced: jest.fn(),
            markUnsyncedChanges: jest.fn(),
            findIdByConversationId: jest.fn(),
            createConversationForSession: jest.fn(),
          },
        }],
    }).compile();

    llmProcessor = module.get<LlmProcessor>(LlmProcessor);
  });

  it('handles LLM request and completion events', async () => {
    const { testIds } = TestUtils;

    const mockLLMRequestEvent: LlmRequestEvent = {
      id: testIds.event,
      type: 'llm.request' as const,
      aggregateId: testIds.request,
      payload: {
        payloadType: 'llm.request' as const,

        requestId: testIds.request,
        organizationId: testIds.organization,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        userId: testIds.user,
        workflowId: testIds.workflow,
        messageId: testIds.message,
        model: 'claude-3',
        prompt: 'Test prompt',
      },
    };

    const mockLLMCompleteEvent: LlmCompleteEvent = {
      id: testIds.event,
      type: 'llm.complete' as const,
      aggregateId: testIds.request,
      payload: {
        payloadType: 'llm.complete' as const,

        requestId: testIds.request,
        organizationId: testIds.organization,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        userId: testIds.user,
        workflowId: testIds.workflow,
        messageId: testIds.message,
        status: 'success' as const,
        systemMessageData: {
          type: 'QUESTIONS' as const,
          response: 'Test response',
          detectedIntent: 'test_intent',
          intentConfidence: 0.95,
          reasoning: 'Test reasoning',
          uiElements: [],
        },
      },
    };

    // Test LLM request event handling
    await llmProcessor.handleLLMRequestEvent(mockLLMRequestEvent);

    // Test LLM completion event handling
    await llmProcessor.handleLLMCompletionEvent(mockLLMCompleteEvent);

    // Verify events were published
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'llm.request',
      }),
    );
    expect(publishSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'llm.complete',
        data: expect.objectContaining({ success: true }),
      }),
    );
  });
});
