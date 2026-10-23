/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { CoreProcessor } from '../core-processor.service';
import { ArtifactService } from '../../../services/artifacts/artifact.service';
import { MessageService } from '../../../services/message.service';
import { LlmProcessor } from '../llm-processor.service';
import {
  CreateArtifactDto,
  CreateUserMessage,
  MessageCreatedUserMessage,
  MessageResponseDto,
  MessageStatus,
  SystemMessageResponseType,
} from '../../../generated';
import { QUEUE_SERVICE_TOKEN } from '../../queue/queue.module';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../events/tokens';
import { EventRouter } from '../../events/event-router';
import { TagService } from 'src/services/tag.service';
import { ArtifactProcessor } from '../artifact-processor.service';
import { MessageProcessor } from '../message-processor.service';
import { AgentProcessor } from '../agent-processor.service';
import { MentionRelationService } from 'src/services/mentions/mention-relation.service';
import { NotificationGenerationProcessor } from '../notification-generation-processor.service';
import { createRedisServiceMock } from '../../../../test/mocks/redis-service.mock';
import { createFlowNodeProcessorMock } from '../../../../test/mocks/flow-node-processor.mock';
import { createNonInteractiveFlowNodeProcessorMock } from '../../../../test/mocks/non-interactive-flow-node-processor.mock';
import { EntityLifecycleProcessor } from '../entity-lifecycle-processor.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { ReportService } from 'src/services/reports/report.service';
import * as TestUtils from '../../../utils/testUtils';
import { FlowUserMessage } from 'src/types/flow-internal.types';
import { EVENT_TYPES } from '../../events/types/event.types';
import {
  GitHubWebhookAcceptedEvent,
  MessageCreatedEvent,
  ReportCreatedEvent,
} from '../../events/types/domain-events';
import { MessageId } from '../../../types';
const { testIds } = TestUtils;

