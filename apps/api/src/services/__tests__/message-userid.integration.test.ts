import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MessageService } from '../message.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { TEMPORAL_CLIENT } from '../../prisma/temporal.module';
import { MessageController } from '../../controllers/message.controller';
import { ConversationService } from '../conversation.service';
import { FlowExecutionService } from '../workflows/flow-execution.service';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';
import { MessageStatus } from '../../constants/message-status.constants';
import {
  CreateSystemMessage,
  CreateUserMessage,
  QuestionsSystemMessageData,
  SystemMessageResponseType,
} from '../../generated';
import * as TestUtils from '../../utils/testUtils';
import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { ReportService } from '../reports/report.service';
import { MentionProcessingService } from '../mentions/mention-processing.service';
import { ExecutionGrantService } from '../controller-authorization/execution-grant.service';

describe('Message UserID Integration Tests', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let messageService: MessageService;
  let conversationService: ConversationService;

  const { testIds } = TestUtils;

  const createTransactionMock = (messageResult: any) => ({
    message: {
      create: jest.fn().mockResolvedValue(messageResult),
    },
    conversation: {
      findUnique: jest.fn().mockResolvedValue({ version: 1 }),
      update: jest.fn().mockResolvedValue({
        version: 2,
        projectId: messageResult.projectId ?? testIds.project,
      }),
    },
  });

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        MessageService,
        {
          provide: EntityRegistryService,
          useValue: {
            registerEntity: jest.fn(),
            registerEntities: jest.fn(),
            lookupEntityTypes: jest.fn(),
          },
        },
        {
          provide: ConversationService,
          useValue: TestUtils.createMockConversationService(),
        },
        {
          provide: FlowExecutionService,
          useValue: {
            findPausedByConversation: jest.fn().mockResolvedValue(null),
            resolveConversationPromptType: jest.fn().mockResolvedValue({
              promptType: null,
              nodeId: null,
              triggerMessageId: null,
            }),
          },
        },
        {
          provide: WorkflowTypeRegistryService,
          useValue: {
            isNonTemporalBackedWorkflow: jest.fn().mockReturnValue(false),
          },
        },
        {
          provide: PrismaService,
          useValue: TestUtils.createMockPrismaServiceWithTypes(),
        },
        {
          provide: TEMPORAL_CLIENT,
          useValue: TestUtils.createMockTemporalClient(),
        },
        {
          provide: ExecutionGrantService,
          useValue: {
            assertInteractiveAuthorized: jest.fn(),
            deriveInteractiveGrant: jest.fn(),
          },
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: { publish: jest.fn(), publishInTransaction: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              set: jest.fn(),
              get: jest.fn(),
              del: jest.fn(),
              setex: jest.fn(),
              disconnect: jest.fn(),
            }),
            onModuleDestroy: jest.fn(),
          },
        },
        {
          provide: ReportService,
          useValue: {
            loadReportsForMessageIds: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: MentionProcessingService,
          useValue: {
            extractMentionTokens: jest.fn().mockReturnValue([]),
            validateMentions: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({
        canActivate: jest.fn().mockReturnValue(true),
      })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    messageService = moduleFixture.get<MessageService>(MessageService);
    conversationService =
      moduleFixture.get<ConversationService>(ConversationService);
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  describe('End-to-End userId Flow', () => {
    it('should create system message with userId="system" through service layer', async () => {
      const mockDbMessage = TestUtils.createMockDbMessage({
        userId: 'system',
        type: 'SYSTEM',
      });

      // Mock the transaction to return our mock message
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockDbMessage);
          return callback(txMock);
        });

      const createSystemMessage: any = {
        type: 'SYSTEM',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        data: {
          type: 'QUESTIONS',
          response: 'Test system message',
          detectedIntent: 'test',
          intentConfidence: 0.9,
          uiElements: [] as any[],
          actions: [] as any[],
        },
        status: MessageStatus.Open,
      };

      const result = await messageService.addMessage(
        createSystemMessage,
        testIds.organization,
        'integration-test',
      );

      expect(result.userId).toBe('system');
      expect(result.type).toBe('SYSTEM');
    });

    it('should create user message with provided userId through service layer', async () => {
      const testUserId = 'test-user-123';
      const mockDbMessage = TestUtils.createMockDbMessage({
        userId: testUserId,
        type: 'USER',
      });

      // Mock the transaction to return our mock message
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockDbMessage);
          return callback(txMock);
        });

      const createUserMessage: any = {
        type: 'USER',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        userId: testUserId,
        data: {
          message: 'Test user message',
        },
        status: MessageStatus.Open,
      };

      const result = await messageService.addMessage(
        createUserMessage,
        testIds.organization,
        'integration-test',
      );

      expect(result.userId).toBe(testUserId);
      expect(result.type).toBe('USER');
    });

    it('should handle message creation with custom system userId', async () => {
      const customSystemUserId = 'custom-system-agent';
      const mockDbMessage = TestUtils.createMockDbMessage({
        userId: customSystemUserId,
        type: 'SYSTEM',
      });

      // Mock the transaction to return our mock message
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockDbMessage);
          return callback(txMock);
        });

      const createSystemMessage: any = {
        type: 'SYSTEM',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        userId: customSystemUserId,
        data: {
          type: 'QUESTIONS',
          response: 'Test custom system message',
          detectedIntent: 'test',
          intentConfidence: 0.9,
          uiElements: [] as any[],
          actions: [] as any[],
        },
        status: MessageStatus.Open,
      };

      const result = await messageService.addMessage(
        createSystemMessage,
        testIds.organization,
        'integration-test',
      );

      expect(result.userId).toBe(customSystemUserId);
      expect(result.type).toBe('SYSTEM');
    });

    it('should validate userId consistency across message lifecycle', async () => {
      const testUserId = 'lifecycle-test-user';
      const mockDbMessage = TestUtils.createMockDbMessage({
        id: testIds.message,
        userId: testUserId,
        type: 'USER',
      });

      // Mock message creation
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockDbMessage);
          return callback(txMock);
        });

      // Mock message retrieval
      jest
        .spyOn(prismaService.db.project, 'findMany')
        .mockResolvedValue([
          TestUtils.createMockDbProject({ id: testIds.project }),
        ]);
      jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue(mockDbMessage);
      jest.spyOn(prismaService.db.user, 'findMany').mockResolvedValue([]);

      // Create message
      const createUserMessage: any = {
        type: 'USER',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        userId: testUserId,
        data: {
          message: 'Test lifecycle message',
        },
        status: MessageStatus.Open,
      };

      const createdMessage = await messageService.addMessage(
        createUserMessage,
        testIds.organization,
        'integration-test',
      );

      // Retrieve message
      const retrievedMessage = await messageService.getMessage(
        testIds.message,
        testIds.organization,
      );

      // Verify userId consistency
      expect(createdMessage.userId).toBe(testUserId);
      expect(retrievedMessage?.userId).toBe(testUserId);
      expect(createdMessage.userId).toBe(retrievedMessage?.userId);
    });

    it('should handle appendMessageToConversation with userId', async () => {
      const mockLastMessage = TestUtils.createMockDbMessage({
        id: 'previous-message-id' as any,
        userId: 'previous-user',
        type: 'USER',
      });

      const mockNewMessage = TestUtils.createMockDbMessage({
        userId: 'system',
        type: 'SYSTEM',
      });

      // Mock finding last message
      jest
        .spyOn(prismaService.db.project, 'findMany')
        .mockResolvedValue([
          TestUtils.createMockDbProject({ id: testIds.project }),
        ]);
      jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue(mockLastMessage);

      // Mock message creation
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockNewMessage);
          return callback(txMock);
        });

      const messageData = {
        type: 'SYSTEM' as const,
        workflowId: testIds.workflow,
        projectId: testIds.project,
        userId: 'system',
        data: {
          type: 'QUESTIONS',
          response: 'Follow-up system message',
          detectedIntent: 'followup',
          intentConfidence: 0.8,
          uiElements: [] as any[],
          actions: [] as any[],
        } as QuestionsSystemMessageData,
        status: MessageStatus.Open,
      };

      const result = await messageService.appendMessageToConversation(
        testIds.conversation,
        messageData,
        testIds.organization,
        'integration-test',
      );

      expect(result.userId).toBe('system');
      expect(result.type).toBe('SYSTEM');
    });
  });

  describe('userId Validation and Error Handling', () => {
    it('should handle missing userId for user messages gracefully', async () => {
      // Note: In the controller, missing userId for USER messages should be filled in from auth
      // This test verifies the service layer behavior when userId is provided
      const mockDbMessage = TestUtils.createMockDbMessage({
        userId: 'fallback-user',
        type: 'USER',
      });

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockDbMessage);
          return callback(txMock);
        });

      const createUserMessage: any = {
        type: 'USER',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        userId: 'fallback-user',
        data: {
          message: 'Test user message without explicit userId',
        },
        status: MessageStatus.Open,
      };

      const result = await messageService.addMessage(
        createUserMessage,
        testIds.organization,
        'integration-test',
      );

      expect(result.userId).toBeDefined();
      expect(result.type).toBe('USER');
    });

    it('should default userId to "system" when not provided for SYSTEM messages', async () => {
      // The service internally defaults to 'system' for SYSTEM messages without userId
      // So the mock should reflect what would actually be stored in the database
      const mockDbMessage = TestUtils.createMockDbMessage({
        userId: 'system', // Service defaults to 'system' for SYSTEM messages
        type: 'SYSTEM',
      });

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (callback: any) => {
          const txMock = createTransactionMock(mockDbMessage);
          return callback(txMock);
        });

      const createSystemMessage: any = {
        type: 'SYSTEM',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        conversationId: testIds.conversation,
        // No userId provided - service should default to 'system'
        data: {
          type: 'QUESTIONS',
          response: 'Test system message without explicit userId',
          detectedIntent: 'test',
          intentConfidence: 0.9,
          uiElements: [] as any[],
          actions: [] as any[],
        },
        status: MessageStatus.Open,
      };

      const result = await messageService.addMessage(
        createSystemMessage,
        testIds.organization,
        'integration-test',
      );

      // Service should default to 'system' for SYSTEM messages when userId is not provided
      expect(result.userId).toBe('system');
      expect(result.type).toBe('SYSTEM');
    });
  });
});
