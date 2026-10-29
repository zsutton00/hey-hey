import { EventContextManager } from '../../core/events/observable-event.context';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityType, Prisma, ReportEntityRelation } from '@prisma/client';
import { MessageStatus } from '../../constants/message-status.constants';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { RedisService } from '../../core/redis/redis.service';
import {
  GetMessagesQueryDto,
  MessageReadMode,
  SystemMessageData,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationId, MessageId, OrganizationId } from '../../types';
import * as TestUtils from '../../utils/testUtils';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { MentionProcessingService } from '../mentions/mention-processing.service';
import { MessageService } from '../message.service';
import { encodeConversationMessageHistoryCursor } from '../conversation-message-history-cursor';
import { ReportService } from '../reports/report.service';
const { testIds } = TestUtils;

describe('MessageService', () => {
  let service: MessageService;
  let prismaService: PrismaService;
  let eventPublisher: { publish: jest.Mock; publishInTransaction: jest.Mock };
  let mockEntityRegistryService: {
    lookupEntityTypes: jest.Mock;
  };
  let mockReportService: {
    loadReportsForMessageIds: jest.Mock;
  };

  const mockOrganizationId = testIds.organization;
  const mockMessageId = testIds.message;
  const mockProjectId = testIds.project;
  const mockConversationId = testIds.conversation;
  const mockWorkflowId = testIds.workflow;
  type UpdateMessageInput = Parameters<MessageService['updateMessage']>[2];

  const proposalReference = (id: string, position: number) => ({
    position,
    proposal: {
      id,
      organizationId: mockOrganizationId,
      projectId: mockProjectId,
      type: 'SINGLE',
      action: 'UPDATE',
      status: 'APPROVED',
      targetEntityId: mockProjectId,
      targetEntityType: 'PROJECT',
      title: id,
      updates: {},
      requestorId: testIds.user,
      requestorContext: { source: 'agent' },
      influences: null,
      generatedWithVersion: null,
      validationSessionId: null,
      conversationId: 'origin-conversation',
      messageId: 'origin-message',
      edges: null,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
      approvalRecords: [],
      groupMembership: {
        id: `membership-${id}`,
        groupId: 'proposal-group',
        proposalId: id,
        memberOrder: position,
        requiredApprovals: 0,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
        group: {
          status: 'READY',
          revision: 1,
          frozenRevision: 1,
        },
      },
    },
  });

  const mockMessage = TestUtils.createMockMessage({
    id: mockMessageId,
    projectId: mockProjectId,
    type: 'SYSTEM',
    status: MessageStatus.Open,
    userId: 'system',
    data: {
      type: 'QUESTIONS',
      nodeId: 'test-node',
      response: 'Test feedback',
      detectedIntent: '',
      intentConfidence: 0,
      uiElements: [],
      actions: [],
    },
    conversationId: mockConversationId,
    createdAt: '2024-01-01T00:00:00.000Z',
  });

  const mockSystemMessageDto: any = {
    workflowId: mockWorkflowId,
    projectId: mockProjectId,
    type: 'SYSTEM' as const,
    status: MessageStatus.Open,
    userId: 'system',
    data: {
      detectedIntent: '',
      intentConfidence: 0,
      type: 'QUESTIONS',
      nodeId: 'test-node',
      response: 'Test feedback',
      uiElements: [],
    },
    conversationId: mockConversationId,
    parentMessageId: undefined,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const mockUserMessageDto: any = {
    workflowId: mockWorkflowId,
    projectId: mockProjectId,
    type: 'USER' as const,
    status: MessageStatus.Open,
    userId: 'user-123',
    data: { comment: 'User message' },
    conversationId: mockConversationId,
    parentMessageId: testIds.parentMessage,
    createdAt: '2024-01-01T00:00:00.000Z',
  };

  const mockUpdateMessageDto: UpdateMessageInput = {
    status: MessageStatus.Completed,
    data: {
      type: 'QUESTIONS',
      nodeId: 'test-node',
      response: 'Updated feedback',
      detectedIntent: '',
      intentConfidence: 0,
      uiElements: [],
      actions: [],
    },
  };

  beforeEach(async () => {
    const mockPrismaService = TestUtils.createMockPrismaServiceWithTypes();
    eventPublisher = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };
    mockEntityRegistryService = {
      lookupEntityTypes: jest.fn(),
    };
    mockReportService = {
      loadReportsForMessageIds: jest.fn().mockResolvedValue(new Map()),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: eventPublisher,
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
          provide: EntityRegistryService,
          useValue: mockEntityRegistryService,
        },
        // Use the real MentionProcessingService so the existing
        // EntityRegistry assertions still exercise the same code path —
        // MentionProcessingService is the thin wrapper that now owns the
        // registry lookup MessageService used to do inline.
        MentionProcessingService,
        {
          provide: ReportService,
          useValue: mockReportService,
        },
      ],
    }).compile();

    service = module.get<MessageService>(MessageService);
    prismaService = module.get(PrismaService);
  });

  describe('getAgentSessionHistoryPage', () => {
    const agentSessionId = '123e4567-e89b-42d3-a456-426614174100';
    const newestId = '123e4567-e89b-42d3-a456-426614174103';
    const middleId = '123e4567-e89b-42d3-a456-426614174102';
    const oldestId = '123e4567-e89b-42d3-a456-426614174101';

    const row = (id: string, createdAt: string) => ({
      id,
      projectId: mockProjectId,
      conversationId: mockConversationId,
      type: 'SYSTEM',
      status: MessageStatus.Completed,
      userId: 'system',
      data: {
        type: 'NOOP',
        response: id,
        detectedIntent: '',
        intentConfidence: 0,
      },
      parentMessageId: null,
      createdAt: new Date(createdAt),
      conversation: { workflowId: mockWorkflowId },
      responses: [],
      parentMessage: null,
    });

    it('returns a stable newest-first page and a cursor only when older rows remain', async () => {
      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([
          row(newestId, '2026-08-28T12:00:02.000Z'),
          row(middleId, '2026-08-28T12:00:01.000Z'),
          row(oldestId, '2026-08-28T12:00:00.000Z'),
        ] as never);

      const result = await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId,
        conversationId: mockConversationId,
        limit: 2,
        maxMessageCharacters: 1_000_000,
      });

      expect(result.messages.map((message) => message.id)).toEqual([
        newestId,
        middleId,
      ]);
      expect(result.nextCursor).toEqual(expect.any(String));
      expect(prismaService.db.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 3,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('keeps whole messages within the size ceiling and points the cursor past the last one kept', async () => {
      const big = (id: string, createdAt: string) => ({
        ...row(id, createdAt),
        data: {
          ...row(id, createdAt).data,
          response: 'x'.repeat(10_000),
        },
      });
      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([
          big(newestId, '2026-08-28T12:00:02.000Z'),
          big(middleId, '2026-08-28T12:00:01.000Z'),
          big(oldestId, '2026-08-28T12:00:00.000Z'),
        ] as never);

      const page = (cursor?: string) =>
        service.getAgentSessionHistoryPage({
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          agentSessionId,
          conversationId: mockConversationId,
          cursor,
          limit: 2,
          maxMessageCharacters: 25_000,
        });

      const result = await page();
      expect(result.messages.map((message) => message.id)).toEqual([
        newestId,
        middleId,
      ]);
      // limit 2 of 3 rows fits the ceiling: the cursor still names the last
      // message returned.
      expect(
        JSON.parse(
          Buffer.from(result.nextCursor!, 'base64url').toString('utf8'),
        ).id,
      ).toBe(middleId);

      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([
          big(newestId, '2026-08-28T12:00:02.000Z'),
          big(middleId, '2026-08-28T12:00:01.000Z'),
        ] as never);
      const trimmed = await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId,
        conversationId: mockConversationId,
        limit: 2,
        maxMessageCharacters: 15_000,
      });
      expect(trimmed.messages.map((message) => message.id)).toEqual([newestId]);
      expect(
        JSON.parse(
          Buffer.from(trimmed.nextCursor!, 'base64url').toString('utf8'),
        ).id,
      ).toBe(newestId);
    });

    it('returns the newest message whole even when it alone exceeds the ceiling', async () => {
      jest.spyOn(prismaService.db.message, 'findMany').mockResolvedValue([
        {
          ...row(newestId, '2026-08-28T12:00:02.000Z'),
          data: {
            ...row(newestId, '2026-08-28T12:00:02.000Z').data,
            response: 'x'.repeat(10_000),
          },
        },
        row(middleId, '2026-08-28T12:00:01.000Z'),
      ] as never);

      const result = await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId,
        conversationId: mockConversationId,
        limit: 2,
        maxMessageCharacters: 100,
      });

      expect(result.messages.map((message) => message.id)).toEqual([newestId]);
      expect(result.nextCursor).toEqual(expect.any(String));
    });

    it('returns ordered Proposal references in Agent Session history', async () => {
      jest.spyOn(prismaService.db.message, 'findMany').mockResolvedValue([
        {
          ...row(newestId, '2026-08-28T12:00:02.000Z'),
          proposalReferences: [
            proposalReference('proposal-second', 0),
            proposalReference('proposal-first', 1),
          ],
        },
      ] as never);

      const result = await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId,
        conversationId: mockConversationId,
        limit: 2,
        maxMessageCharacters: 1_000_000,
      });

      expect(
        result.messages[0]?.proposals?.map((proposal) => proposal.id),
      ).toEqual(['proposal-second', 'proposal-first']);
      expect(prismaService.db.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            proposalReferences: expect.objectContaining({
              orderBy: { position: 'asc' },
            }),
          }),
        }),
      );
    });

    it('uses the prior page anchor exclusively and omits a cursor on the final page', async () => {
      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValueOnce([
          row(newestId, '2026-08-28T12:00:02.000Z'),
          row(middleId, '2026-08-28T12:00:01.000Z'),
          row(oldestId, '2026-08-28T12:00:00.000Z'),
        ] as never)
        .mockResolvedValueOnce([
          row(oldestId, '2026-08-28T12:00:00.000Z'),
        ] as never);
      jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue({ id: middleId } as never);

      const first = await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId,
        conversationId: mockConversationId,
        limit: 2,
        maxMessageCharacters: 1_000_000,
      });
      const second = await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId,
        conversationId: mockConversationId,
        cursor: first.nextCursor,
        limit: 2,
        maxMessageCharacters: 1_000_000,
      });

      expect(second.messages.map((message) => message.id)).toEqual([oldestId]);
      expect(second.nextCursor).toBeUndefined();
      expect(prismaService.db.message.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [
              { createdAt: { lt: new Date('2026-08-28T12:00:01.000Z') } },
              {
                createdAt: new Date('2026-08-28T12:00:01.000Z'),
                id: { lt: middleId },
              },
            ],
          }),
        }),
      );
    });

    it('rejects a cursor bound to another Agent Session before querying its anchor', async () => {
      const cursor = Buffer.from(
        JSON.stringify({
          version: 1,
          agentSessionId: '123e4567-e89b-42d3-a456-426614174999',
          conversationId: mockConversationId,
          createdAt: '2026-08-28T12:00:01.000Z',
          id: middleId,
        }),
        'utf8',
      ).toString('base64url');

      await expect(
        service.getAgentSessionHistoryPage({
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          agentSessionId,
          conversationId: mockConversationId,
          cursor,
          limit: 2,
          maxMessageCharacters: 1_000_000,
        }),
      ).rejects.toThrow('cursor is invalid');
      expect(prismaService.db.message.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('getMessage', () => {
    it('should return a message when found', async () => {
      jest.spyOn(prismaService.db.message, 'findFirst').mockResolvedValue({
        ...TestUtils.createMockDbMessage({
          id: mockMessageId,
          workflowId: mockWorkflowId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          status: MessageStatus.Completed,
          userId: 'system',
          data: {
            type: 'QUESTIONS',
            nodeId: 'test-node',
            response: 'Test feedback',
            detectedIntent: '',
            intentConfidence: 0,
            uiElements: [],
            actions: [],
          },
          createdAt: new Date('2024-01-01'),
        }),
        proposalReferences: [
          proposalReference('proposal-first', 0),
          proposalReference('proposal-second', 1),
        ],
      } as never);

      const result = await service.getMessage(
        mockMessageId,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockMessageId);
      expect(result?.proposals?.map((proposal) => proposal.id)).toEqual([
        'proposal-first',
        'proposal-second',
      ]);
      expect(prismaService.db.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockMessageId,
          conversation: {
            organizationId: mockOrganizationId,
          },
        },
        include: {
          responses: true,
          parentMessage: true,
          proposalReferences: {
            where: expect.any(Object),
            include: {
              proposal: { include: { approvalRecords: true } },
            },
            orderBy: { position: 'asc' },
          },
          conversation: { select: { workflowId: true } },
        },
      });
    });

    it('should return null when message not found', async () => {
      jest.spyOn(prismaService.db.message, 'findFirst').mockResolvedValue(null);

      const result = await service.getMessage(
        'non-existent' as MessageId,
        mockOrganizationId,
      );

      expect(result).toBeNull();
    });

    it('should respect includeResponses parameter', async () => {
      jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue(TestUtils.createMockDbMessage());

      await service.getMessage(mockMessageId, mockOrganizationId, false);

      expect(prismaService.db.message.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockMessageId,
          conversation: {
            organizationId: mockOrganizationId,
          },
        },
        include: {
          responses: false,
          parentMessage: true,
          proposalReferences: {
            where: expect.any(Object),
            include: {
              proposal: { include: { approvalRecords: true } },
            },
            orderBy: { position: 'asc' },
          },
          conversation: { select: { workflowId: true } },
        },
      });
    });
  });

  describe('getMessages', () => {
    const mockQuery: GetMessagesQueryDto = {
      projectId: mockProjectId,
      conversationId: mockConversationId,
      page: 1,
      limit: 10,
    };

    it('should return messages with proper filtering and pagination', async () => {
      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([TestUtils.createMockDbMessage()]);

      const result = await service.getMessages(mockQuery, mockOrganizationId);

      expect(result).toHaveLength(1);
      expect(prismaService.db.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversation: {
              organizationId: mockOrganizationId,
            },
            projectId: mockProjectId,
            conversationId: mockConversationId,
            // Undated queued inputs are not in the timeline.
            createdAt: { not: null },
          },
          skip: 0,
          take: 10,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('reloads foreign proposal references in order through history and append delta', async () => {
      const references = [
        proposalReference('foreign-second', 0),
        proposalReference('foreign-first', 1),
      ];
      const row = {
        ...TestUtils.createMockDbMessage({ status: MessageStatus.Completed }),
        proposalReferences: references,
      };
      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([row] as never);
      jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue(TestUtils.createMockDbMessage());
      for (const query of [mockQuery, { ...mockQuery, since: mockMessageId }]) {
        const messages = await service.getMessages(query, mockOrganizationId);
        expect(messages[0]?.proposals?.map((proposal) => proposal.id)).toEqual([
          'foreign-second',
          'foreign-first',
        ]);
        expect(
          messages[0]?.proposals?.map((proposal) => proposal.conversationId),
        ).toEqual(['origin-conversation', 'origin-conversation']);
        expect(
          messages[0]?.proposals?.map((proposal) => proposal.messageId),
        ).toEqual(['origin-message', 'origin-message']);
      }
    });

    it('uses persisted group lifecycle to hide BUILDING proposals while exposing frozen review proposals', async () => {
      const findMany = jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([]);

      await service.getMessages(mockQuery, mockOrganizationId);

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            proposalReferences: {
              where: {
                proposal: {
                  NOT: {
                    groupMembership: {
                      is: {
                        group: {
                          is: { status: 'BUILDING' },
                        },
                      },
                    },
                  },
                },
              },
              include: { proposal: { include: { approvalRecords: true } } },
              orderBy: { position: 'asc' },
            },
          }),
        }),
      );
    });

    it('should handle pagination correctly', async () => {
      const queryWithPagination = { ...mockQuery, page: 2, limit: 5 };
      jest.spyOn(prismaService.db.message, 'findMany').mockResolvedValue([]);

      await service.getMessages(
        queryWithPagination,
        'org-123' as OrganizationId,
      );

      expect(prismaService.db.message.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
        }),
      );
    });

    describe('with `since` cursor', () => {
      const cursorId = 'msg-cursor' as MessageId;
      const cursorCreatedAt = new Date('2024-01-02T00:00:00.000Z');
      const cursorMessage = TestUtils.createMockDbMessage({
        id: cursorId,
        conversationId: mockConversationId,
        createdAt: cursorCreatedAt,
      });

      it('returns only messages after the cursor in (createdAt, id) order', async () => {
        const findFirst = jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue(cursorMessage);
        const findMany = jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValue([TestUtils.createMockDbMessage()]);

        await service.getMessages(
          { ...mockQuery, since: cursorId },
          mockOrganizationId,
        );

        expect(findFirst).toHaveBeenCalledWith({
          where: {
            id: cursorId,
            conversationId: mockConversationId,
            // An undated queued input is never a valid cursor.
            createdAt: { not: null },
            conversation: { organizationId: mockOrganizationId },
          },
          select: { id: true, createdAt: true },
        });
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: [
                { createdAt: { gt: cursorCreatedAt } },
                {
                  createdAt: cursorCreatedAt,
                  id: { gt: cursorId },
                },
              ],
            }),
            skip: 0,
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
        );
      });

      it('throws NotFoundException when the cursor id is unknown', async () => {
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue(null);

        await expect(
          service.getMessages(
            { ...mockQuery, since: 'msg-missing' as MessageId },
            mockOrganizationId,
          ),
        ).rejects.toThrow('Cursor message msg-missing not found');
      });

      it('throws NotFoundException when the cursor belongs to a different conversation', async () => {
        // findFirst is scoped to the requested conversationId, so a cursor from
        // another conversation simply returns null.
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue(null);

        await expect(
          service.getMessages(
            { ...mockQuery, since: cursorId },
            mockOrganizationId,
          ),
        ).rejects.toThrow(/not found in conversation/);
      });

      it('throws BadRequestException when `since` is set without conversationId', async () => {
        await expect(
          service.getMessages(
            { projectId: mockProjectId, since: cursorId },
            mockOrganizationId,
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('includes a prepended message whose createdAt is later than the cursor', async () => {
        const prepended = TestUtils.createMockDbMessage({
          id: 'msg-prepended' as MessageId,
          createdAt: new Date('2024-01-03T00:00:00.000Z'),
        });
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue(cursorMessage);
        const findMany = jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValue([prepended]);

        const result = await service.getMessages(
          { ...mockQuery, since: cursorId },
          mockOrganizationId,
        );

        expect(result).toHaveLength(1);
        expect(result[0]?.id).toBe('msg-prepended');
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
        );
      });
    });

    describe('with reverse-history mode', () => {
      const historyQuery: GetMessagesQueryDto = {
        conversationId: mockConversationId,
        mode: MessageReadMode.ReverseHistory,
        limit: 2,
      };
      const newestId = '11111111-1111-4111-8111-111111111111' as MessageId;
      const middleId = '22222222-2222-4222-8222-222222222222' as MessageId;
      const oldestId = '33333333-3333-4333-8333-333333333333' as MessageId;

      it('selects newest rows stably and returns the page chronologically', async () => {
        const newest = TestUtils.createMockDbMessage({
          id: newestId,
          createdAt: new Date('2026-09-21T03:00:00.000Z'),
        });
        const middle = TestUtils.createMockDbMessage({
          id: middleId,
          createdAt: new Date('2026-09-21T02:00:00.000Z'),
        });
        const oldest = TestUtils.createMockDbMessage({
          id: oldestId,
          createdAt: new Date('2026-09-21T01:00:00.000Z'),
        });
        const findMany = jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValue([newest, middle, oldest]);

        const result = await service.getMessagesForAdapter(
          historyQuery,
          mockOrganizationId,
          mockProjectId,
          true,
          true,
          false,
        );

        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              conversationId: mockConversationId,
              projectId: mockProjectId,
              conversation: {
                id: mockConversationId,
                organizationId: mockOrganizationId,
                projectId: mockProjectId,
              },
            }),
            take: 3,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          }),
        );
        expect(result).toEqual(
          expect.objectContaining({
            messages: [
              expect.objectContaining({ id: middleId }),
              expect.objectContaining({ id: newestId }),
            ],
            nextCursor: expect.any(String),
          }),
        );
      });

      it('uses the cursor tuple for the next older page and preserves associations', async () => {
        const firstRows = [
          TestUtils.createMockDbMessage({
            id: newestId,
            createdAt: new Date('2026-09-21T02:00:00.000Z'),
          }),
          TestUtils.createMockDbMessage({
            id: oldestId,
            createdAt: new Date('2026-09-21T01:00:00.000Z'),
          }),
          TestUtils.createMockDbMessage({
            id: middleId,
            createdAt: new Date('2026-09-21T01:00:00.000Z'),
          }),
        ];
        jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValueOnce(firstRows)
          .mockResolvedValueOnce([
            TestUtils.createMockDbMessage({
              id: middleId,
              createdAt: new Date('2026-09-21T01:00:00.000Z'),
            }),
          ]);
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue({ id: oldestId } as never);
        mockReportService.loadReportsForMessageIds.mockResolvedValue(
          new Map([[middleId, [{ id: 'report-1' }]]]),
        );

        const first = await service.getMessagesForAdapter(
          historyQuery,
          mockOrganizationId,
          mockProjectId,
          true,
          true,
          false,
        );
        if (Array.isArray(first) || !first.nextCursor) {
          throw new Error('Expected a reverse-history continuation cursor');
        }
        const second = await service.getMessagesForAdapter(
          { ...historyQuery, historyCursor: first.nextCursor },
          mockOrganizationId,
          mockProjectId,
          true,
          true,
          true,
        );

        expect(prismaService.db.message.findMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              OR: [
                { createdAt: { lt: new Date('2026-09-21T01:00:00.000Z') } },
                {
                  createdAt: new Date('2026-09-21T01:00:00.000Z'),
                  id: { lt: oldestId },
                },
              ],
            }),
            include: expect.objectContaining({
              proposalReferences: expect.any(Object),
            }),
          }),
        );
        expect(second).toEqual({
          messages: [
            expect.objectContaining({
              id: middleId,
              reports: [{ id: 'report-1' }],
            }),
          ],
        });
      });

      it('rejects invalid mode combinations without changing legacy reads', async () => {
        await expect(
          service.getMessagesForAdapter(
            { ...historyQuery, since: mockMessageId },
            mockOrganizationId,
            mockProjectId,
            true,
            true,
            false,
          ),
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.getMessages(
            { conversationId: mockConversationId, historyCursor: 'cursor' },
            mockOrganizationId,
          ),
        ).rejects.toThrow('`historyCursor` requires `mode=REVERSE_HISTORY`');
      });
    });

    describe('with includeReports', () => {
      it('does not call the report loader when includeReports is false (default)', async () => {
        jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValue([TestUtils.createMockDbMessage()]);

        await service.getMessages(mockQuery, mockOrganizationId);

        expect(
          mockReportService.loadReportsForMessageIds,
        ).not.toHaveBeenCalled();
      });

      it('calls the report loader and attaches reports per message when includeReports=true', async () => {
        const dbMessage = TestUtils.createMockDbMessage({
          id: mockMessageId,
        });
        jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValue([dbMessage]);
        const fakeReport = { id: 'report-1' } as any;
        mockReportService.loadReportsForMessageIds.mockResolvedValue(
          new Map([[mockMessageId, [fakeReport]]]),
        );

        const result = await service.getMessages(
          mockQuery,
          mockOrganizationId,
          true,
          true,
          true,
        );

        expect(mockReportService.loadReportsForMessageIds).toHaveBeenCalledWith(
          mockOrganizationId,
          [mockMessageId],
        );
        expect(result).toHaveLength(1);
        expect(result[0]?.reports).toEqual([fakeReport]);
      });

      it('attaches an empty array of reports to messages that have no linked reports', async () => {
        const dbMessage = TestUtils.createMockDbMessage({
          id: mockMessageId,
        });
        jest
          .spyOn(prismaService.db.message, 'findMany')
          .mockResolvedValue([dbMessage]);
        mockReportService.loadReportsForMessageIds.mockResolvedValue(new Map());

        const result = await service.getMessages(
          mockQuery,
          mockOrganizationId,
          true,
          true,
          true,
        );

        expect(result[0]?.reports).toEqual([]);
      });
    });
  });

  describe('addMessage', () => {
    const makeAttachmentTx = (options: {
      proposals?: Array<Record<string, unknown>>;
      reports?: unknown[];
      proposalUpdateCount?: number;
      proposalGroupUpdateCount?: number;
    }) => {
      const createdMessage = TestUtils.createMockDbMessage({
        id: mockMessageId,
        projectId: mockProjectId,
        conversationId: mockConversationId,
        status: MessageStatus.Completed.toString(),
        userId: 'system',
        data: mockSystemMessageDto.data,
      });
      return {
        message: {
          create: jest.fn().mockResolvedValue(createdMessage),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            workflowId: mockWorkflowId,
            workflowAboutId: null,
            workflowAboutType: null,
          }),
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
        proposal: {
          findMany: jest.fn().mockResolvedValue(
            (options.proposals ?? []).map((proposal) => ({
              conversationId: mockConversationId,
              ...proposal,
            })),
          ),
          updateMany: jest.fn().mockResolvedValue({
            count:
              options.proposalUpdateCount ?? options.proposals?.length ?? 0,
          }),
        },
        messageProposalReference: {
          createMany: jest.fn().mockResolvedValue({
            count: options.proposals?.length ?? 0,
          }),
        },
        proposalGroup: {
          updateMany: jest.fn().mockResolvedValue({
            count: options.proposalGroupUpdateCount ?? 0,
          }),
        },
        report: {
          findMany: jest.fn().mockResolvedValue(options.reports ?? []),
        },
        reportEntity: {
          createMany: jest.fn(),
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
      };
    };

    const runInTransaction = (tx: any) => {
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(tx),
        );
    };

    it('keeps omitted and empty attachment sets on the existing zero-attachment path', async () => {
      const tx = makeAttachmentTx({});
      runInTransaction(tx);

      await service.addMessage(
        {
          ...mockSystemMessageDto,
          proposalIds: [],
          reportIds: [],
        },
        mockOrganizationId,
        'test-source',
      );

      expect(tx.proposal.findMany).not.toHaveBeenCalled();
      expect(tx.report.findMany).not.toHaveBeenCalled();
      expect(tx.proposal.updateMany).not.toHaveBeenCalled();
      expect(tx.reportEntity.createMany).not.toHaveBeenCalled();
    });

    it('attaches one UPDATE-action Proposal without claiming unrelated artifacts', async () => {
      const tx = makeAttachmentTx({
        proposals: [
          {
            id: 'proposal-update',
            action: 'UPDATE',
            messageId: null,
            groupMembership: null,
          },
        ],
      });
      runInTransaction(tx);

      await service.addMessage(
        {
          ...mockSystemMessageDto,
          status: MessageStatus.Completed,
          proposalIds: ['proposal-update'],
        },
        mockOrganizationId,
        'test-source',
      );

      expect(tx.proposal.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: ['proposal-update'] },
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          messageId: null,
        },
        data: { messageId: mockMessageId },
      });
      expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
      expect(tx.reportEntity.createMany).not.toHaveBeenCalled();
    });

    it('attaches mixed ungrouped and fully represented grouped Proposals plus Reports before publication', async () => {
      const group = {
        id: 'proposal-group',
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        conversationId: mockConversationId,
        messageId: null,
        members: [
          { proposalId: 'proposal-grouped-1' },
          { proposalId: 'proposal-grouped-2' },
        ],
      };
      const tx = makeAttachmentTx({
        proposals: [
          {
            id: 'proposal-ungrouped',
            action: 'UPDATE',
            messageId: null,
            groupMembership: null,
          },
          {
            id: 'proposal-grouped-1',
            action: 'UPDATE',
            messageId: null,
            groupMembership: { groupId: group.id, group },
          },
          {
            id: 'proposal-grouped-2',
            action: 'UPDATE',
            messageId: null,
            groupMembership: { groupId: group.id, group },
          },
        ],
        reports: [
          { id: 'report-1', reportEntities: [] },
          { id: 'report-2', reportEntities: [] },
        ],
        proposalGroupUpdateCount: 1,
      });
      runInTransaction(tx);

      await service.addMessage(
        {
          ...mockSystemMessageDto,
          status: MessageStatus.Completed,
          proposalIds: [
            'proposal-ungrouped',
            'proposal-grouped-1',
            'proposal-grouped-2',
          ],
          reportIds: ['report-1', 'report-2'],
        },
        mockOrganizationId,
        'test-source',
      );

      expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
      expect(tx.$queryRaw.mock.invocationCallOrder[1]).toBeLessThan(
        tx.report.findMany.mock.invocationCallOrder[0]!,
      );
      expect(tx.proposal.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.proposalGroup.updateMany).toHaveBeenCalledWith({
        where: {
          id: { in: [group.id] },
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          OR: [
            { conversationId: null },
            { conversationId: mockConversationId },
          ],
          messageId: null,
        },
        data: { messageId: mockMessageId },
      });
      expect(tx.reportEntity.createMany).toHaveBeenCalledWith({
        data: [
          {
            reportId: 'report-1',
            entityType: EntityType.MESSAGE,
            entityId: mockMessageId,
            relation: ReportEntityRelation.CONTEXT,
          },
          {
            reportId: 'report-2',
            entityType: EntityType.MESSAGE,
            entityId: mockMessageId,
            relation: ReportEntityRelation.CONTEXT,
          },
        ],
      });

      const publicationCalls = eventPublisher.publishInTransaction.mock.calls;
      const messageCreatedCallIndex = publicationCalls.findIndex(
        ([, event]) => event.type === 'message.created',
      );
      expect(messageCreatedCallIndex).toBeGreaterThanOrEqual(0);
      const messageCreatedCall = publicationCalls[messageCreatedCallIndex];
      expect(messageCreatedCall?.[1].payload.message).not.toHaveProperty(
        'proposalIds',
      );
      expect(messageCreatedCall?.[1].payload.message).not.toHaveProperty(
        'reportIds',
      );
      expect(
        tx.reportEntity.createMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        eventPublisher.publishInTransaction.mock.invocationCallOrder[
          messageCreatedCallIndex
        ]!,
      );
      expect(
        publicationCalls.filter(
          ([, event]) => event.type === 'conversation.updated',
        ),
      ).toHaveLength(1);
    });

    it('does not attach a partially represented Proposal Group', async () => {
      const group = {
        id: 'partial-proposal-group',
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        conversationId: mockConversationId,
        messageId: null,
        members: [{ proposalId: 'proposal-1' }, { proposalId: 'proposal-2' }],
      };
      const tx = makeAttachmentTx({
        proposals: [
          {
            id: 'proposal-1',
            messageId: null,
            groupMembership: { groupId: group.id, group },
          },
        ],
      });
      runInTransaction(tx);

      await service.addMessage(
        {
          ...mockSystemMessageDto,
          proposalIds: ['proposal-1'],
        },
        mockOrganizationId,
        'test-source',
      );

      expect(tx.proposal.updateMany).toHaveBeenCalledTimes(1);
      expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
    });

    it('rejects duplicate and missing attachments before creating or publishing a Message', async () => {
      const duplicateTx = makeAttachmentTx({});
      runInTransaction(duplicateTx);

      await expect(
        service.addMessage(
          {
            ...mockSystemMessageDto,
            proposalIds: ['duplicate-proposal', 'duplicate-proposal'],
          },
          mockOrganizationId,
          'test-source',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(duplicateTx.proposal.findMany).not.toHaveBeenCalled();
      expect(duplicateTx.message.create).not.toHaveBeenCalled();
      expect(
        duplicateTx.messageProposalReference.createMany,
      ).not.toHaveBeenCalled();
      expect(duplicateTx.conversation.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();

      const missingTx = makeAttachmentTx({});
      runInTransaction(missingTx);

      await expect(
        service.addMessage(
          {
            ...mockSystemMessageDto,
            proposalIds: ['missing-proposal'],
          },
          mockOrganizationId,
          'test-source',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(missingTx.proposal.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: { in: ['missing-proposal'] },
            organizationId: mockOrganizationId,
            projectId: mockProjectId,
          },
        }),
      );
      expect(missingTx.message.create).not.toHaveBeenCalled();
      expect(
        missingTx.messageProposalReference.createMany,
      ).not.toHaveBeenCalled();
      expect(missingTx.conversation.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });

    it.each([null, 'origin-message'])(
      'presents foreign approved visuals and groups without claiming their %s homes',
      async (home) => {
        const group = {
          id: 'foreign-group',
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          conversationId: 'origin-conversation',
          messageId: home,
          members: [{ proposalId: 'foreign-visual' }],
        };
        const tx = makeAttachmentTx({
          proposals: [
            { id: 'local-new', messageId: null, groupMembership: null },
            {
              id: 'foreign-visual',
              conversationId: 'origin-conversation',
              messageId: home,
              status: 'APPROVED',
              targetEntityType: 'TASK',
              updates: { type: 'mockup' },
              groupMembership: { groupId: group.id, group },
            },
            {
              id: 'foreign-ungrouped',
              conversationId: 'origin-conversation',
              messageId: home,
              groupMembership: null,
            },
          ],
          proposalUpdateCount: 1,
        });
        runInTransaction(tx);
        const proposalIds = [
          'foreign-visual',
          'local-new',
          'foreign-ungrouped',
        ];
        await service.addMessage(
          {
            ...mockSystemMessageDto,
            status: MessageStatus.Completed,
            proposalIds,
          },
          mockOrganizationId,
          'test-source',
        );
        expect(tx.proposal.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              id: { in: proposalIds },
              organizationId: mockOrganizationId,
              projectId: mockProjectId,
            },
          }),
        );
        expect(tx.proposal.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              id: { in: ['local-new'] },
              conversationId: mockConversationId,
            }),
            data: { messageId: mockMessageId },
          }),
        );
        expect(tx.proposalGroup.updateMany).not.toHaveBeenCalled();
        expect(tx.messageProposalReference.createMany).toHaveBeenCalledWith({
          data: proposalIds.map((proposalId, position) => ({
            messageId: mockMessageId,
            proposalId,
            position,
          })),
        });
        expect(tx.conversation.update).toHaveBeenCalledTimes(1);
        expect(eventPublisher.publishInTransaction).toHaveBeenCalled();
      },
    );

    it.each(['projectId', 'organizationId'])(
      'rejects a foreign %s before any publication writes',
      async (scopeKey) => {
        const tx = makeAttachmentTx({});
        const foreign = {
          id: 'foreign-proposal',
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
          [scopeKey]: 'outside-scope',
        };
        tx.proposal.findMany.mockImplementation(async ({ where }) =>
          foreign.organizationId === where.organizationId &&
          foreign.projectId === where.projectId
            ? [foreign]
            : [],
        );
        runInTransaction(tx);
        await expect(
          service.addMessage(
            { ...mockSystemMessageDto, proposalIds: [foreign.id] },
            mockOrganizationId,
            'test-source',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(tx.message.create).not.toHaveBeenCalled();
        expect(tx.messageProposalReference.createMany).not.toHaveBeenCalled();
        expect(tx.conversation.update).not.toHaveBeenCalled();
        expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
      },
    );

    it.each(['invalid-group', 'foreign-report'])(
      'rejects %s atomically alongside valid foreign references',
      async (invalid) => {
        const tx = makeAttachmentTx({
          proposals: [
            {
              id: 'foreign',
              conversationId: 'origin-conversation',
              messageId: 'origin-message',
              groupMembership:
                invalid === 'invalid-group'
                  ? { groupId: 'missing-group', group: null }
                  : null,
            },
          ],
          reports:
            invalid === 'foreign-report'
              ? [
                  {
                    id: 'report',
                    reportEntities: [
                      {
                        entityType: EntityType.CONVERSATION,
                        entityId: 'origin-conversation',
                      },
                    ],
                  },
                ]
              : [],
        });
        runInTransaction(tx);
        await expect(
          service.addMessage(
            {
              ...mockSystemMessageDto,
              proposalIds: ['foreign'],
              reportIds: invalid === 'foreign-report' ? ['report'] : [],
            },
            mockOrganizationId,
            'test-source',
          ),
        ).rejects.toThrow(BadRequestException);
        expect(tx.message.create).not.toHaveBeenCalled();
        expect(tx.messageProposalReference.createMany).not.toHaveBeenCalled();
        expect(tx.conversation.update).not.toHaveBeenCalled();
        expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
      },
    );

    it('accepts same-scope owned Proposals without re-homing and rejects owned Reports', async () => {
      const proposalTx = makeAttachmentTx({
        proposals: [
          {
            id: 'owned-proposal',
            messageId: 'existing-message',
            groupMembership: null,
          },
        ],
      });
      runInTransaction(proposalTx);

      await service.addMessage(
        {
          ...mockSystemMessageDto,
          proposalIds: ['owned-proposal'],
        },
        mockOrganizationId,
        'test-source',
      );
      expect(proposalTx.proposal.updateMany).not.toHaveBeenCalled();
      expect(
        proposalTx.messageProposalReference.createMany,
      ).toHaveBeenCalledWith({
        data: [
          {
            messageId: mockMessageId,
            proposalId: 'owned-proposal',
            position: 0,
          },
        ],
      });

      const reportTx = makeAttachmentTx({
        reports: [
          {
            id: 'owned-report',
            reportEntities: [
              {
                entityType: EntityType.MESSAGE,
                entityId: 'existing-message',
                relation: ReportEntityRelation.CONTEXT,
              },
            ],
          },
        ],
      });
      runInTransaction(reportTx);

      await expect(
        service.addMessage(
          {
            ...mockSystemMessageDto,
            reportIds: ['owned-report'],
          },
          mockOrganizationId,
          'test-source',
        ),
      ).rejects.toThrow(ConflictException);
      expect(reportTx.message.create).not.toHaveBeenCalled();
      expect(reportTx.reportEntity.createMany).not.toHaveBeenCalled();
      expect(
        reportTx.messageProposalReference.createMany,
      ).not.toHaveBeenCalled();
      expect(reportTx.conversation.update).not.toHaveBeenCalled();
    });

    it('rolls back attachment work and can retry the same set with one conversation.updated', async () => {
      const tx = makeAttachmentTx({
        proposals: [
          {
            id: 'retry-proposal',
            messageId: null,
            groupMembership: null,
          },
        ],
        reports: [{ id: 'retry-report', reportEntities: [] }],
      });
      tx.conversation.update
        .mockRejectedValueOnce(new Error('version update failed'))
        .mockResolvedValue({ version: 2, projectId: mockProjectId });
      runInTransaction(tx);
      const dto = {
        ...mockSystemMessageDto,
        status: MessageStatus.Completed,
        proposalIds: ['retry-proposal'],
        reportIds: ['retry-report'],
      };

      await expect(
        service.addMessage(dto, mockOrganizationId, 'test-source'),
      ).rejects.toThrow('Failed to create Message entry');

      await service.addMessage(dto, mockOrganizationId, 'test-source');

      expect(tx.proposal.updateMany).toHaveBeenCalledTimes(2);
      expect(tx.reportEntity.createMany).toHaveBeenCalledTimes(2);
      expect(
        eventPublisher.publishInTransaction.mock.calls.filter(
          ([, event]) => event.type === 'conversation.updated',
        ),
      ).toHaveLength(1);
    });

    it('should fail fast when USER message userId is missing', async () => {
      const dtoWithoutUserId = {
        ...mockUserMessageDto,
        userId: undefined,
      };

      await expect(
        service.addMessage(dtoWithoutUserId, mockOrganizationId, 'test-source'),
      ).rejects.toThrow(BadRequestException);

      expect(prismaService.$transaction).not.toHaveBeenCalled();
    });

    it('should map parent_message_id FK violations to bad request', async () => {
      const txMock = {
        message: {
          create: jest.fn().mockRejectedValue({
            code: 'P2003',
            meta: { field_name: 'messages_parent_message_id_fkey' },
          }),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 0,
            workflowId: mockWorkflowId,
            workflowAboutId: null,
            workflowAboutType: null,
          }),
          update: jest.fn(),
        },
        messageMention: {
          createMany: jest.fn(),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await expect(
        service.addMessage(
          mockUserMessageDto,
          mockOrganizationId,
          'test-source',
        ),
      ).rejects.toThrow(
        `Invalid parentMessageId: ${mockUserMessageDto.parentMessageId}`,
      );
    });

    it('should create a message with events', async () => {
      // The transaction callback will be called with the transaction mock

      // Mock the transaction methods
      const txMock = {
        message: {
          create: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              workflowId: mockWorkflowId,
              projectId: mockProjectId,
              conversationId: mockConversationId,
              status: MessageStatus.Open.toString(),
              userId: 'system',
              data: {
                type: 'QUESTIONS',
                nodeId: 'test-node',
                response: 'Test feedback',
                detectedIntent: '',
                intentConfidence: 0,
                uiElements: [],
                actions: [],
              },
            }),
          ),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
            workflowAboutId: 'design-doc-123',
            workflowAboutType: 'design-doc',
          }),
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
        messageMention: {
          createMany: jest.fn(),
        },
        proposal: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const result = await service.addMessage(
        mockSystemMessageDto,
        mockOrganizationId,
        'test-source',
      );

      expect(result).toBeDefined();
      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it('preserves supplied message exclusion without consulting attempt reports', async () => {
      const attemptId = '77777777-7777-4777-8777-777777777777';
      const txMock = {
        message: {
          create: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              projectId: mockProjectId,
              conversationId: mockConversationId,
              status: MessageStatus.Open.toString(),
              userId: 'system',
            }),
          ),
        },
        report: {
          findFirst: jest.fn().mockResolvedValue({ id: attemptId }),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
            workflowAboutId: null,
            workflowAboutType: null,
          }),
          update: jest.fn().mockResolvedValue({ version: 2 }),
        },
        messageMention: { createMany: jest.fn() },
        proposal: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      };
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const contextManager = EventContextManager.getInstance();
      await contextManager.runWithContext(
        contextManager.createInitialContext('test', 'test', {
          agentSessionId: attemptId,
        }),
        () =>
          service.addMessage(
            {
              ...mockSystemMessageDto,
              data: {
                ...mockSystemMessageDto.data,
                response: 'x'.repeat(120),
                ragEnabled: false,
              },
            },
            mockOrganizationId,
            'test-source',
          ),
      );

      const createData = txMock.message.create.mock.calls[0][0].data;
      expect(createData).not.toHaveProperty('evalAttemptId');
      expect(createData.data.ragEnabled).toBe(false);
      expect(txMock.report.findFirst).not.toHaveBeenCalled();
      const created = eventPublisher.publishInTransaction.mock.calls
        .map((call: unknown[]) => call[1] as any)
        .find((event) => event.type === 'message.created');
      expect(created.payload.message.shouldProcess).toBe(false);
    });

    it('should include parent content length when computing shouldProcess', async () => {
      const parentContent = 'x'.repeat(45);
      const parentMessage = TestUtils.createMockDbMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        data: {
          type: 'QUESTIONS',
          response: parentContent,
          detectedIntent: '',
          intentConfidence: 0,
          uiElements: [],
          actions: [],
        },
      });
      const createdMessage = {
        ...TestUtils.createMockDbMessage({
          id: mockMessageId,
          workflowId: mockWorkflowId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          status: MessageStatus.Open.toString(),
          userId: 'user-123',
          data: { message: 'short message' },
          parentMessageId: testIds.parentMessage,
          type: 'USER',
        }),
        parentMessage,
      } as unknown;

      const txMock = {
        message: {
          create: jest.fn().mockResolvedValue(createdMessage),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
          }),
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const dto: any = {
        ...mockUserMessageDto,
        data: { message: 'short message' },
        parentMessageId: testIds.parentMessage,
      };

      await service.addMessage(dto, mockOrganizationId, 'test-source');

      const messageCreatedCall =
        eventPublisher.publishInTransaction.mock.calls.find(
          ([, event]) => event.type === 'message.created',
        );

      expect(messageCreatedCall?.[1].payload.message.shouldProcess).toBe(true);
    });

    it('should parse and persist mentions transactionally', async () => {
      const mentionEntityId = 'init-123';
      mockEntityRegistryService.lookupEntityTypes.mockResolvedValue({
        [mentionEntityId]: EntityType.INITIATIVE,
      });

      const parentMessage = TestUtils.createMockDbMessage({
        id: testIds.parentMessage,
        type: 'SYSTEM',
        data: {
          type: 'QUESTIONS',
          response: 'Parent message content',
          detectedIntent: '',
          intentConfidence: 0,
          uiElements: [],
          actions: [],
        },
      });
      const createdMessage = {
        ...TestUtils.createMockDbMessage({
          id: mockMessageId,
          workflowId: mockWorkflowId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          status: MessageStatus.Open.toString(),
          userId: 'user-123',
          data: { message: `Hi @[initiative:${mentionEntityId}|Name]` },
          parentMessageId: testIds.parentMessage,
        }),
        parentMessage,
      } as unknown;

      const txMock = {
        message: {
          create: jest.fn().mockResolvedValue(createdMessage),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
          }),
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
        messageMention: {
          createMany: jest.fn(),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const dto: any = {
        ...mockUserMessageDto,
        data: { message: `Hello @[initiative:${mentionEntityId}|Init]` },
      };

      await service.addMessage(dto, mockOrganizationId, 'test-source');

      expect(mockEntityRegistryService.lookupEntityTypes).toHaveBeenCalledWith(
        [mentionEntityId],
        expect.anything(),
      );
      expect(txMock.messageMention.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: expect.any(String),
            messageId: mockMessageId,
            conversationId: mockConversationId,
            entityId: mentionEntityId,
            entityType: EntityType.INITIATIVE,
          },
        ],
      });
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'message.created',
          payload: expect.objectContaining({
            mentions: [
              {
                entityId: mentionEntityId,
                entityType: EntityType.INITIATIVE,
              },
            ],
          }),
        }),
        expect.anything(),
        expect.anything(),
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledTimes(2);
    });

    it('should parse and persist mentions for system messages', async () => {
      const mentionEntityId = 'init-456';
      mockEntityRegistryService.lookupEntityTypes.mockResolvedValue({
        [mentionEntityId]: EntityType.INITIATIVE,
      });

      const txMock = {
        message: {
          create: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              workflowId: mockWorkflowId,
              projectId: mockProjectId,
              conversationId: mockConversationId,
              status: MessageStatus.Open.toString(),
              userId: 'system',
              data: { response: `Hello @[initiative:${mentionEntityId}|Init]` },
            }),
          ),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
            workflowAboutId: 'design-doc-123',
            workflowAboutType: 'design-doc',
          }),
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
        messageMention: {
          createMany: jest.fn(),
        },
        proposal: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const dto: any = {
        ...mockSystemMessageDto,
        data: {
          ...mockSystemMessageDto.data,
          response: `Hi @[initiative:${mentionEntityId}|Init]`,
        },
      };

      await service.addMessage(dto, mockOrganizationId, 'test-source');

      expect(mockEntityRegistryService.lookupEntityTypes).toHaveBeenCalledWith(
        [mentionEntityId],
        expect.anything(),
      );
      expect(txMock.messageMention.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: expect.any(String),
            messageId: mockMessageId,
            conversationId: mockConversationId,
            entityId: mentionEntityId,
            entityType: EntityType.INITIATIVE,
          },
        ],
      });

      const mentionCreatedCalls =
        eventPublisher.publishInTransaction.mock.calls.filter(
          ([, event]) => event.type === 'mention.created',
        );
      expect(mentionCreatedCalls).toHaveLength(1);
      expect(mentionCreatedCalls[0]?.[1].payload).toMatchObject({
        sourceEntityId: mockMessageId,
        sourceEntityType: 'MESSAGE',
        entityId: mentionEntityId,
        entityType: EntityType.INITIATIVE,
      });
    });
  });

  describe('pending_open_trigger store maintenance', () => {
    it('removes a failed start-run trigger from reconnect delivery eligibility', async () => {
      const deleteMany = jest
        .spyOn(prismaService.db.pendingOpenTrigger, 'deleteMany')
        .mockResolvedValue({ count: 1 });

      await service.removePendingOpenTrigger(mockMessageId);

      expect(deleteMany).toHaveBeenCalledWith({
        where: { messageId: mockMessageId },
      });
    });

    // A SYSTEM message whose data.triggersAgent is an object opens a trigger.
    function buildTriggerTxMock(
      agentSession: { userId: string } | null,
      createdMessageOverrides: Record<string, unknown> = {},
    ) {
      return {
        message: {
          create: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              projectId: mockProjectId,
              conversationId: mockConversationId,
              status: MessageStatus.Completed.toString(),
              userId: 'system',
              data: { type: 'AGENT', nodeId: 'n1' },
              ...createdMessageOverrides,
            }),
          ),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
            workflowAboutId: null,
            workflowAboutType: null,
          }),
          update: jest
            .fn()
            .mockResolvedValue({ version: 2, projectId: mockProjectId }),
        },
        messageMention: { createMany: jest.fn() },
        agentSession: {
          findFirst: jest.fn().mockResolvedValue(agentSession),
        },
        pendingOpenTrigger: {
          create: jest.fn(),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
    }

    const triggerDto: any = {
      ...mockSystemMessageDto,
      data: {
        type: 'AGENT',
        nodeId: 'n1',
        triggersAgent: {
          promptType: 'implement',
          nodeId: 'n1',
          triggerMessageId: mockMessageId,
        },
      },
    };

    it('inserts one open-trigger row keyed by the conversation owner when a SYSTEM triggersAgent message is written', async () => {
      const txMock = buildTriggerTxMock({ userId: 'owner-user' });
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await service.addMessage(triggerDto, mockOrganizationId, 'test-source');

      // The owning user is resolved through the conversation's AgentSession,
      // earliest-first, matching the backfill's DISTINCT ON ordering.
      expect(txMock.agentSession.findFirst).toHaveBeenCalledWith({
        where: {
          conversationId: mockConversationId,
          organizationId: mockOrganizationId,
        },
        select: { userId: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(txMock.pendingOpenTrigger.create).toHaveBeenCalledWith({
        data: {
          userId: 'owner-user',
          conversationId: mockConversationId,
          messageId: mockMessageId,
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
        },
      });
    });

    it('opens a trigger for a server-stamped USER row carrying data.triggersAgent', async () => {
      // The controller stamps `data.triggersAgent` onto the USER row at create
      // time for the promptType / non-Temporal / terminated-workflow cases.
      // The store projection must track USER rows for re-fan exactly like the
      // SYSTEM rows the engine mints, still keyed on the conversation owner.
      const txMock = buildTriggerTxMock(
        { userId: 'owner-user' },
        { type: 'USER', userId: 'human-user', data: { message: 'hi' } },
      );
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const userTriggerDto: any = {
        ...mockUserMessageDto,
        parentMessageId: undefined,
        data: {
          message: 'hi',
          promptType: 'feature_sync_analyze',
          triggersAgent: {
            promptType: 'user_message',
            triggerMessageId: mockMessageId,
            sourceUserMessageId: mockMessageId,
            payload: {
              handlerPromptType: 'feature_sync_analyze',
              userMessage: 'hi',
            },
          },
        },
      };

      await service.addMessage(
        userTriggerDto,
        mockOrganizationId,
        'test-source',
      );

      expect(txMock.pendingOpenTrigger.create).toHaveBeenCalledWith({
        data: {
          userId: 'owner-user',
          conversationId: mockConversationId,
          messageId: mockMessageId,
          organizationId: mockOrganizationId,
          projectId: mockProjectId,
        },
      });
    });

    it('does not track a trigger when the conversation has no AgentSession binding', async () => {
      const txMock = buildTriggerTxMock(null);
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await service.addMessage(triggerDto, mockOrganizationId, 'test-source');

      expect(txMock.agentSession.findFirst).toHaveBeenCalled();
      expect(txMock.pendingOpenTrigger.create).not.toHaveBeenCalled();
    });

    it('deletes the matching open-trigger row when a completion message is written', async () => {
      const txMock = buildTriggerTxMock({ userId: 'owner-user' });
      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const completionDto: any = {
        ...mockSystemMessageDto,
        data: {
          type: 'AGENT',
          nodeId: 'n1',
          completesExternalAgentNode: {
            nodeId: 'n1',
            action: 'NO_DISCREPANCY',
            completesTriggerMessageId: 'trigger-being-completed',
          },
        },
      };

      await service.addMessage(
        completionDto,
        mockOrganizationId,
        'test-source',
      );

      expect(txMock.pendingOpenTrigger.deleteMany).toHaveBeenCalledWith({
        where: { messageId: 'trigger-being-completed' },
      });
      // A completion is never also a trigger — no insert, no session lookup.
      expect(txMock.pendingOpenTrigger.create).not.toHaveBeenCalled();
      expect(txMock.agentSession.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('updateMessage', () => {
    it('should update a message', async () => {
      // Mock the transaction methods
      const txMock = {
        project: {
          findMany: jest
            .fn()
            .mockResolvedValue([
              TestUtils.createMockDbProject({ id: mockProjectId }),
            ]),
        },
        message: {
          findFirst: jest.fn().mockResolvedValue({
            ...TestUtils.createMockDbMessage({
              id: mockMessageId,
              workflowId: mockWorkflowId,
              projectId: mockProjectId,
              conversationId: mockConversationId,
              userId: 'system',
            }),
            conversation: { version: 1 },
          }),
          update: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              status: MessageStatus.Completed.toString(),
              userId: 'system',
              data: {
                type: 'QUESTIONS',
                response: 'Updated feedback',
                detectedIntent: '',
                intentConfidence: 0,
                uiElements: [],
              },
            }),
          ),
        },
        messageMention: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const result = await service.updateMessage(
        mockMessageId,
        mockOrganizationId,
        mockUpdateMessageDto,
        { source: 'test-source' },
      );

      expect(result).toBeDefined();
      expect(prismaService.$transaction).toHaveBeenCalled();
    });

    it('should refresh mentions when updating system message data', async () => {
      const mentionEntityId = 'init-789';
      mockEntityRegistryService.lookupEntityTypes.mockResolvedValue({
        [mentionEntityId]: EntityType.INITIATIVE,
      });

      const txMock = {
        project: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        message: {
          findFirst: jest.fn().mockResolvedValue({
            id: mockMessageId,
            type: 'SYSTEM',
            conversation: { version: 1 },
          }),
          update: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              conversationId: mockConversationId,
              projectId: mockProjectId,
              workflowId: mockWorkflowId,
              data: { response: `Hi @[initiative:${mentionEntityId}|Init]` },
            }),
          ),
        },
        messageMention: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await service.updateMessage(
        mockMessageId,
        mockOrganizationId,
        {
          data: {
            type: SystemMessageData.TypeEnum.Noop,
            response: `Hi @[initiative:${mentionEntityId}|Init]`,
          },
        },
        { source: 'test-source' },
      );

      expect(mockEntityRegistryService.lookupEntityTypes).toHaveBeenCalledWith(
        [mentionEntityId],
        expect.anything(),
      );
      expect(txMock.messageMention.deleteMany).toHaveBeenCalledWith({
        where: { messageId: mockMessageId },
      });
      expect(txMock.messageMention.createMany).toHaveBeenCalledWith({
        data: [
          {
            id: expect.any(String),
            messageId: mockMessageId,
            conversationId: mockConversationId,
            entityId: mentionEntityId,
            entityType: EntityType.INITIATIVE,
          },
        ],
      });
    });

    it('should clear mentions if system message update removes them', async () => {
      mockEntityRegistryService.lookupEntityTypes.mockResolvedValue({});

      const txMock = {
        project: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        message: {
          findFirst: jest.fn().mockResolvedValue({
            id: mockMessageId,
            type: 'SYSTEM',
            conversation: { version: 1 },
          }),
          update: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              conversationId: mockConversationId,
              projectId: mockProjectId,
              workflowId: mockWorkflowId,
              data: { response: 'No mentions here' },
            }),
          ),
        },
        messageMention: {
          findMany: jest.fn().mockResolvedValue([]),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await service.updateMessage(
        mockMessageId,
        mockOrganizationId,
        {
          data: {
            type: SystemMessageData.TypeEnum.Noop,
            response: 'No mentions here',
          },
        },
        { source: 'test-source' },
      );

      expect(txMock.messageMention.deleteMany).toHaveBeenCalledWith({
        where: { messageId: mockMessageId },
      });
      expect(txMock.messageMention.createMany).not.toHaveBeenCalled();
    });

    it.each([true, false])(
      'only emits mention relationships for retrieval-enabled output: %s',
      async (ragEnabled) => {
        const keepEntityId = 'init-keep';
        const addedEntityId = 'init-added';
        const removedEntityId = 'init-removed';

        mockEntityRegistryService.lookupEntityTypes.mockResolvedValue({
          [keepEntityId]: EntityType.INITIATIVE,
          [addedEntityId]: EntityType.INITIATIVE,
        });

        const priorMentions = [
          {
            id: 'prior-keep',
            entityId: keepEntityId,
            entityType: EntityType.INITIATIVE,
          },
          {
            id: 'prior-removed',
            entityId: removedEntityId,
            entityType: EntityType.INITIATIVE,
          },
        ];

        const txMock = {
          project: { findMany: jest.fn().mockResolvedValue([]) },
          message: {
            findFirst: jest.fn().mockResolvedValue({
              id: mockMessageId,
              type: 'SYSTEM',
              conversation: {
                workflowAboutId: 'design-doc-123',
                workflowAboutType: 'design-doc',
                version: 1,
              },
            }),
            update: jest.fn().mockResolvedValue(
              TestUtils.createMockDbMessage({
                id: mockMessageId,
                conversationId: mockConversationId,
                projectId: mockProjectId,
                workflowId: mockWorkflowId,
                data: {
                  response: `Hi @[initiative:${keepEntityId}|Keep] @[initiative:${addedEntityId}|Add]`,
                  ragEnabled,
                },
              }),
            ),
          },
          messageMention: {
            findMany: jest.fn().mockResolvedValue(priorMentions),
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
        };

        jest
          .spyOn(prismaService, '$transaction')
          .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
            fn(txMock),
          );

        await service.updateMessage(
          mockMessageId,
          mockOrganizationId,
          {
            data: {
              type: SystemMessageData.TypeEnum.Noop,
              response: `Hi @[initiative:${keepEntityId}|Keep] @[initiative:${addedEntityId}|Add]`,
              ragEnabled,
            },
          },
          { source: 'test-source' },
        );

        const mentionCreatedCalls =
          eventPublisher.publishInTransaction.mock.calls.filter(
            ([, event]) => event.type === 'mention.created',
          );
        const mentionRemovedCalls =
          eventPublisher.publishInTransaction.mock.calls.filter(
            ([, event]) => event.type === 'mention.removed',
          );

        if (!ragEnabled) {
          expect(mentionCreatedCalls).toHaveLength(0);
          expect(mentionRemovedCalls).toHaveLength(0);
          expect(txMock.messageMention.createMany).not.toHaveBeenCalled();
          return;
        }
        expect(mentionCreatedCalls).toHaveLength(1);
        expect(mentionCreatedCalls[0]?.[1].payload).toMatchObject({
          sourceEntityId: mockMessageId,
          sourceEntityType: 'MESSAGE',
          entityId: addedEntityId,
          entityType: EntityType.INITIATIVE,
        });

        expect(mentionRemovedCalls).toHaveLength(1);
        expect(mentionRemovedCalls[0]?.[1].payload).toMatchObject({
          sourceEntityId: mockMessageId,
          sourceEntityType: 'MESSAGE',
          entityId: removedEntityId,
          entityType: EntityType.INITIATIVE,
        });
      },
    );

    it('emits no mention.created or mention.removed when the mention set is unchanged', async () => {
      const stableEntityId = 'init-stable';
      mockEntityRegistryService.lookupEntityTypes.mockResolvedValue({
        [stableEntityId]: EntityType.INITIATIVE,
      });

      const priorMentions = [
        {
          id: 'prior-stable',
          entityId: stableEntityId,
          entityType: EntityType.INITIATIVE,
        },
      ];

      const txMock = {
        project: { findMany: jest.fn().mockResolvedValue([]) },
        message: {
          findFirst: jest.fn().mockResolvedValue({
            id: mockMessageId,
            type: 'SYSTEM',
            conversation: {
              workflowAboutId: 'design-doc-123',
              workflowAboutType: 'design-doc',
              version: 1,
            },
          }),
          update: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              conversationId: mockConversationId,
              projectId: mockProjectId,
              workflowId: mockWorkflowId,
              data: {
                response: `Same @[initiative:${stableEntityId}|Stable]`,
              },
            }),
          ),
        },
        messageMention: {
          findMany: jest.fn().mockResolvedValue(priorMentions),
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await service.updateMessage(
        mockMessageId,
        mockOrganizationId,
        {
          data: {
            type: SystemMessageData.TypeEnum.Noop,
            response: `Same @[initiative:${stableEntityId}|Stable]`,
          },
        },
        { source: 'test-source' },
      );

      const mentionEvents =
        eventPublisher.publishInTransaction.mock.calls.filter(
          ([, event]) =>
            event.type === 'mention.created' ||
            event.type === 'mention.removed',
        );
      expect(mentionEvents).toHaveLength(0);
    });
  });

  // Test adapter methods
  describe('Adapter Methods', () => {
    describe('getMessagesForAdapter', () => {
      it('should call getMessages with correct parameters', async () => {
        const spy = jest.spyOn(service, 'getMessages').mockResolvedValue([]);
        const query: GetMessagesQueryDto = { projectId: mockProjectId };

        await service.getMessagesForAdapter(
          query,
          mockOrganizationId,
          mockProjectId,
          false,
        );

        expect(spy).toHaveBeenCalledWith(
          query,
          mockOrganizationId,
          false,
          true,
          false,
        );
      });

      it('forwards includeReports through to getMessages', async () => {
        const spy = jest.spyOn(service, 'getMessages').mockResolvedValue([]);
        const query: GetMessagesQueryDto = { projectId: mockProjectId };

        await service.getMessagesForAdapter(
          query,
          mockOrganizationId,
          mockProjectId,
          true,
          true,
          true,
        );

        expect(spy).toHaveBeenCalledWith(
          query,
          mockOrganizationId,
          true,
          true,
          true,
        );
      });
    });

    describe('getMessageForAdapter', () => {
      it('should call getMessage with correct parameters', async () => {
        const spy = jest.spyOn(service, 'getMessage').mockResolvedValue(null);

        await service.getMessageForAdapter(
          mockMessageId,
          mockOrganizationId,
          false,
        );

        expect(spy).toHaveBeenCalledWith(
          mockMessageId,
          mockOrganizationId,
          false,
        );
      });
    });

    describe('addMessageFromAdapter', () => {
      it('should call addMessage with adapter source', async () => {
        const spy = jest
          .spyOn(service, 'addMessage')
          .mockResolvedValue(mockMessage);
        jest
          .spyOn(prismaService.db.conversation, 'findFirst')
          .mockResolvedValue({
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          } as any);

        await service.addMessageFromAdapter(
          mockSystemMessageDto,
          mockOrganizationId,
        );

        expect(spy).toHaveBeenCalledWith(
          mockSystemMessageDto,
          mockOrganizationId,
          'adapter',
        );
      });

      it('forwards SYSTEM attachment identities through the adapter unchanged', async () => {
        const spy = jest
          .spyOn(service, 'addMessage')
          .mockResolvedValue(mockMessage);
        jest
          .spyOn(prismaService.db.conversation, 'findFirst')
          .mockResolvedValue({
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          } as any);

        const dto = {
          ...mockSystemMessageDto,
          proposalIds: ['proposal-1'],
          reportIds: ['report-1'],
        };

        await service.addMessageFromAdapter(dto, mockOrganizationId);

        expect(spy).toHaveBeenCalledWith(
          expect.objectContaining({
            proposalIds: ['proposal-1'],
            reportIds: ['report-1'],
          }),
          mockOrganizationId,
          'adapter',
        );
      });

      it('rejects attachment identities on USER messages', async () => {
        await expect(
          service.addMessageFromAdapter(
            {
              ...mockUserMessageDto,
              proposalIds: ['proposal-1'],
            } as any,
            mockOrganizationId,
          ),
        ).rejects.toThrow(BadRequestException);

        expect(prismaService.db.conversation.findFirst).not.toHaveBeenCalled();
      });

      it('should resolve tail parentMessageId when parentMessageId is null and conversation has messages', async () => {
        const tailId = 'tail-message-id' as MessageId;
        const addMessageSpy = jest
          .spyOn(service, 'addMessage')
          .mockResolvedValue(mockMessage);
        jest
          .spyOn(prismaService.db.conversation, 'findFirst')
          .mockResolvedValue({
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          } as any);
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue({ id: tailId } as any);

        const dto = { ...mockSystemMessageDto, parentMessageId: null };

        await service.addMessageFromAdapter(dto, mockOrganizationId);

        expect(addMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ parentMessageId: tailId }),
          mockOrganizationId,
          'adapter',
        );
      });

      it('should leave parentMessageId undefined when conversation is empty', async () => {
        const addMessageSpy = jest
          .spyOn(service, 'addMessage')
          .mockResolvedValue(mockMessage);
        jest
          .spyOn(prismaService.db.conversation, 'findFirst')
          .mockResolvedValue({
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          } as any);
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue(null);

        const dto = { ...mockSystemMessageDto, parentMessageId: null };

        await service.addMessageFromAdapter(dto, mockOrganizationId);

        expect(addMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ parentMessageId: undefined }),
          mockOrganizationId,
          'adapter',
        );
      });

      it('should pass through explicit parentMessageId unchanged', async () => {
        const explicitParentId = 'explicit-parent-id' as MessageId;
        const addMessageSpy = jest
          .spyOn(service, 'addMessage')
          .mockResolvedValue(mockMessage);
        jest
          .spyOn(prismaService.db.conversation, 'findFirst')
          .mockResolvedValue({
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          } as any);
        const findFirstSpy = jest.spyOn(prismaService.db.message, 'findFirst');

        const dto = {
          ...mockSystemMessageDto,
          parentMessageId: explicitParentId,
        };

        await service.addMessageFromAdapter(dto, mockOrganizationId);

        expect(findFirstSpy).not.toHaveBeenCalled();
        expect(addMessageSpy).toHaveBeenCalledWith(
          expect.objectContaining({ parentMessageId: explicitParentId }),
          mockOrganizationId,
          'adapter',
        );
      });

      it('should resolve tail for each call when parentMessageId is repeatedly null', async () => {
        const firstTailId = 'first-tail-id' as MessageId;
        const secondTailId = 'second-tail-id' as MessageId;
        const addMessageSpy = jest
          .spyOn(service, 'addMessage')
          .mockResolvedValue(mockMessage);
        jest
          .spyOn(prismaService.db.conversation, 'findFirst')
          .mockResolvedValue({
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          } as any);
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValueOnce({ id: firstTailId } as any)
          .mockResolvedValueOnce({ id: secondTailId } as any);

        const dto = { ...mockSystemMessageDto, parentMessageId: null };

        await service.addMessageFromAdapter(dto, mockOrganizationId);
        expect(addMessageSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ parentMessageId: firstTailId }),
          mockOrganizationId,
          'adapter',
        );

        await service.addMessageFromAdapter(dto, mockOrganizationId);
        expect(addMessageSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({ parentMessageId: secondTailId }),
          mockOrganizationId,
          'adapter',
        );
      });
    });

    describe('updateMessageFromAdapter', () => {
      it('should call updateMessage with adapter source', async () => {
        const spy = jest
          .spyOn(service, 'updateMessage')
          .mockResolvedValue(mockMessage);

        await service.updateMessageFromAdapter(
          mockMessageId,
          mockOrganizationId,
          mockUpdateMessageDto,
        );

        expect(spy).toHaveBeenCalledWith(
          mockMessageId,
          mockOrganizationId,
          mockUpdateMessageDto,
          { source: 'adapter' },
        );
      });
    });
  });

  describe('EntityRegistry Integration', () => {
    it('should create message without direct registry dependency', async () => {
      const txMock = {
        message: {
          create: jest.fn().mockResolvedValue(
            TestUtils.createMockDbMessage({
              id: mockMessageId,
              workflowId: mockWorkflowId,
              projectId: mockProjectId,
              conversationId: mockConversationId,
              status: MessageStatus.Open.toString(),
            }),
          ),
        },
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            projectId: mockProjectId,
          }),
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
        proposal: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const result = await service.addMessage(
        {
          ...mockSystemMessageDto,
          type: 'SYSTEM' as const,
        },
        mockOrganizationId,
        'test-source',
      );

      expect(result).toBeDefined();
      expect(prismaService.$transaction).toHaveBeenCalled();
    });
  });

  describe('prependMessage', () => {
    const targetMessageId = testIds.message;
    const newMessageId = '123e4567-e89b-42d3-a456-426614174099' as MessageId;

    it('should prepend a message before target and rewire parentMessageId', async () => {
      const targetMessage = {
        ...TestUtils.createMockDbMessage({
          id: targetMessageId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          parentMessageId: testIds.parentMessage,
        }),
        parentMessage: TestUtils.createMockDbMessage({
          id: testIds.parentMessage,
        }),
        conversation: {
          version: 1,
          workflowId: mockWorkflowId,
        },
      };

      const createdMessage = {
        ...TestUtils.createMockDbMessage({
          id: newMessageId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          parentMessageId: testIds.parentMessage,
        }),
        parentMessage: TestUtils.createMockDbMessage({
          id: testIds.parentMessage,
        }),
        conversation: {
          workflowId: mockWorkflowId,
        },
        responses: [],
      };

      const txMock = {
        message: {
          findFirst: jest.fn().mockResolvedValue(targetMessage),
          create: jest.fn().mockResolvedValue(createdMessage),
          update: jest.fn().mockResolvedValue({ id: targetMessageId }),
        },
        conversation: {
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const result = await service.prependMessage(
        targetMessageId,
        {
          ...mockSystemMessageDto,
          type: 'SYSTEM' as const,
        },
        mockOrganizationId,
        'test-source',
      );

      expect(result).toBeDefined();
      expect(result.id).toBe(newMessageId);

      // Verify target was fetched with org validation
      expect(txMock.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: targetMessageId,
            conversation: { organizationId: mockOrganizationId },
          },
        }),
      );

      // Verify new message was created
      expect(txMock.message.create).toHaveBeenCalled();

      // Verify target message parentMessageId was rewired
      expect(txMock.message.update).toHaveBeenCalledWith({
        where: { id: targetMessageId },
        data: { parentMessageId: newMessageId },
      });

      // Verify events were published: message.created, message.updated, conversation.updated
      const eventCalls = eventPublisher.publishInTransaction.mock.calls;
      const eventTypes = eventCalls.map(
        (call: unknown[]) => (call[1] as { type: string }).type,
      );
      expect(eventTypes).toContain('message.created');
      expect(eventTypes).toContain('message.updated');
      expect(eventTypes).toContain('conversation.updated');
    });

    it('should prepend before a root message (null parentMessageId)', async () => {
      const targetMessage = {
        ...TestUtils.createMockDbMessage({
          id: targetMessageId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          parentMessageId: null,
        }),
        parentMessage: null,
        conversation: {
          version: 1,
          workflowId: mockWorkflowId,
        },
      };

      const createdMessage = {
        ...TestUtils.createMockDbMessage({
          id: newMessageId,
          projectId: mockProjectId,
          conversationId: mockConversationId,
          parentMessageId: null,
        }),
        parentMessage: null,
        conversation: {
          workflowId: mockWorkflowId,
        },
        responses: [],
      };

      const txMock = {
        message: {
          findFirst: jest.fn().mockResolvedValue(targetMessage),
          create: jest.fn().mockResolvedValue(createdMessage),
          update: jest.fn().mockResolvedValue({ id: targetMessageId }),
        },
        conversation: {
          update: jest.fn().mockResolvedValue({
            version: 2,
            projectId: mockProjectId,
          }),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      const result = await service.prependMessage(
        targetMessageId,
        {
          ...mockSystemMessageDto,
          type: 'SYSTEM' as const,
          parentMessageId: undefined,
        },
        mockOrganizationId,
        'test-source',
      );

      expect(result).toBeDefined();
      // New message should have been created with no parentMessage connect
      const createCall = txMock.message.create.mock.calls[0][0];
      expect(createCall.data.parentMessage).toBeUndefined();
    });

    it('should throw NotFoundException when target message not found', async () => {
      const txMock = {
        message: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await expect(
        service.prependMessage(
          'non-existent' as MessageId,
          mockSystemMessageDto,
          mockOrganizationId,
          'test-source',
        ),
      ).rejects.toThrow('not found');
    });

    it('should throw BadRequestException when conversationId mismatch', async () => {
      const targetMessage = {
        ...TestUtils.createMockDbMessage({
          id: targetMessageId,
          projectId: mockProjectId,
          conversationId:
            '123e4567-e89b-42d3-a456-999999999999' as ConversationId,
        }),
        conversation: {
          version: 1,
          workflowId: mockWorkflowId,
        },
      };

      const txMock = {
        message: {
          findFirst: jest.fn().mockResolvedValue(targetMessage),
        },
      };

      jest
        .spyOn(prismaService, '$transaction')
        .mockImplementation(async (fn: (prisma: any) => Promise<any>) =>
          fn(txMock),
        );

      await expect(
        service.prependMessage(
          targetMessageId,
          mockSystemMessageDto,
          mockOrganizationId,
          'test-source',
        ),
      ).rejects.toThrow('conversationId must match');
    });
  });
  describe('undated queued inputs', () => {
    beforeEach(() => {
      jest
        .spyOn(prismaService.db.user, 'findMany')
        .mockResolvedValue([] as never);
    });
    const queuedRow = (overrides: Record<string, unknown> = {}) => ({
      id: mockMessageId,
      projectId: mockProjectId,
      conversationId: mockConversationId,
      type: 'USER',
      status: MessageStatus.Completed,
      userId: testIds.user,
      data: { comment: 'Queued follow-up' },
      parentMessageId: null,
      executionStatus: 'queued',
      executionOperationId: '09f33263-4e9d-4302-a3bb-ccbb03968ee1',
      executionAdmissionId: null,
      executionCancellationRequested: false,
      createdAt: null,
      contentUpdatedAt: null,
      conversation: { workflowId: mockWorkflowId },
      responses: [],
      parentMessage: null,
      ...overrides,
    });

    it.each(['full', 'delta', 'reverse history', 'older history'] as const)(
      '%s reads omit undated replies while preserving dated replies and associations',
      async (read) => {
        const datedReply = TestUtils.createMockDbMessage({
          id: testIds.parentMessage,
          parentMessageId: mockMessageId,
        });
        const undatedReply = queuedRow({
          id: 'queued-reply',
          parentMessageId: mockMessageId,
        });
        const parent = {
          ...TestUtils.createMockDbMessage({ status: MessageStatus.Completed }),
          proposalReferences: [proposalReference('attached-proposal', 0)],
        };
        // Model Prisma's response relation selection against both persisted replies.
        const findMany = jest.spyOn(prismaService.db.message, 'findMany');
        (findMany as jest.Mock).mockImplementation(
          async (args: Prisma.MessageFindManyArgs) => {
            const responses = args?.include?.responses;
            const datedOnly =
              typeof responses === 'object' &&
              responses.where?.createdAt !== undefined;
            return [
              {
                ...parent,
                responses: responses
                  ? datedOnly
                    ? [datedReply]
                    : [datedReply, undatedReply]
                  : [],
              },
            ];
          },
        );
        jest
          .spyOn(prismaService.db.message, 'findFirst')
          .mockResolvedValue(parent);
        mockReportService.loadReportsForMessageIds.mockResolvedValue(
          new Map([[mockMessageId, [{ id: 'attached-report' }]]]),
        );
        const history = read === 'reverse history' || read === 'older history';
        const query: GetMessagesQueryDto = {
          conversationId: mockConversationId,
          ...(read === 'delta' ? { since: mockMessageId } : {}),
          ...(history
            ? { mode: MessageReadMode.ReverseHistory, limit: 2 }
            : {}),
        };
        if (read === 'older history') {
          query.historyCursor = encodeConversationMessageHistoryCursor({
            version: 1,
            projectId: mockProjectId,
            conversationId: mockConversationId,
            createdAt: parent.createdAt!.toISOString(),
            id: mockMessageId,
          });
        }
        const result = await service.getMessagesForAdapter(
          query,
          mockOrganizationId,
          mockProjectId,
          true,
          true,
          true,
        );
        const messages = Array.isArray(result) ? result : result.messages;
        expect(messages).toHaveLength(1);
        expect(messages[0]?.responses?.map((reply) => reply.id)).toEqual([
          datedReply.id,
        ]);
        expect(messages[0]?.proposals?.map((proposal) => proposal.id)).toEqual([
          'attached-proposal',
        ]);
        expect(messages[0]?.reports).toEqual([{ id: 'attached-report' }]);
        expect(findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            include: expect.objectContaining({
              responses: { where: { createdAt: { not: null } } },
            }),
          }),
        );

        const withoutResponses = await service.getMessagesForAdapter(
          query,
          mockOrganizationId,
          mockProjectId,
          false,
          false,
          false,
        );
        const withoutMessages = Array.isArray(withoutResponses)
          ? withoutResponses
          : withoutResponses.messages;
        expect(withoutMessages[0]?.responses).toEqual([]);
        expect(findMany).toHaveBeenLastCalledWith(
          expect.objectContaining({
            include: expect.objectContaining({
              responses: false,
              proposalReferences: false,
            }),
          }),
        );
      },
    );

    it('inserts an executable input queued and undated in one write', async () => {
      const operationId = '09f33263-4e9d-4302-a3bb-ccbb03968ee1';
      const tx = {
        conversation: {
          findUnique: jest.fn().mockResolvedValue({
            version: 1,
            workflowId: mockWorkflowId,
            workflowAboutId: null,
            workflowAboutType: null,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        message: {
          create: jest.fn().mockResolvedValue(queuedRow()),
          findFirst: jest.fn().mockResolvedValue({ id: 'earlier-reply' }),
        },
        messageMention: { createMany: jest.fn() },
      };

      const created = await service.addMessageInTransaction(
        tx as never,
        {
          id: mockMessageId,
          type: 'USER',
          projectId: mockProjectId,
          conversationId: mockConversationId,
          userId: testIds.user,
          data: { comment: 'Queued follow-up' },
        } as never,
        mockOrganizationId,
        'test',
        { executableOperationId: operationId },
      );

      expect(tx.message.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            createdAt: null,
            contentUpdatedAt: null,
            executionStatus: 'queued',
            executionOperationId: operationId,
          }),
        }),
      );
      expect(created.createdAt).toBeNull();
      const [createdEvent, updatedEvent] = (
        eventPublisher.publishInTransaction as jest.Mock
      ).mock.calls.map(([, event]) => event);
      // The realtime payload never carries a send-time date.
      expect(createdEvent.payload.message.createdAt).toBeUndefined();
      // The undated input is not the conversation's latest message.
      expect(updatedEvent.payload.latestMessageId).toBe('earlier-reply');
      expect(tx.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            conversationId: mockConversationId,
            createdAt: { not: null },
          },
        }),
      );
    });

    it('returns an undated queued input by id', async () => {
      jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue(queuedRow() as never);
      const message = await service.getMessage(
        mockMessageId,
        mockOrganizationId,
        false,
      );
      expect(message?.createdAt).toBeNull();
      expect(message?.executionStatus).toBe('queued');
    });

    it('reads the queue in the send order of the owning operations', async () => {
      const queryRaw = jest
        .fn()
        .mockResolvedValue([{ id: 'second-sent' }, { id: 'first-sent' }]);
      (prismaService.db as unknown as { $queryRaw: jest.Mock }).$queryRaw =
        queryRaw;
      jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([
          queuedRow({ id: 'first-sent' }),
          queuedRow({ id: 'second-sent' }),
        ] as never);
      const queue = await service.getQueuedInputs(mockConversationId);
      expect(queue.map((message) => message.id)).toEqual([
        'second-sent',
        'first-sent',
      ]);
      expect(queryRaw.mock.calls[0][0].join('')).toContain(
        'ORDER BY o.created_at ASC, m.id ASC',
      );
    });

    it.each([
      [
        'getLatestMessage',
        () => service.getLatestMessage(mockConversationId, mockOrganizationId),
      ],
      [
        'getLastSystemMessage',
        () =>
          service.getLastSystemMessage(mockConversationId, mockOrganizationId),
      ],
      [
        'getMostRecentUserMessage',
        () =>
          service.getMostRecentUserMessage(
            testIds.user,
            mockConversationId,
            mockOrganizationId,
          ),
      ],
    ] as const)('%s never selects an undated queued input', async (_, read) => {
      const findFirst = jest
        .spyOn(prismaService.db.message, 'findFirst')
        .mockResolvedValue(null);
      await read();
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdAt: { not: null } }),
        }),
      );
    });

    it('excludes undated queued inputs from Agent Session history', async () => {
      const findMany = jest
        .spyOn(prismaService.db.message, 'findMany')
        .mockResolvedValue([] as never);
      await service.getAgentSessionHistoryPage({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        agentSessionId: '123e4567-e89b-42d3-a456-426614174100',
        conversationId: mockConversationId,
        limit: 2,
        maxMessageCharacters: 1_000_000,
      });
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ createdAt: { not: null } }),
        }),
      );
    });

    it('excludes undated queued inputs from conversation search', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue({ id: mockConversationId } as never);
      const queryRaw = jest.fn().mockResolvedValue([]);
      (prismaService.db as unknown as { $queryRaw: jest.Mock }).$queryRaw =
        queryRaw;
      await service.searchByWorkflowAbout({
        organizationId: mockOrganizationId,
        projectId: mockProjectId,
        workflowAboutId: 'task-id',
        workflowAboutType: 'TASK',
        query: 'follow-up',
      });
      expect(queryRaw.mock.calls[0][0].sql).toContain(
        'm.created_at IS NOT NULL',
      );
    });
  });
});
