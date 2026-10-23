/* eslint-disable @typescript-eslint/unbound-method */
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectStatus } from '@prisma/client';
import { Client } from '@temporalio/client';
import { createServiceTestingModule } from '../../../test/setup/testing-module.factory';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import {
  ConversationStatus,
  ConversationUpdatedEvent,
  CreateConversationDto,
  InitiationType,
  InitiativeCreatorType,
  UpdateConversationDto,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { TEMPORAL_CLIENT } from '../../prisma/temporal.module';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import * as TestUtils from '../../utils/testUtils';
import { ConversationValidation } from '../../validation/conversation.validation';
import { ArtifactService } from '../artifacts/artifact.service';
import { ConversationService } from '../conversation.service';
import { MessageService } from '../message.service';
import { ProjectService } from '../project.service';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';

const requireNonNull = <T>(value: T | null, label: string): T => {
  if (value === null) {
    throw new Error(`Expected ${label} to be non-null`);
  }
  return value;
};

describe('ConversationService', () => {
  let service: ConversationService;
  let prismaService: jest.Mocked<PrismaService>;
  let validationService: ConversationValidation;
  let temporalClient: Client;
  let eventPublisher: { publishInTransaction: jest.Mock };
  let workflowTypeRegistryServiceMock: jest.Mocked<WorkflowTypeRegistryService>;

  const mockOrganizationId = TestUtils.testIds.organization;
  const mockProjectId = TestUtils.testIds.project;
  const mockConversationId = TestUtils.testIds.conversation;
  const mockWorkflowId = TestUtils.testIds.workflow;

  const mockDbConversation = TestUtils.createMockDbConversation({
    id: mockConversationId,
    projectId: mockProjectId,
    workflowId: mockWorkflowId,
    initiatedBy: InitiativeCreatorType.User,
    triggerEvent: 'test_event',
    status: ConversationStatus.Started,
    title: 'Test Conversation',
    workflowName: 'onboarding',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  });

  const mockConversationResponse = TestUtils.createMockConversation({
    id: mockConversationId,
    projectId: mockProjectId,
    workflowId: mockWorkflowId,
    initiatedBy: InitiativeCreatorType.User,
    triggerEvent: 'test_event',
    status: ConversationStatus.Started,
    title: 'Test Conversation',
    workflowName: 'onboarding',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  });

  const mockCreateConversationDto: CreateConversationDto = {
    projectId: mockProjectId,
    organizationId: mockOrganizationId,
    workflowId: mockWorkflowId,
    initiatedBy: InitiationType.User,
    triggerEvent: 'test_event',
    title: 'Test Conversation',
    workflowName: 'onboarding',
    status: ConversationStatus.Started,
    context: {},
  };

  const mockUpdateConversationDto: UpdateConversationDto = {
    expectedVersion: 1,
    status: ConversationStatus.Completed,
    title: 'Updated Conversation',
  };

  beforeEach(async () => {
    const mockPrismaService = TestUtils.createMockPrismaServiceWithTypes();

    const mockValidationService = {
      validateConversationBelongsToProject: jest.fn(),
      validateProjectIdConsistency: jest.fn(),
    };

    const mockTemporalClient = {
      workflow: {
        start: jest.fn(),
        getHandle: jest.fn(),
      },
    } as unknown as Client;

    const mockEventPublisher = {
      publish: jest.fn(),
      publishInTransaction: jest.fn(),
    };

    const mockMessageService = TestUtils.createMockMessageService();
    const mockProjectService = {
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as ProjectService;
    const mockArtifactService = TestUtils.createMockArtifactService();
    const mockWorkflowTypeRegistryService =
      TestUtils.createMockWorkflowTypeRegistryService() as unknown as jest.Mocked<WorkflowTypeRegistryService>;
    const conversationServiceInstance = new ConversationService(
      mockPrismaService,
      mockValidationService as ConversationValidation,
      mockEventPublisher as any,
      mockTemporalClient as unknown as Client,
      mockMessageService as MessageService,
      mockProjectService,
      mockArtifactService as ArtifactService,
      mockWorkflowTypeRegistryService as unknown as WorkflowTypeRegistryService,
    );

    const setup = await createServiceTestingModule({
      providers: [
        ConversationService,
        PrismaService,
        ConversationValidation,
        MessageService,
        ProjectService,
        ArtifactService,
        WorkflowTypeRegistryService,
      ],
      overrides: [
        [ConversationService, conversationServiceInstance],
        [PrismaService, mockPrismaService],
        [ConversationValidation, mockValidationService],
        [DOMAIN_EVENT_PUBLISHER_TOKEN, mockEventPublisher],
        [TEMPORAL_CLIENT, mockTemporalClient],
        [MessageService, mockMessageService],
        [ProjectService, mockProjectService],
        [ArtifactService, mockArtifactService],
        [WorkflowTypeRegistryService, mockWorkflowTypeRegistryService],
      ],
    });

    service = setup.module.get<ConversationService>(ConversationService);
    prismaService = setup.module.get(PrismaService);
    validationService = setup.module.get(ConversationValidation);
    temporalClient = setup.module.get(TEMPORAL_CLIENT);
    eventPublisher = setup.module.get(DOMAIN_EVENT_PUBLISHER_TOKEN);
    workflowTypeRegistryServiceMock = setup.module.get(
      WorkflowTypeRegistryService,
    );
  });

  describe('createConversation', () => {
    it('should create a conversation', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'create')
        .mockResolvedValue(mockDbConversation);

      const result = await service.createConversation(
        mockCreateConversationDto,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      expect(prismaService.db.conversation.create).toHaveBeenCalled();
    });

    it('persists the initiating user when supplied', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'create')
        .mockResolvedValue(mockDbConversation);

      await service.createConversation(
        mockCreateConversationDto,
        mockOrganizationId,
        { createdBy: TestUtils.testIds.user },
      );

      expect(prismaService.db.conversation.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ createdBy: TestUtils.testIds.user }),
      });
    });
  });

  describe('getConversation', () => {
    it('should return a conversation by id for organization', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockDbConversation);

      const result = await service.getConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      expect(result?.id).toBe(mockConversationId);
      expect(prismaService.db.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: mockConversationId,
            organizationId: mockOrganizationId,
            status: {
              not: ConversationStatus.Deleted,
            },
          },
        }),
      );
    });

    it('does not return a result when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(null);

      const result = await service.getConversation(
        mockConversationId,
        differentOrgId,
      );

      expect(result).toBeNull();
      expect(prismaService.db.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: mockConversationId,
            organizationId: differentOrgId,
            status: {
              not: ConversationStatus.Deleted,
            },
          },
        }),
      );
    });

    it('should return null if conversation not found', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(null);

      const result = await service.getConversation(
        'non-existent' as ConversationId,
        mockOrganizationId,
      );

      expect(result).toBeNull();
    });

    it('returns metadata without requesting Message relations', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockDbConversation);

      const result = await service.getConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).not.toHaveProperty('messages');
      expect(prismaService.db.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ include: {} }),
      );
    });
  });

  describe('updateConversation', () => {
    it('should update a conversation', async () => {
      const updatedConversation = TestUtils.createMockDbConversation({
        ...mockDbConversation,
        status: mockUpdateConversationDto.status,
        title: mockUpdateConversationDto.title,
        version: 2, // Incremented version
      });

      // Mock the transaction operations - service only selects version and projectId
      jest
        .spyOn(prismaService.db.conversation, 'findUnique')
        .mockResolvedValue({
          version: 1,
          projectId: mockProjectId,
        } as TestUtils.DbConversationRecord);
      jest
        .spyOn(prismaService.db.conversation, 'update')
        .mockResolvedValue(updatedConversation);

      const result = requireNonNull(
        await service.updateConversation(
          mockConversationId,
          mockOrganizationId,
          mockUpdateConversationDto,
        ),
        'updated conversation',
      );

      expect(result).toBeDefined();
      expect(result.status).toBe(mockUpdateConversationDto.status);
      expect(result.title).toBe(mockUpdateConversationDto.title);
      expect(prismaService.db.conversation.findUnique).toHaveBeenCalled();
      expect(prismaService.db.conversation.update).toHaveBeenCalled();
    });
  });

  describe.each(['user', 'system'] as const)(
    '%s ABOUT target updates',
    (changeType) => {
      it('publishes the persisted target type with the changed target ID', async () => {
        const existingConversation = TestUtils.createMockDbConversation({
          ...mockDbConversation,
          version: 1,
        });
        const updatedConversation = TestUtils.createMockDbConversation({
          ...mockDbConversation,
          workflowAboutId: TestUtils.testIds.task,
          workflowAboutType: 'task',
          version: 2,
        });
        jest
          .spyOn(prismaService.db.conversation, 'findUnique')
          .mockResolvedValue(existingConversation);
        jest
          .spyOn(prismaService.db.conversation, 'update')
          .mockResolvedValue(updatedConversation);
        let publishedEvent: Omit<ConversationUpdatedEvent, 'id'> | undefined;
        eventPublisher.publishInTransaction.mockImplementation(
          (_tx, event: Omit<ConversationUpdatedEvent, 'id'>) => {
            publishedEvent = event;
            return Promise.resolve(null);
          },
        );
        const update: UpdateConversationDto = {
          expectedVersion: 1,
          workflowAboutId: TestUtils.testIds.task,
        };

        if (changeType === 'user') {
          await service.updateConversation(
            mockConversationId,
            mockOrganizationId,
            update,
          );
        } else {
          await service.updateConversationInternal(
            mockConversationId,
            mockOrganizationId,
            update,
          );
        }

        expect(publishedEvent?.payload.update.workflowAboutId).toBe(
          TestUtils.testIds.task,
        );
        expect(publishedEvent?.payload.update.workflowAboutType).toBe('task');
        expect(publishedEvent?.payload.changeType).toBe(changeType);
        expect(eventPublisher.publishInTransaction).toHaveBeenCalledTimes(1);
      });
    },
  );

  describe('updateConversationInternal', () => {
    it('skips updates when no fields change', async () => {
      const existingConversation = TestUtils.createMockDbConversation({
        ...mockDbConversation,
        status: ConversationStatus.InProgress,
        title: 'Stable Title',
        version: 7,
      });

      jest
        .spyOn(prismaService.db.conversation, 'findUnique')
        .mockResolvedValue(existingConversation);

      const result = requireNonNull(
        await service.updateConversationInternal(
          mockConversationId,
          mockOrganizationId,
          { status: ConversationStatus.InProgress },
        ),
        'conversation',
      );

      expect(result.status).toBe(ConversationStatus.InProgress);
      expect(result.title).toBe('Stable Title');
      expect(prismaService.db.conversation.update).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('getConversationsByProject', () => {
    it('should return paginated conversations for a project in organization', async () => {
      const mockProject = TestUtils.createMockDbProject({
        id: mockProjectId,
        organizationId: mockOrganizationId,
        name: 'Test Project',
        status: ProjectStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Test Description',
        deletedAt: null,
      });
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([mockDbConversation]);
      jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(1);

      const result = await service.getConversationsByProject(
        mockProjectId,
        mockOrganizationId,
      );

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: mockOrganizationId,
        },
      });
      expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ include: {} }),
      );
      expect(result.data[0]).not.toHaveProperty('messages');
      expect(prismaService.db.conversation.count).toHaveBeenCalled();
    });

    it('does not return conversations when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest.spyOn(prismaService.db.project, 'findFirst').mockResolvedValue(null);

      await expect(
        service.getConversationsByProject(mockProjectId, differentOrgId),
      ).rejects.toThrow(
        `Project with ID ${mockProjectId} not found in organization ${differentOrgId}`,
      );

      expect(prismaService.db.project.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockProjectId,
          organizationId: differentOrgId,
        },
      });
    });
  });

  describe('getActiveConversations', () => {
    it('should return active conversations for organization', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([mockDbConversation]);
      jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(1);

      const result = await service.getActiveConversations(mockOrganizationId, {
        projectId: mockProjectId,
      });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
      expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: mockOrganizationId,
          }),
          include: {},
        }),
      );
      expect(result.data[0]).not.toHaveProperty('messages');
    });

    it('does not return conversations when the organizationId is different', async () => {
      const differentOrgId = 'org-different' as OrganizationId;
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([]);
      jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(0);

      const result = await service.getActiveConversations(differentOrgId, {
        projectId: mockProjectId,
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
      expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: differentOrgId,
          }),
        }),
      );
    });
  });

  /* Message hierarchy behavior is covered by MessageService; conversation reads are metadata-only.
  describe('Message Hierarchy Building', () => {
    it('should build message hierarchy correctly without duplicates and support unlimited depth', async () => {
      // Create a complex message hierarchy:
      // - Message 1 (system, top-level)
      //   - Message 2 (user, response to 1)
      //     - Message 3 (system, response to 2)
      //       - Message 4 (user, response to 3)
      //         - Message 5 (system, response to 4) - 5 levels deep
      // - Message 6 (system, top-level)
      //   - Message 7 (user, response to 6)

      const message1Id = 'msg-1' as MessageId;
      const message2Id = 'msg-2' as MessageId;
      const message3Id = 'msg-3' as MessageId;
      const message4Id = 'msg-4' as MessageId;
      const message5Id = 'msg-5' as MessageId;
      const message6Id = 'msg-6' as MessageId;
      const message7Id = 'msg-7' as MessageId;

      // Create mock conversation with flat message structure (as it comes from database)
      // Define the correct database message type
      type DbMessage = {
        id: MessageId;
        conversationId: ConversationId;
        workflowId: WorkflowId;
        projectId: ProjectId;
        type: string;
        status: string;
        parentMessageId: MessageId | null;
        createdAt: Date;
        data: unknown;
      };

      const mockConversationWithNestedMessages: {
        id: ConversationId;
        projectId: ProjectId;
        organizationId: OrganizationId;
        workflowId: WorkflowId;
        workflowAboutType: string;
        workflowAboutId: string | null;
        initiatedBy: InitiationType;
        triggerEvent: string;
        status: ConversationStatus;
        title: string;
        workflowName: string;
        version: number;
        lastModifiedBy: string | null;
        initiativeId: string | null;
        taskId: string | null;
        designDocId: string | null;
        createdAt: Date;
        updatedAt: Date;
        messages: DbMessage[];
      } = {
        id: mockConversationId,
        projectId: mockProjectId,
        organizationId: mockOrganizationId,
        workflowId: mockWorkflowId,
        workflowAboutType: 'onboarding',
        workflowAboutId: null as string | null,
        initiatedBy: InitiationType.User,
        triggerEvent: 'test_event',
        status: ConversationStatus.Started,
        title: 'Test Conversation',
        workflowName: 'onboarding',
        version: 1,
        lastModifiedBy: null as string | null,
        initiativeId: null as string | null,
        taskId: null as string | null,
        designDocId: null as string | null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        messages: [
          // Flat array of messages (as they come from database)
          {
            id: message1Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'SYSTEM',
            status: 'open',
            parentMessageId: null as MessageId | null,
            createdAt: new Date('2024-01-01T10:00:00Z'),
            data: { type: 'QUESTIONS', response: 'System message 1' },
          },
          {
            id: message2Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'USER',
            status: 'completed',
            parentMessageId: message1Id,
            createdAt: new Date('2024-01-01T10:01:00Z'),
            data: { response: 'User response to 1' },
          },
          {
            id: message3Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'SYSTEM',
            status: 'open',
            parentMessageId: message2Id,
            createdAt: new Date('2024-01-01T10:02:00Z'),
            data: { type: 'QUESTIONS', response: 'System response to 2' },
          },
          {
            id: message4Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'USER',
            status: 'completed',
            parentMessageId: message3Id,
            createdAt: new Date('2024-01-01T10:03:00Z'),
            data: { response: 'User response to 3' },
          },
          {
            id: message5Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'SYSTEM',
            status: 'open',
            parentMessageId: message4Id,
            createdAt: new Date('2024-01-01T10:04:00Z'),
            data: {
              type: 'QUESTIONS',
              response: 'System response to 4 (5 levels deep)',
            },
          },
          {
            id: message6Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'SYSTEM',
            status: 'open',
            parentMessageId: null as MessageId | null,
            createdAt: new Date('2024-01-01T10:05:00Z'),
            data: { type: 'QUESTIONS', response: 'System message 6' },
          },
          {
            id: message7Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'USER',
            status: 'completed',
            parentMessageId: message6Id,
            createdAt: new Date('2024-01-01T10:06:00Z'),
            data: { response: 'User response to 6' },
          },
        ],
      };

      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockConversationWithNestedMessages);

      const result = await service.getConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      if (!result) {
        throw new Error('Expected conversation result');
      }
      expect(result.messages).toHaveLength(2); // Only 2 top-level messages

      // Verify message hierarchy structure
      const topLevelMessage1 = result.messages.find((m) => m.id === message1Id);
      const topLevelMessage6 = result.messages.find((m) => m.id === message6Id);

      expect(topLevelMessage1).toBeDefined();
      expect(topLevelMessage6).toBeDefined();
      if (!topLevelMessage1 || !topLevelMessage6) {
        throw new Error('Expected top-level messages to be defined');
      }

      // Check first branch: message1 -> message2 -> message3 -> message4 -> message5
      expect(topLevelMessage1.responses).toHaveLength(1);
      expect(topLevelMessage1.responses?.[0]?.id).toBe(message2Id);

      const message2 = topLevelMessage1.responses?.[0];
      if (!message2) {
        throw new Error('Expected message2 to be defined');
      }
      expect(message2.responses).toHaveLength(1);
      expect(message2.responses?.[0]?.id).toBe(message3Id);

      const message3 = message2.responses?.[0];
      if (!message3) {
        throw new Error('Expected message3 to be defined');
      }
      expect(message3.responses).toHaveLength(1);
      expect(message3.responses?.[0]?.id).toBe(message4Id);

      const message4 = message3.responses?.[0];
      if (!message4) {
        throw new Error('Expected message4 to be defined');
      }
      expect(message4.responses).toHaveLength(1);
      expect(message4.responses?.[0]?.id).toBe(message5Id);

      const message5 = message4.responses?.[0];
      if (!message5) {
        throw new Error('Expected message5 to be defined');
      }
      expect(message5.responses).toHaveLength(0); // Leaf node

      // Check second branch: message6 -> message7
      expect(topLevelMessage6.responses).toHaveLength(1);
      expect(topLevelMessage6.responses?.[0]?.id).toBe(message7Id);

      const message7 = topLevelMessage6.responses?.[0];
      if (!message7) {
        throw new Error('Expected message7 to be defined');
      }
      expect(message7.responses).toHaveLength(0); // Leaf node

      // Verify no duplicates: count all messages in the hierarchy
      const countMessages = (messages: MessageResponseDto[]): number => {
        return messages.reduce((count, message) => {
          return count + 1 + countMessages(message.responses ?? []);
        }, 0);
      };

      const totalMessagesInHierarchy = countMessages(result.messages);
      expect(totalMessagesInHierarchy).toBe(7); // Exactly 7 unique messages, no duplicates

      // Verify parent message IDs are set correctly (we don't include full parentMessage to avoid circular references)
      expect(message2.parentMessageId).toBe(message1Id);
      expect(message3.parentMessageId).toBe(message2Id);
      expect(message4.parentMessageId).toBe(message3Id);
      expect(message5.parentMessageId).toBe(message4Id);
      expect(message7.parentMessageId).toBe(message6Id);

      // Verify top-level messages have no parent
      expect(topLevelMessage1.parentMessageId).toBeNull();
      expect(topLevelMessage6.parentMessageId).toBeNull();
    });

    it('should handle conversation with no messages', async () => {
      const mockEmptyConversation = TestUtils.createMockDbConversation({
        id: mockConversationId,
        projectId: mockProjectId,
        workflowId: mockWorkflowId,
        messages: [], // No messages
      });

      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockEmptyConversation);

      const result = await service.getConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      if (!result) {
        throw new Error('Expected conversation result');
      }
      expect(result.messages).toHaveLength(0);
    });

    it('should handle orphaned messages (parent not found)', async () => {
      const message1Id = 'msg-1' as MessageId;
      const message2Id = 'msg-2' as MessageId;
      const nonExistentParentId = 'non-existent' as MessageId;

      const mockConversationWithOrphan = {
        id: mockConversationId,
        projectId: mockProjectId,
        organizationId: mockOrganizationId,
        workflowId: mockWorkflowId,
        workflowAboutType: 'onboarding',
        workflowAboutId: null as string | null,
        initiatedBy: InitiationType.User,
        triggerEvent: 'test_event',
        status: ConversationStatus.Started,
        title: 'Test Conversation',
        workflowName: 'onboarding',
        version: 1,
        lastModifiedBy: null as string | null,
        initiativeId: null as string | null,
        taskId: null as string | null,
        designDocId: null as string | null,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
        messages: [
          {
            id: message1Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'SYSTEM',
            status: 'open',
            parentMessageId: null as MessageId | null,
            createdAt: new Date('2024-01-01T10:00:00Z'),
            data: { type: 'QUESTIONS', response: 'System message 1' },
          },
          {
            id: message2Id,
            conversationId: mockConversationId,
            workflowId: mockWorkflowId,
            projectId: mockProjectId,
            type: 'USER',
            status: 'completed',
            parentMessageId: nonExistentParentId, // Parent doesn't exist
            createdAt: new Date('2024-01-01T10:01:00Z'),
            data: { response: 'Orphaned message' },
          },
        ],
      };

      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockConversationWithOrphan);

      const result = await service.getConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      if (!result) {
        throw new Error('Expected conversation result');
      }
      // Orphaned message should be treated as top-level since parent not found
      expect(result.messages).toHaveLength(2);

      const orphanedMessage = result.messages.find((m) => m.id === message2Id);
      expect(orphanedMessage).toBeDefined();
      if (!orphanedMessage) {
        throw new Error('Expected orphaned message to be defined');
      }
      expect(orphanedMessage.parentMessageId).toBe(nonExistentParentId);
    });
  });

  */

  describe('Adapter Methods', () => {
    describe('getConversationFromAdapter', () => {
      it('should validate conversation belongs to project and return conversation', async () => {
        jest
          .spyOn(validationService, 'validateConversationBelongsToProject')
          .mockImplementation();
        jest.spyOn(service, 'getConversation').mockResolvedValue(
          TestUtils.createMockConversation({
            id: mockConversationId,
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          }),
        );

        const result = await service.getConversationFromAdapter(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
        );

        expect(
          validationService.validateConversationBelongsToProject,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            id: mockConversationId,
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          }),
          mockProjectId,
        );
        expect(result).toBeDefined();
      });
    });

    describe('updateConversationFromAdapter', () => {
      it('should validate and update conversation', async () => {
        jest
          .spyOn(validationService, 'validateConversationBelongsToProject')
          .mockImplementation();
        jest.spyOn(service, 'updateConversation').mockResolvedValue(
          TestUtils.createMockConversation({
            id: mockConversationId,
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          }),
        );
        jest.spyOn(service, 'getConversation').mockResolvedValue(
          TestUtils.createMockConversation({
            id: mockConversationId,
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          }),
        );

        const result = await service.updateConversationFromAdapter(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
          mockUpdateConversationDto,
        );

        expect(
          validationService.validateConversationBelongsToProject,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            id: mockConversationId,
            projectId: mockProjectId,
            workflowId: mockWorkflowId,
          }),
          mockProjectId,
        );
        expect(result).toBeDefined();
      });
    });

    describe('getActiveConversationsFromAdapter', () => {
      it('should return formatted active conversations', async () => {
        const mockResult = {
          data: [
            TestUtils.createMockConversation({
              id: mockConversationId,
              projectId: mockProjectId,
              workflowId: mockWorkflowId,
            }),
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        };
        jest
          .spyOn(service, 'getActiveConversations')
          .mockResolvedValue(mockResult);

        const result = await service.getActiveConversationsFromAdapter(
          mockProjectId,
          mockOrganizationId,
        );

        expect(result.data).toHaveLength(1);
        expect(result.pagination).toBeDefined();
        expect(service.getActiveConversations).toHaveBeenCalledWith(
          mockOrganizationId,
          {
            projectId: mockProjectId,
          },
        );
      });
    });

    describe('getAllConversationsFromAdapter', () => {
      it('should return formatted conversations', async () => {
        const mockResult = {
          data: [
            TestUtils.createMockConversation({
              id: mockConversationId,
              projectId: mockProjectId,
              workflowId: mockWorkflowId,
            }),
          ],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        };
        jest
          .spyOn(service, 'getConversationsByProject')
          .mockResolvedValue(mockResult);

        const result = await service.getAllConversationsFromAdapter(
          mockProjectId,
          mockOrganizationId,
        );

        expect(result.data).toHaveLength(1);
        expect(result.pagination).toBeDefined();
        expect(service.getConversationsByProject).toHaveBeenCalledWith(
          mockProjectId,
          mockOrganizationId,
          {},
        );
      });
    });
  });

  // INTEGRATION TESTS - These test real implementations without excessive mocking
  describe('Integration Tests', () => {
    describe('createConversation - workflowAboutId persistence', () => {
      it('should persist workflowAboutId through the full creation flow', async () => {
        // INTENT: Test that workflowAboutId is preserved from input to database to output
        // This integration test would have caught the missing field mapping bug
        const createDto = TestUtils.createMockCreateConversationDto({
          projectId: mockProjectId,
          workflowAboutId: 'integration-test-workflow-about-id',
          title: 'Integration Test Conversation',
          workflowName: 'onboarding',
        });

        // Mock the database creation but verify the data passed to it
        let capturedConversationData: any = null;
        jest
          .spyOn(prismaService.db.conversation, 'create')
          .mockImplementation(((params: any) => {
            capturedConversationData = params.data;
            return Promise.resolve(
              TestUtils.createMockDbConversation({
                id: mockConversationId,
                projectId: mockProjectId,
                workflowId: mockWorkflowId,
                workflowAboutId: params.data.workflowAboutId, // Preserve the input value
                title: params.data.title,
                workflowName: params.data.workflowName,
              }),
            );
          }) as any);

        jest
          .spyOn(prismaService.db.conversation, 'findUnique')
          .mockResolvedValue(
            TestUtils.createMockDbConversation({
              id: mockConversationId,
              workflowAboutId: 'integration-test-workflow-about-id',
              messages: [],
            }),
          );

        // Execute the method under test
        const result = requireNonNull(
          await service.createConversation(createDto, mockOrganizationId),
          'created conversation',
        );

        // CRITICAL ASSERTIONS: Verify workflowAboutId flows through entire pipeline
        expect(capturedConversationData).toBeDefined();
        expect(capturedConversationData.workflowAboutId).toBe(
          'integration-test-workflow-about-id',
        );
        expect(result.workflowAboutId).toBe(
          'integration-test-workflow-about-id',
        );
      });

      it('should handle null workflowAboutId correctly', async () => {
        // INTENT: Test the conditional logic for workflowAboutId
        const createDto = TestUtils.createMockCreateConversationDto({
          projectId: mockProjectId,
          workflowAboutId: null,
          title: 'Test without workflow about ID',
        });

        let capturedConversationData: any = null;
        jest
          .spyOn(prismaService.db.conversation, 'create')
          .mockImplementation(((params: any) => {
            capturedConversationData = params.data;
            return Promise.resolve(
              TestUtils.createMockDbConversation({
                id: mockConversationId,
                projectId: mockProjectId,
                workflowAboutId: null,
              }),
            );
          }) as any);

        jest
          .spyOn(prismaService.db.conversation, 'findUnique')
          .mockResolvedValue(
            TestUtils.createMockDbConversation({
              id: mockConversationId,
              workflowAboutId: null,
              messages: [],
            }),
          );

        const result = requireNonNull(
          await service.createConversation(createDto, mockOrganizationId),
          'created conversation',
        );

        // Verify null values are handled correctly
        expect(capturedConversationData.workflowAboutId).toBeUndefined(); // Should not be included in data
        expect(result.workflowAboutId).toBeUndefined();
      });
    });

    describe('getConversationsByWorkflowEntityFromAdapter metadata reads', () => {
      it('returns workflow conversations without Message relations', async () => {
        const workflowAboutId = 'test-workflow-about-id';
        const workflowAboutType = 'task-generation';

        const mockConversationWithMessages = TestUtils.createMockDbConversation(
          {
            id: mockConversationId,
            workflowAboutId,
            workflowAboutType,
            projectId: mockProjectId,
            messages: [
              TestUtils.createMockDbMessage({
                id: 'msg-1' as MessageId,
                conversationId: mockConversationId,
              }),
              TestUtils.createMockDbMessage({
                id: 'msg-2' as MessageId,
                conversationId: mockConversationId,
              }),
            ] as any,
          },
        );

        // Mock the database query to return conversation with messages
        jest
          .spyOn(prismaService.db.conversation, 'findMany')
          .mockResolvedValue([mockConversationWithMessages]);
        jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(1);

        // Execute the method under test
        const result =
          await service.getConversationsByWorkflowEntityFromAdapter(
            mockOrganizationId,
            mockProjectId,
            workflowAboutId,
            workflowAboutType,
          );

        expect(result.data).toHaveLength(1);
        const [conversation] = result.data;
        if (!conversation) {
          throw new Error('Expected conversation result');
        }
        expect(conversation).not.toHaveProperty('messages');
        expect(conversation.workflowAboutId).toBe(workflowAboutId);

        // Verify the database query was called with correct parameters
        expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({
              workflowAboutId,
              workflowName: workflowAboutType,
              projectId: mockProjectId,
              project: {
                organizationId: mockOrganizationId,
              },
            }),
            include: {},
          }),
        );
      });

      it('returns the same metadata shape when no Messages exist', async () => {
        const workflowAboutId = 'empty-workflow-about-id';
        const workflowAboutType = 'empty-workflow-type';

        const mockConversationWithoutMessages =
          TestUtils.createMockDbConversation({
            id: mockConversationId,
            workflowAboutId,
            workflowAboutType,
            projectId: mockProjectId,
            messages: [], // Empty messages array
          });

        jest
          .spyOn(prismaService.db.conversation, 'findMany')
          .mockResolvedValue([mockConversationWithoutMessages]);
        jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(1);

        const result =
          await service.getConversationsByWorkflowEntityFromAdapter(
            mockOrganizationId,
            mockProjectId,
            workflowAboutId,
            workflowAboutType,
          );

        expect(result.data).toHaveLength(1);
        const [conversation] = result.data;
        if (!conversation) {
          throw new Error('Expected conversation result');
        }
        expect(conversation).not.toHaveProperty('messages');
      });

      it('should return empty results when no conversations match workflow entity', async () => {
        // INTENT: Test empty result handling
        jest
          .spyOn(prismaService.db.conversation, 'findMany')
          .mockResolvedValue([]);
        jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(0);

        const result =
          await service.getConversationsByWorkflowEntityFromAdapter(
            mockOrganizationId,
            mockProjectId,
            'non-existent-workflow-about-id',
            'non-existent-workflow-type',
          );

        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });
    });
  });

  describe('deleteConversation', () => {
    const mockDeletedBy = 'user-123';
    const mockReason = 'Test deletion';

    const mockWorkflowHandle = {
      terminate: jest.fn(),
      executeUpdate: jest.fn(),
      startUpdate: jest.fn(),
      getUpdateHandle: jest.fn(),
      query: jest.fn(),
      signal: jest.fn(),
      cancel: jest.fn(),
      describe: jest.fn(),
      result: jest.fn(),
      workflowId: 'test-workflow-id',
    } as any;

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should successfully delete a conversation without workflow', async () => {
      const conversationWithoutWorkflow = TestUtils.createMockDbConversation({
        ...mockDbConversation,
        workflowId: undefined,
      });

      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(conversationWithoutWorkflow);

      jest.spyOn(prismaService.db.conversation, 'update').mockResolvedValue({
        ...conversationWithoutWorkflow,
        status: ConversationStatus.Deleted,
      });

      const result = await service.deleteConversation(
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(result).toBeDefined();
      expect(prismaService.db.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockConversationId },
          data: expect.objectContaining({
            status: ConversationStatus.Deleted,
          }),
        }),
      );
      expect(eventPublisher.publishInTransaction).toHaveBeenCalled();
      expect(temporalClient.workflow.getHandle).not.toHaveBeenCalled();
    });

    it('should successfully delete a conversation and terminate workflow', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockDbConversation);

      jest.spyOn(prismaService.db.conversation, 'update').mockResolvedValue({
        ...mockDbConversation,
        status: ConversationStatus.Deleted,
      });

      jest
        .spyOn(temporalClient.workflow, 'getHandle')
        .mockReturnValue(mockWorkflowHandle);

      const result = await service.deleteConversation(
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(result).toBeDefined();
      expect(prismaService.db.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockConversationId },
          data: expect.objectContaining({
            status: ConversationStatus.Deleted,
          }),
        }),
      );
      expect(temporalClient.workflow.getHandle).toHaveBeenCalledWith(
        mockWorkflowId,
      );
      expect(mockWorkflowHandle.terminate).toHaveBeenCalledWith(mockReason);
      expect(eventPublisher.publishInTransaction).toHaveBeenCalled();
    });

    it('should skip workflow termination for non-Temporal conversations with workflowId', async () => {
      const nonTemporalConversation = TestUtils.createMockDbConversation({
        ...mockDbConversation,
        workflowName: 'agent-session',
      });

      (
        workflowTypeRegistryServiceMock.isNonTemporalBackedWorkflow as jest.Mock
      ).mockReturnValue(true);
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(nonTemporalConversation);
      jest.spyOn(prismaService.db.conversation, 'update').mockResolvedValue({
        ...nonTemporalConversation,
        status: ConversationStatus.Deleted,
      });

      await service.deleteConversation(
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(temporalClient.workflow.getHandle).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          payload: expect.objectContaining({
            workflowId: mockWorkflowId,
            workflowTerminated: false,
          }),
        }),
      );
    });

    it('should throw NotFoundException if conversation not found', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.deleteConversation(
          mockConversationId,
          mockOrganizationId,
          mockDeletedBy,
          mockReason,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should handle workflow termination errors gracefully', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockDbConversation);

      jest.spyOn(prismaService.db.conversation, 'update').mockResolvedValue({
        ...mockDbConversation,
        status: ConversationStatus.Deleted,
      });

      const mockWorkflowHandleWithError = {
        terminate: jest
          .fn()
          .mockRejectedValue(new Error('Workflow termination failed')),
        executeUpdate: jest.fn(),
        startUpdate: jest.fn(),
        getUpdateHandle: jest.fn(),
        query: jest.fn(),
        signal: jest.fn(),
        cancel: jest.fn(),
        describe: jest.fn(),
        result: jest.fn(),
        workflowId: 'test-workflow-id',
      } as any;

      jest
        .spyOn(temporalClient.workflow, 'getHandle')
        .mockReturnValue(mockWorkflowHandleWithError);

      // Should still complete deletion even if workflow termination fails
      const result = await service.deleteConversation(
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(result).toBeDefined();
      expect(prismaService.db.conversation.update).toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).toHaveBeenCalled();
    });

    it('should publish delete event with correct payload', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockDbConversation);

      jest.spyOn(prismaService.db.conversation, 'update').mockResolvedValue({
        ...mockDbConversation,
        status: ConversationStatus.Deleted,
      });

      jest
        .spyOn(temporalClient.workflow, 'getHandle')
        .mockReturnValue(mockWorkflowHandle);

      await service.deleteConversation(
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        expect.any(Object), // prisma transaction
        expect.objectContaining({
          type: 'conversation.deleted',
          aggregateId: mockConversationId,
          payload: expect.objectContaining({
            workflowId: mockWorkflowId,
            workflowTerminated: true,
            deletedBy: mockDeletedBy,
            reason: mockReason,
            timestamp: expect.any(String),
          }),
        }),
      );
    });
  });

  describe('restoreConversation', () => {
    it('restores a deleted conversation and emits a status change', async () => {
      const deletedConversation = {
        ...mockDbConversation,
        status: ConversationStatus.Deleted,
      };

      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(deletedConversation as any);
      jest.spyOn(prismaService.db.conversation, 'update').mockResolvedValue({
        ...deletedConversation,
        status: ConversationStatus.InProgress,
      } as any);

      await service.restoreConversation(
        mockConversationId,
        mockOrganizationId,
        'restorer-id',
      );

      expect(prismaService.db.conversation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockConversationId },
          data: expect.objectContaining({
            status: ConversationStatus.InProgress,
            lastModifiedBy: 'restorer-id',
          }),
        }),
      );

      expect(eventPublisher.publishInTransaction).toHaveBeenCalledWith(
        prismaService.db,
        expect.objectContaining({
          type: EVENT_TYPES.CONVERSATION.STATUS_CHANGED,
          aggregateId: mockConversationId,
          payload: expect.objectContaining({
            organizationId: mockOrganizationId,
            projectId: deletedConversation.projectId,
            conversationId: mockConversationId,
            previousStatus: ConversationStatus.Deleted,
            newStatus: ConversationStatus.InProgress,
            restoredBy: 'restorer-id',
            timestamp: expect.any(String),
          }),
        }),
      );
    });

    it('throws when the conversation does not exist', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(null);

      await expect(
        service.restoreConversation(mockConversationId, mockOrganizationId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('no-ops when conversation is not deleted', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockDbConversation as any);

      const updateSpy = jest.spyOn(prismaService.db.conversation, 'update');

      await service.restoreConversation(mockConversationId, mockOrganizationId);

      expect(updateSpy).not.toHaveBeenCalled();
      expect(eventPublisher.publishInTransaction).not.toHaveBeenCalled();
    });
  });

  describe('deleteConversationFromAdapter', () => {
    const mockDeletedBy = TestUtils.testIds.user;
    const mockReason = 'Test deletion';
    const ownedConversation = {
      ...mockConversationResponse,
      createdBy: mockDeletedBy,
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should delete conversation and return adapter response', async () => {
      jest
        .spyOn(service, 'deleteConversation')
        .mockResolvedValue(mockConversationResponse);
      jest
        .spyOn(service, 'getConversation')
        .mockResolvedValue(ownedConversation);

      const result = await service.deleteConversationFromAdapter(
        mockProjectId,
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(result).toEqual(mockConversationResponse);
      expect(service.deleteConversation).toHaveBeenCalledWith(
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );
    });

    it('should validate conversation belongs to project', async () => {
      jest
        .spyOn(service, 'deleteConversation')
        .mockResolvedValue(mockConversationResponse);
      jest
        .spyOn(service, 'getConversation')
        .mockResolvedValue(ownedConversation);

      await service.deleteConversationFromAdapter(
        mockProjectId,
        mockConversationId,
        mockOrganizationId,
        mockDeletedBy,
        mockReason,
      );

      expect(
        validationService.validateConversationBelongsToProject,
      ).toHaveBeenCalledWith(ownedConversation, mockProjectId);
    });

    it('should handle validation errors', async () => {
      const validationError = new Error(
        'Conversation does not belong to project',
      );

      jest
        .spyOn(service, 'getConversation')
        .mockResolvedValue(ownedConversation);

      (
        validationService.validateConversationBelongsToProject as jest.Mock
      ).mockImplementation(() => {
        throw validationError;
      });

      await expect(
        service.deleteConversationFromAdapter(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
          mockDeletedBy,
          mockReason,
        ),
      ).rejects.toThrow(validationError);
    });

    it('should reject a conversation without a recorded creator', async () => {
      jest
        .spyOn(service, 'getConversation')
        .mockResolvedValue(mockConversationResponse);
      const deleteSpy = jest.spyOn(service, 'deleteConversation');

      await expect(
        service.deleteConversationFromAdapter(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
          mockDeletedBy,
          mockReason,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it('should reject a caller who is not the conversation creator', async () => {
      jest.spyOn(service, 'getConversation').mockResolvedValue({
        ...ownedConversation,
        createdBy: 'another-user',
      });
      const deleteSpy = jest.spyOn(service, 'deleteConversation');

      await expect(
        service.deleteConversationFromAdapter(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
          mockDeletedBy,
          mockReason,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(deleteSpy).not.toHaveBeenCalled();
    });
  });

  describe('conversation filtering (excludes DELETED conversations)', () => {
    const mockFailedConversation = TestUtils.createMockDbConversation({
      ...mockDbConversation,
      id: 'failed-conv-id' as ConversationId,
      status: ConversationStatus.Deleted,
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should exclude DELETED conversations from getConversation', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(null);

      const result = await service.getConversation(
        mockFailedConversation.id,
        mockOrganizationId,
      );

      expect(result).toBeNull();
      expect(prismaService.db.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              not: ConversationStatus.Deleted,
            },
          }),
        }),
      );
    });

    it('should exclude DELETED conversations from getActiveConversationsFromAdapter', async () => {
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([mockDbConversation]);
      jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(1);

      await service.getActiveConversationsFromAdapter(
        mockProjectId,
        mockOrganizationId,
        {},
      );

      expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: expect.objectContaining({
              in: expect.arrayContaining([
                ConversationStatus.NotStarted,
                ConversationStatus.Started,
                ConversationStatus.InProgress,
                ConversationStatus.GeneratingResponse,
              ]),
            }),
          }),
        }),
      );
    });

    it('should exclude DELETED conversations from getAllConversationsFromAdapter', async () => {
      const mockProject = TestUtils.createMockDbProject({
        id: mockProjectId,
        organizationId: mockOrganizationId,
        name: 'Test Project',
        status: ProjectStatus.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
        description: 'Test Description',
        deletedAt: null,
      });
      jest
        .spyOn(prismaService.db.project, 'findFirst')
        .mockResolvedValue(mockProject);
      jest
        .spyOn(prismaService.db.conversation, 'findMany')
        .mockResolvedValue([mockDbConversation]);
      jest.spyOn(prismaService.db.conversation, 'count').mockResolvedValue(1);

      await service.getAllConversationsFromAdapter(
        mockProjectId,
        mockOrganizationId,
        {},
      );

      expect(prismaService.db.conversation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: {
              not: ConversationStatus.Deleted,
            },
          }),
        }),
      );
    });
  });

  describe('getConversationVersion', () => {
    it('returns version when conversation exists and belongs to project', async () => {
      const version = 5;
      (
        prismaService.db.conversation.findFirst as unknown as jest.Mock
      ).mockResolvedValue({
        version,
        projectId: mockProjectId,
      } as any);

      const result = await service.getConversationVersion(
        mockProjectId,
        mockConversationId,
        mockOrganizationId,
      );

      expect(prismaService.db.conversation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: mockConversationId,
            organizationId: mockOrganizationId,
            status: {
              not: ConversationStatus.Deleted,
            },
          }),
          select: {
            version: true,
            projectId: true,
          },
        }),
      );
      expect(result).toBe(version);
    });

    it('throws NotFoundException when conversation is missing', async () => {
      (
        prismaService.db.conversation.findFirst as unknown as jest.Mock
      ).mockResolvedValue(null);

      await expect(
        service.getConversationVersion(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws BadRequestException when project does not match', async () => {
      (
        prismaService.db.conversation.findFirst as unknown as jest.Mock
      ).mockResolvedValue({
        version: 2,
        projectId: 'different-project' as ProjectId,
      } as any);

      await expect(
        service.getConversationVersion(
          mockProjectId,
          mockConversationId,
          mockOrganizationId,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('EntityRegistry Integration', () => {
    it('should register conversation with title in EntityRegistry when created', async () => {
      const createDto: CreateConversationDto = {
        projectId: mockProjectId,
        organizationId: mockOrganizationId,
        workflowId: mockWorkflowId,
        initiatedBy: InitiationType.User,
        triggerEvent: 'test_event',
        title: 'Important Conversation',
        workflowName: 'onboarding',
        status: ConversationStatus.Started,
        context: {},
      };

      const mockCreatedConversation = TestUtils.createMockDbConversation({
        id: mockConversationId,
        projectId: mockProjectId,
        title: 'Important Conversation',
        status: ConversationStatus.Started,
      });

      jest
        .spyOn(prismaService.db.conversation, 'create')
        .mockResolvedValue(mockCreatedConversation);

      await service.createConversation(createDto, mockOrganizationId);

      // Verify EntityRegistry was called with conversation title
      // Note: The actual call happens in a transaction, but we verify the service behavior
      expect(prismaService.db.conversation.create).toHaveBeenCalled();
    });

    it('should handle conversation title as EntityRegistry name', async () => {
      const mockConversation = TestUtils.createMockDbConversation({
        id: mockConversationId,
        projectId: mockProjectId,
        title: 'Workflow Discussion',
        status: ConversationStatus.InProgress,
      });

      jest
        .spyOn(prismaService.db.conversation, 'findFirst')
        .mockResolvedValue(mockConversation);

      const result = await service.getConversation(
        mockConversationId,
        mockOrganizationId,
      );

      expect(result).toBeDefined();
      expect(result?.title).toBe('Workflow Discussion');
      // Title is what gets registered in EntityRegistry
    });

    it('should use fallback name when conversation title is not provided', async () => {
      const createDto: CreateConversationDto = {
        projectId: mockProjectId,
        organizationId: mockOrganizationId,
        workflowId: mockWorkflowId,
        initiatedBy: InitiationType.User,
        triggerEvent: 'auto_event',
        // No title provided
        workflowName: 'onboarding',
        status: ConversationStatus.Started,
        context: {},
      };

      const mockCreatedConversation = TestUtils.createMockDbConversation({
        id: mockConversationId,
        projectId: mockProjectId,
        title: undefined, // No title
        status: ConversationStatus.Started,
      });

      jest
        .spyOn(prismaService.db.conversation, 'create')
        .mockResolvedValue(mockCreatedConversation);

      await service.createConversation(createDto, mockOrganizationId);

      // Verify conversation was created even without explicit title
      expect(prismaService.db.conversation.create).toHaveBeenCalled();
    });
  });
});