describe('CoreProcessor Integration - Artifact Creation', () => {
  let module: TestingModule;
  let coreProcessor: CoreProcessor;
  let artifactProcessor: ArtifactProcessor;

  const mockArtifactService = TestUtils.createMockArtifactService();
  const mockMessageService = TestUtils.createMockMessageService();
  const mockLlmProcessor = {};
  const mockQueueService = TestUtils.createMockQueueService();
  const mockTemporalClient = TestUtils.createMockTemporalClient();
  const mockEventPublisher = TestUtils.createMockDomainEventPublisher();
  let mockEventRouter: { on: jest.Mock };
  let registeredHandlers: Map<string, (env: any) => Promise<void> | void>;
  const mockMessageProcessor = {};
  const mockAgentProcessor = TestUtils.createMockAgentProcessor();
  const mockReportService = {
    handleReportCreatedFileTouchIndex: jest.fn().mockResolvedValue(undefined),
  };
  const mockNotificationGenerationProcessor = {
    handleReportCreatedEvent: jest.fn(),
    handleTaskStatusChangedEvent: jest.fn(),
    handleAgentSessionStatusChangedEvent: jest.fn(),
    handleGitHubWebhookAcceptedEvent: jest.fn(),
  };

  beforeEach(async () => {
    registeredHandlers = new Map();
    mockEventRouter = {
      on: jest.fn((eventType: string, handler: (env: any) => Promise<void>) => {
        registeredHandlers.set(eventType, handler);
        return Promise.resolve();
      }),
    };

    module = await Test.createTestingModule({
      providers: [
        CoreProcessor,
        {
          provide: ArtifactService,
          useValue: mockArtifactService,
        },
        {
          provide: TagService,
          useValue: {},
        },
        ArtifactProcessor,
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
        {
          provide: MessageProcessor,
          useValue: mockMessageProcessor,
        },
        {
          provide: LlmProcessor,
          useValue: mockLlmProcessor,
        },
        {
          provide: QUEUE_SERVICE_TOKEN,
          useValue: mockQueueService,
        },
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: mockEventPublisher,
        },
        {
          provide: EventRouter,
          useValue: mockEventRouter,
        },
        {
          provide: MentionRelationService,
          useValue: {
            createRelationsForMessage: jest.fn(),
          },
        },
        {
          provide: NotificationGenerationProcessor,
          useValue: mockNotificationGenerationProcessor,
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
            handleMessageCreated: jest.fn(),
          },
        },
        {
          provide: AgentSessionService,
          useValue: {
            findIdByConversationId: jest.fn().mockResolvedValue(null),
            markUnsyncedChanges: jest.fn().mockResolvedValue(undefined),
            markSynced: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: ReportService,
          useValue: mockReportService,
        },
        createRedisServiceMock(),
        createFlowNodeProcessorMock(),
        createNonInteractiveFlowNodeProcessorMock(),
      ],
    }).compile();

    coreProcessor = module.get<CoreProcessor>(CoreProcessor);
    artifactProcessor = module.get<ArtifactProcessor>(ArtifactProcessor);

    jest.clearAllMocks();
  });

  describe('maybeGenerateArtifactsForUserAnswers', () => {
    const mockUserMessage: FlowUserMessage = {
      id: testIds.message,
      status: MessageStatus.Completed,
      createdAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      projectId: testIds.project,
      conversationId: testIds.conversation,
      workflowId: testIds.workflow,
      type: 'USER',
      userId: testIds.user,
      data: {
        round1_concept: 'AI-powered project management tool',
        round1_requirements:
          'User authentication, task management, real-time collaboration',
        round2_technical_architecture: 'Microservices with React frontend',
      },
    };

    const mockParentMessage = TestUtils.createMockMessage({
      data: {
        type: 'QUESTIONS',
        response: 'I need more details about your project.',
        detectedIntent: 'test_intent',
        intentConfidence: 0.9,
        nodeId: 'test-node-id',
        uiElements: [
          {
            id: 'round1_concept',
            label: 'What is your project concept?',
            type: 'textarea',
            required: true,
          },
          {
            id: 'round1_requirements',
            label: 'What are your key requirements?',
            type: 'textarea',
            required: true,
          },
          {
            id: 'round2_technical_architecture',
            label: 'What is your preferred technical architecture?',
            type: 'textarea',
            required: true,
          },
        ],
        actions: [],
      },
      status: 'open',
      awaitingResponse: true,
    });
  });

  describe('MESSAGE.CREATED Event Parallel Processing', () => {
    let mockMessageProcessor: jest.Mocked<MessageProcessor>;
    let mockArtifactProcessor: jest.Mocked<ArtifactProcessor>;

    beforeEach(() => {
      // Create proper mocks for the processors
      mockMessageProcessor = {
        handleMessageCreatedEvent: jest.fn(),
      } as unknown as jest.Mocked<MessageProcessor>;

      mockArtifactProcessor = {
        handleUserMessageCreated: jest.fn(),
      } as unknown as jest.Mocked<ArtifactProcessor>;

      // Replace the processors in the module
      (coreProcessor as any).messageProcessor = mockMessageProcessor;
      (coreProcessor as any).artifactProcessor = mockArtifactProcessor;
    });

    const createMessageCreatedEvent = (): MessageCreatedEvent => ({
      id: testIds.event,
      type: EVENT_TYPES.MESSAGE.CREATED,
      aggregateId: testIds.message,
      payload: {
        payloadType: EVENT_TYPES.MESSAGE.CREATED,

        organizationId: testIds.organization,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        messageId: testIds.message,
        correlationId: 'test-correlation-id',
        causationId: testIds.message,
        timestamp: new Date().toISOString(),
        message: {
          type: 'USER',
          workflowId: testIds.workflow,
          conversationId: testIds.conversation,
          projectId: testIds.project,
          parentMessageId: 'parent-message-id' as MessageId,
          parentMessage: {
            id: 'parent-message-id' as MessageId,
            content: 'Parent message content',
          },
          shouldProcess: true,
        } as unknown as MessageCreatedUserMessage,
      },
    });

    it('should call both MessageProcessor and ArtifactProcessor for MESSAGE.CREATED events', async () => {
      const event = createMessageCreatedEvent();
      const envelope = { event };

      // Simulate the EVENT_TYPES.MESSAGE.CREATED handler
      await Promise.all([
        mockMessageProcessor.handleMessageCreatedEvent(event),
        mockArtifactProcessor.handleUserMessageCreated(event),
      ]);

      expect(
        mockMessageProcessor.handleMessageCreatedEvent,
      ).toHaveBeenCalledWith(event);
      expect(
        mockArtifactProcessor.handleUserMessageCreated,
      ).toHaveBeenCalledWith(event);
    });

    it('should handle MessageProcessor failure without breaking ArtifactProcessor', async () => {
      const event = createMessageCreatedEvent();

      mockMessageProcessor.handleMessageCreatedEvent.mockRejectedValue(
        new Error('MessageProcessor failed'),
      );
      mockArtifactProcessor.handleUserMessageCreated.mockResolvedValue();

      // Promise.all should reject if any processor fails
      await expect(
        Promise.all([
          mockMessageProcessor.handleMessageCreatedEvent(event),
          mockArtifactProcessor.handleUserMessageCreated(event),
        ]),
      ).rejects.toThrow('MessageProcessor failed');

      // Both processors should have been called
      expect(
        mockMessageProcessor.handleMessageCreatedEvent,
      ).toHaveBeenCalledWith(event);
      expect(
        mockArtifactProcessor.handleUserMessageCreated,
      ).toHaveBeenCalledWith(event);
    });

    it('should handle ArtifactProcessor failure without breaking MessageProcessor', async () => {
      const event = createMessageCreatedEvent();

      mockMessageProcessor.handleMessageCreatedEvent.mockResolvedValue();
      mockArtifactProcessor.handleUserMessageCreated.mockRejectedValue(
        new Error('ArtifactProcessor failed'),
      );

      // Promise.all should reject if any processor fails
      await expect(
        Promise.all([
          mockMessageProcessor.handleMessageCreatedEvent(event),
          mockArtifactProcessor.handleUserMessageCreated(event),
        ]),
      ).rejects.toThrow('ArtifactProcessor failed');

      // Both processors should have been called
      expect(
        mockMessageProcessor.handleMessageCreatedEvent,
      ).toHaveBeenCalledWith(event);
      expect(
        mockArtifactProcessor.handleUserMessageCreated,
      ).toHaveBeenCalledWith(event);
    });

    it('should successfully process when both processors succeed', async () => {
      const event = createMessageCreatedEvent();

      mockMessageProcessor.handleMessageCreatedEvent.mockResolvedValue();
      mockArtifactProcessor.handleUserMessageCreated.mockResolvedValue();

      // Should not throw
      await expect(
        Promise.all([
          mockMessageProcessor.handleMessageCreatedEvent(event),
          mockArtifactProcessor.handleUserMessageCreated(event),
        ]),
      ).resolves.toEqual([undefined, undefined]);

      expect(
        mockMessageProcessor.handleMessageCreatedEvent,
      ).toHaveBeenCalledWith(event);
      expect(
        mockArtifactProcessor.handleUserMessageCreated,
      ).toHaveBeenCalledWith(event);
    });

    it('should invoke mention relation creation for MESSAGE.CREATED events', async () => {
      const event = createMessageCreatedEvent();
      const mentionRelationService = (coreProcessor as any)
        .mentionRelationService as jest.Mocked<MentionRelationService>;

      await (coreProcessor as any).setupEventListeners();

      const handler = registeredHandlers.get(EVENT_TYPES.MESSAGE.CREATED);
      if (!handler) {
        throw new Error('MESSAGE.CREATED handler not registered');
      }

      await handler({ event });

      expect(
        mentionRelationService.createRelationsForMessage,
      ).toHaveBeenCalledWith(event);
    });

    it('registers cloned message history without executing or creating more artifacts', async () => {
      const event = createMessageCreatedEvent();
      await (
        coreProcessor as unknown as { setupEventListeners(): Promise<void> }
      ).setupEventListeners();
      const handler = registeredHandlers.get(EVENT_TYPES.MESSAGE.CREATED)!;
      await handler({ event, headers: { templateClone: true } });
      expect(
        mockMessageProcessor.handleMessageCreatedEvent,
      ).not.toHaveBeenCalled();
      expect(
        mockArtifactProcessor.handleUserMessageCreated,
      ).not.toHaveBeenCalled();
      const lifecycle = (
        coreProcessor as unknown as {
          entityLifecycleProcessor: EntityLifecycleProcessor;
        }
      ).entityLifecycleProcessor;
      expect(lifecycle.handleMessageCreated).toHaveBeenCalledWith(
        expect.objectContaining({
          messageId: event.aggregateId,
          shouldProcess: true,
        }),
      );
    });

    it('should index file touches before notification generation for REPORT.CREATED events', async () => {
      const event = {
        id: 'report-event-1',
        type: EVENT_TYPES.REPORT.CREATED,
        aggregateId: 'report-1',
        payload: {
          payloadType: EVENT_TYPES.REPORT.CREATED,
          organizationId: testIds.organization,
          projectId: testIds.project,
          shouldProcess: true,
          report: {
            id: 'report-1',
            organizationId: testIds.organization,
            projectId: testIds.project,
            reportType: 'IMPLEMENT',
            audience: 'WORKFLOW_ONLY',
            title: 'Implement',
            payload: {
              reportType: 'IMPLEMENT',
              summary: 'Implemented changes.',
              filesChanged: ['src/index.ts'],
            },
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: 'agent-session-1',
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            entities: [],
          },
        },
      } as ReportCreatedEvent;

      await (coreProcessor as any).setupEventListeners();

      const handler = registeredHandlers.get(EVENT_TYPES.REPORT.CREATED);
      if (!handler) {
        throw new Error('REPORT.CREATED handler not registered');
      }

      await handler({ event });

      expect(
        mockReportService.handleReportCreatedFileTouchIndex,
      ).toHaveBeenCalledWith(event);
      expect(
        mockNotificationGenerationProcessor.handleReportCreatedEvent,
      ).toHaveBeenCalledWith(event);
      const indexingCallOrder =
        mockReportService.handleReportCreatedFileTouchIndex.mock
          .invocationCallOrder[0];
      const notificationCallOrder =
        mockNotificationGenerationProcessor.handleReportCreatedEvent.mock
          .invocationCallOrder[0];
      expect(indexingCallOrder).toBeDefined();
      expect(notificationCallOrder).toBeDefined();
      expect(indexingCallOrder as number).toBeLessThan(
        notificationCallOrder as number,
      );
    });

    it('routes accepted GitHub webhook events to merge notification generation', async () => {
      const event = {
        id: 'github-event-1',
        type: EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED,
        aggregateId: 'inbox-1',
        payload: {
          organizationId: testIds.organization,
          projectId: testIds.project,
          integrationId: 'integration-1',
          inboxId: 'inbox-1',
          deliveryId: 'delivery-1',
          eventName: 'pull_request',
          action: 'closed',
          repository: {
            id: 42,
            fullName: 'hey-hey/api',
            htmlUrl: 'https://github.com/hey-hey/api',
          },
          pullRequest: {
            id: 100,
            number: 12,
            title: 'Preserve accepted merge facts',
            state: 'closed',
            merged: true,
            mergedAt: '2026-08-18T18:00:00.000Z',
            mergedByLogin: 'octocat',
            htmlUrl: 'https://github.com/hey-hey/api/pull/12',
            headSha: 'abc123',
            baseSha: 'def456',
          },
          acceptedAt: '2026-08-18T18:01:00.000Z',
        },
      } as GitHubWebhookAcceptedEvent;

      await (coreProcessor as any).setupEventListeners();
      const handler = registeredHandlers.get(
        EVENT_TYPES.GITHUB_WEBHOOK.ACCEPTED,
      );
      if (!handler) {
        throw new Error('GitHub webhook accepted handler not registered');
      }

      await handler({ event });

      expect(
        mockNotificationGenerationProcessor.handleGitHubWebhookAcceptedEvent,
      ).toHaveBeenCalledWith(event);
    });
  });
});
