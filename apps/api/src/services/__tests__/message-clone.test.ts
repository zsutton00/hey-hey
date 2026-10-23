import { Test, TestingModule } from '@nestjs/testing';
import { MessageService } from '../message.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { RedisService } from '../../core/redis/redis.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { ReportService } from '../reports/report.service';
import { MentionProcessingService } from '../mentions/mention-processing.service';
import * as TestUtils from '../../utils/testUtils';
import {
  ConversationId,
  OrganizationId,
  MessageId,
  ProjectId,
  WorkflowId,
  UserId,
} from '../../types';
import { MessageStatus } from '../../constants/message-status.constants';
import { SystemMessageResponseType } from '../../generated';
import * as uuid from 'uuid';

const { testIds } = TestUtils;

describe('MessageService - Clone Functionality', () => {
  let service: MessageService;
  let mockPrismaService: any;
  let mockEventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;

  beforeEach(async () => {
    mockPrismaService = TestUtils.createMockPrismaServiceWithTransactions();
    mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        { provide: PrismaService, useValue: mockPrismaService },
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
          },
        },
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        {
          provide: EntityRegistryService,
          useValue: {
            lookupEntityTypes: jest.fn(),
            getEntitiesByIds: jest.fn().mockResolvedValue([]),
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
    }).compile();

    service = module.get<MessageService>(MessageService);
    jest.clearAllMocks();
  });

  describe('cloneMessagesForConversation', () => {
    const sourceConversationId = testIds.conversation;
    const targetConversationId = 'new-conv-id' as ConversationId;
    const organizationId = testIds.organization;
    const targetNodeId = 'gather_feedback';

    const mockMessages = [
      {
        id: 'msg-1' as MessageId,
        conversationId: sourceConversationId,
        parentMessageId: null as MessageId | null,
        userId: 'system' as UserId,
        type: 'SYSTEM' as const,
        status: MessageStatus.Completed,
        projectId: testIds.project,
        workflowId: testIds.workflow,
        data: {
          type: 'QUESTIONS',
          nodeId: 'onboarding_clarify_concept',
          questions: ['What is your goal?'],
        },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        version: 1,
        conversation: { projectId: testIds.project },
      },
      {
        id: 'msg-2' as MessageId,
        conversationId: sourceConversationId,
        parentMessageId: 'msg-1' as MessageId,
        userId: testIds.user,
        type: 'USER' as const,
        status: MessageStatus.Completed,
        projectId: testIds.project,
        workflowId: testIds.workflow,
        data: {
          type: 'user',
          message: 'Build a project management tool',
        },
        createdAt: new Date('2024-01-02'),
        updatedAt: new Date('2024-01-02'),
        version: 1,
        conversation: { projectId: testIds.project },
      },
      {
        id: 'msg-3' as MessageId,
        conversationId: sourceConversationId,
        parentMessageId: 'msg-2' as MessageId,
        userId: 'system' as UserId,
        type: 'SYSTEM' as const,
        status: MessageStatus.Completed,
        projectId: testIds.project,
        workflowId: testIds.workflow,
        data: {
          type: 'ANALYSIS',
          nodeId: targetNodeId,
          analysis: { insights: ['Good project'] },
        },
        createdAt: new Date('2024-01-03'),
        updatedAt: new Date('2024-01-03'),
        version: 1,
        conversation: { projectId: testIds.project },
      },
      {
        id: 'msg-4' as MessageId,
        conversationId: sourceConversationId,
        parentMessageId: 'msg-3' as MessageId,
        userId: 'system' as UserId,
        type: 'SYSTEM' as const,
        status: MessageStatus.Completed,
        projectId: testIds.project,
        workflowId: testIds.workflow,
        data: {
          type: 'QUESTIONS',
          nodeId: 'later_node',
          questions: ['Should not be cloned'],
        },
        createdAt: new Date('2024-01-04'),
        updatedAt: new Date('2024-01-04'),
        version: 1,
        conversation: { projectId: testIds.project },
      },
    ];

    beforeEach(() => {
      let counter = 0;
      jest
        .spyOn(uuid, 'v4')
        .mockImplementation(() => `new-msg-${++counter}` as any);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should clone messages up to target node', async () => {
      (mockPrismaService.db.message.findMany as jest.Mock).mockResolvedValue(
        mockMessages.slice(0, 3) as any,
      );

      const result = await service.cloneMessagesForConversation(
        sourceConversationId,
        targetConversationId,
        targetNodeId,
        organizationId,
      );

      expect(mockPrismaService.db.message.findMany).toHaveBeenCalledWith({
        where: {
          conversationId: sourceConversationId,
          createdAt: { not: null },
          conversation: { organizationId },
        },
        orderBy: { createdAt: 'asc' },
        include: {
          conversation: { select: { projectId: true } },
        },
      });

      expect(mockPrismaService.db.message.create).toHaveBeenCalledTimes(3);
      expect(mockPrismaService.db.message.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          conversationId: targetConversationId,
          parentMessageId: null,
          data: expect.objectContaining({
            nodeId: 'onboarding_clarify_concept',
          }),
        }),
      });
      expect(mockPrismaService.db.message.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          conversationId: targetConversationId,
          parentMessageId: 'new-msg-1',
          data: expect.objectContaining({
            message: 'Build a project management tool',
          }),
        }),
      });
      expect(mockPrismaService.db.message.create).toHaveBeenNthCalledWith(3, {
        data: expect.objectContaining({
          conversationId: targetConversationId,
          parentMessageId: 'new-msg-2',
          data: expect.objectContaining({
            nodeId: targetNodeId,
          }),
        }),
      });

      expect(result).toEqual({
        messagesCloned: 3,
        messageIdMap: expect.any(Map),
        nodeIds: ['onboarding_clarify_concept', targetNodeId],
      });
      expect(result.messageIdMap.size).toBe(3);
      expect(result.messageIdMap.get('msg-1')).toBe('new-msg-1');
      expect(result.messageIdMap.get('msg-2')).toBe('new-msg-2');
      expect(result.messageIdMap.get('msg-3')).toBe('new-msg-3');
    });

    it('should handle empty message list', async () => {
      (mockPrismaService.db.message.findMany as jest.Mock).mockResolvedValue(
        [],
      );

      const result = await service.cloneMessagesForConversation(
        sourceConversationId,
        targetConversationId,
        targetNodeId,
        organizationId,
      );

      expect(result).toEqual({
        messagesCloned: 0,
        messageIdMap: expect.any(Map),
        nodeIds: [],
      });
      expect(result.messageIdMap.size).toBe(0);
      expect(mockPrismaService.db.message.create).not.toHaveBeenCalled();
    });

    it('should maintain message hierarchy with correct parent mappings', async () => {
      const [rootMessage, childMessage, grandchildMessage] = mockMessages;
      if (!rootMessage || !childMessage || !grandchildMessage) {
        throw new Error('Expected mock messages');
      }
      const complexMessages = [
        {
          ...rootMessage,
          id: 'root-1' as MessageId,
          parentMessageId: null,
        },
        {
          ...childMessage,
          id: 'child-1' as MessageId,
          parentMessageId: 'root-1' as MessageId,
        },
        {
          ...grandchildMessage,
          id: 'child-2' as MessageId,
          parentMessageId: 'root-1' as MessageId,
        },
        {
          ...grandchildMessage,
          id: 'grandchild-1' as MessageId,
          parentMessageId: 'child-1' as MessageId,
          data: { ...grandchildMessage.data, nodeId: targetNodeId },
        },
      ];

      (mockPrismaService.db.message.findMany as jest.Mock).mockResolvedValue(
        complexMessages as any,
      );

      const result = await service.cloneMessagesForConversation(
        sourceConversationId,
        targetConversationId,
        targetNodeId,
        organizationId,
      );

      expect(mockPrismaService.db.message.create).toHaveBeenCalledTimes(3);
      expect(mockPrismaService.db.message.create).toHaveBeenNthCalledWith(1, {
        data: expect.objectContaining({
          parentMessageId: null,
        }),
      });
      expect(mockPrismaService.db.message.create).toHaveBeenNthCalledWith(2, {
        data: expect.objectContaining({
          parentMessageId: 'new-msg-1',
        }),
      });
      expect(mockPrismaService.db.message.create).toHaveBeenNthCalledWith(3, {
        data: expect.objectContaining({
          parentMessageId: 'new-msg-1',
        }),
      });

      expect(result.messagesCloned).toBe(3);
    });
  });

  describe('deleteOpenerMessage', () => {
    const conversationId = testIds.conversation;
    const organizationId = testIds.organization;

    it('should delete opener message from conversation', async () => {
      const openerId = testIds.message;
      (mockPrismaService.db.message.findFirst as jest.Mock).mockResolvedValue({
        id: openerId,
      } as any);
      jest
        .spyOn(service, 'deleteMessage')
        .mockResolvedValueOnce(undefined as any);

      await service.deleteOpenerMessage(conversationId, organizationId);

      expect(mockPrismaService.db.message.findFirst).toHaveBeenCalledWith({
        where: {
          conversationId,
          createdAt: { not: null },
          conversation: {
            organizationId,
          },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(service.deleteMessage).toHaveBeenCalledWith(
        openerId,
        organizationId,
        'clone-cleanup',
      );
    });

    it('should handle no opener message gracefully', async () => {
      (mockPrismaService.db.message.findFirst as jest.Mock).mockResolvedValue(
        null as any,
      );
      jest
        .spyOn(service, 'deleteMessage')
        .mockResolvedValueOnce(undefined as any);

      await service.deleteOpenerMessage(conversationId, organizationId);

      expect(mockPrismaService.db.message.findFirst).toHaveBeenCalled();
      expect(service.deleteMessage).not.toHaveBeenCalled();
    });
  });

  describe('getMessagesByNodeId', () => {
    const conversationId = testIds.conversation;
    const targetNodeId = 'gather_feedback';
    const organizationId = testIds.organization;

    it('should return messages up to and including target node', async () => {
      const allMessages = [
        {
          id: 'msg-1',
          type: 'SYSTEM',
          data: {
            type: 'QUESTIONS',
            nodeId: 'start_node',
          },
          createdAt: new Date('2024-01-01'),
        },
        {
          id: 'msg-2',
          type: 'USER',
          data: {
            type: 'user',
            message: 'User response',
          },
          createdAt: new Date('2024-01-02'),
        },
        {
          id: 'msg-3',
          type: 'SYSTEM',
          data: {
            type: 'ANALYSIS',
            nodeId: targetNodeId,
          },
          createdAt: new Date('2024-01-03'),
        },
        {
          id: 'msg-4',
          type: 'SYSTEM',
          data: {
            type: 'QUESTIONS',
            nodeId: 'later_node',
          },
          createdAt: new Date('2024-01-04'),
        },
      ];

      (mockPrismaService.db.message.findMany as jest.Mock).mockResolvedValue(
        allMessages as any,
      );

      const result = await service.getMessagesByNodeId(
        conversationId,
        targetNodeId,
        organizationId,
      );

      expect(result).toHaveLength(3);
      const [first, second, third] = result;
      if (!first || !second || !third) {
        throw new Error('Expected message results');
      }
      expect(first.id).toBe('msg-1');
      expect(second.id).toBe('msg-2');
      expect(third.id).toBe('msg-3');
    });

    it('should return all messages if target node not found', async () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'USER',
          data: { type: 'user', message: 'Message 1' },
        },
        {
          id: 'msg-2',
          type: 'USER',
          data: { type: 'user', message: 'Message 2' },
        },
      ];

      (mockPrismaService.db.message.findMany as jest.Mock).mockResolvedValue(
        messages as any,
      );

      const result = await service.getMessagesByNodeId(
        conversationId,
        'non-existent-node',
        organizationId,
      );

      expect(result).toEqual(messages);
    });

    it('should handle system messages without nodeId', async () => {
      const messages = [
        {
          id: 'msg-1',
          type: 'SYSTEM',
          data: {
            type: 'NOOP',
            message: 'Generic system message',
          },
        },
        {
          id: 'msg-2',
          type: 'SYSTEM',
          data: {
            type: 'QUESTIONS',
            nodeId: targetNodeId,
          },
        },
        {
          id: 'msg-3',
          type: 'USER',
          data: { type: 'user', message: 'User message' },
        },
      ];

      (mockPrismaService.db.message.findMany as jest.Mock).mockResolvedValue(
        messages as any,
      );

      const result = await service.getMessagesByNodeId(
        conversationId,
        targetNodeId,
        organizationId,
      );

      expect(result).toHaveLength(2);
    });
  });
});
