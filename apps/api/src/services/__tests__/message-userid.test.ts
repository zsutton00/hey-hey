import { MessageService } from '../message.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { MessageStatus } from '../../constants/message-status.constants';
import { CreateSystemMessage, CreateUserMessage } from '../../generated';
import { MentionProcessingService } from '../mentions/mention-processing.service';
import { ReportService } from '../reports/report.service';
import * as TestUtils from '../../utils/testUtils';
import { createServiceTestingModule } from '../../../test/setup/testing-module.factory';

describe('MessageService - userId functionality', () => {
  let service: MessageService;
  let mockPrisma: any;
  let mockEventPublisher: any;
  let mockRedis: any;
  let mockMentionProcessingService: any;
  let mockReportService: any;

  const { testIds } = TestUtils;

  beforeEach(async () => {
    const tx = {
      message: {
        create: jest.fn(),
      },
      conversation: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    mockPrisma = {
      $transaction: jest
        .fn()
        .mockImplementation(async (callback: any) => callback(tx)),
      message: tx.message,
      conversation: tx.conversation,
    };

    mockEventPublisher = {
      publishInTransaction: jest.fn().mockResolvedValue(undefined),
    };

    mockRedis = {
      getClient: jest.fn(() => ({
        setex: jest.fn(),
        get: jest.fn(),
      })),
    };

    mockMentionProcessingService = {
      extractMentionTokens: jest.fn().mockReturnValue([]),
      validateMentions: jest.fn().mockResolvedValue([]),
    };

    mockReportService = {
      loadReportsForMessageIds: jest.fn().mockResolvedValue(new Map()),
    };

    const setup = await createServiceTestingModule({
      providers: [
        MessageService,
        PrismaService,
        RedisService,
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        {
          provide: MentionProcessingService,
          useValue: mockMentionProcessingService,
        },
        { provide: ReportService, useValue: mockReportService },
      ],
      overrides: [
        [PrismaService, mockPrisma],
        [RedisService, mockRedis],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
        [MentionProcessingService, mockMentionProcessingService],
        [ReportService, mockReportService],
      ],
    });

    service = setup.module.get<MessageService>(MessageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should create system message with userId="system" when not provided', async () => {
    const mockMessage = {
      ...TestUtils.createMockMessage(),
      createdAt: new Date(),
    };

    mockPrisma.message.create.mockResolvedValue(mockMessage);
    mockPrisma.conversation.findUnique.mockResolvedValue({ version: 0 });
    mockPrisma.conversation.update.mockResolvedValue({
      version: 1,
      projectId: testIds.project,
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
        uiElements: [],
        actions: [],
      },
      status: MessageStatus.Open,
    };

    await service.addMessage(createSystemMessage, testIds.organization, 'test');

    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'system',
        type: 'SYSTEM',
        projectId: testIds.project,
      }),
      include: {
        responses: true,
        parentMessage: true,
        conversation: { select: { workflowId: true } },
      },
    });
  });

  it('should create user message with provided userId', async () => {
    const mockMessage = {
      ...TestUtils.createMockUserMessage(),
      createdAt: new Date(),
    };

    mockPrisma.message.create.mockResolvedValue(mockMessage);
    mockPrisma.conversation.findUnique.mockResolvedValue({ version: 0 });
    mockPrisma.conversation.update.mockResolvedValue({
      version: 1,
      projectId: testIds.project,
    });

    const createUserMessage: any = {
      type: 'USER',
      workflowId: testIds.workflow,
      projectId: testIds.project,
      conversationId: testIds.conversation,
      userId: testIds.user,
      data: {
        message: 'Test user message',
      },
      status: MessageStatus.Open,
    };

    await service.addMessage(createUserMessage, testIds.organization, 'test');

    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: testIds.user,
        type: 'USER',
        projectId: testIds.project,
      }),
      include: {
        responses: true,
        parentMessage: true,
        conversation: { select: { workflowId: true } },
      },
    });
  });

  it('should allow custom userId for system messages', async () => {
    const mockMessage = {
      ...TestUtils.createMockMessage(),
      createdAt: new Date(),
    };

    mockPrisma.message.create.mockResolvedValue(mockMessage);
    mockPrisma.conversation.findUnique.mockResolvedValue({ version: 0 });
    mockPrisma.conversation.update.mockResolvedValue({
      version: 1,
      projectId: testIds.project,
    });

    const createSystemMessage: any = {
      type: 'SYSTEM',
      workflowId: testIds.workflow,
      projectId: testIds.project,
      conversationId: testIds.conversation,
      userId: 'custom-system-user',
      data: {
        type: 'QUESTIONS',
        response: 'Test system message',
        detectedIntent: 'test',
        intentConfidence: 0.9,
        uiElements: [],
        actions: [],
      },
      status: MessageStatus.Open,
    };

    await service.addMessage(createSystemMessage, testIds.organization, 'test');

    expect(mockPrisma.message.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'custom-system-user',
        type: 'SYSTEM',
      }),
      include: {
        responses: true,
        parentMessage: true,
        conversation: { select: { workflowId: true } },
      },
    });
  });
});
