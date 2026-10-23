import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConversationService } from '../conversation.service';
import { MessageService } from '../message.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationValidation } from '../../validation/conversation.validation';
import { ProjectService } from '../project.service';
import { ArtifactService } from '../artifacts/artifact.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import * as TestUtils from '../../utils/testUtils';
import {
  ConversationId,
  MessageId,
  InitiativeId,
  WorkflowId,
  UserId,
} from '../../types';
import {
  ConversationStatus,
  InitiationType,
  SystemMessageResponseType,
  WorkflowName,
} from '../../generated';
import { WorkflowSignalHelper } from '../../utils/workflow-signals.helper';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';
import { ReportService } from '../reports/report.service';
import { MessageStatus } from '../../constants/message-status.constants';

// Mock the WorkflowSignalHelper
jest.mock('../../utils/workflow-signals.helper');

const { testIds } = TestUtils;

describe('ConversationService - Clone Functionality', () => {
  let service: ConversationService;
  let messageService: MessageService;
  let artifactService: ArtifactService;
  let projectService: ProjectService;
  let mockPrismaService: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockEventPublisher: ReturnType<
    typeof TestUtils.createMockDomainEventPublisher
  >;
  let originalWaitForProjectConversation: any;

  // Define mock services with all needed methods
  const mockMessageService = {
    ...TestUtils.createMockMessageService(),
    cloneMessagesForConversationWithOpenerHandling: jest.fn(),
    getMessagesByNodeId: jest.fn(),
    getMessages: jest.fn(),
    deleteMessage: jest.fn(),
  };

  const mockArtifactService = {
    ...TestUtils.createMockArtifactService(),
    findByNodeIds: jest.fn(),
  };

  beforeEach(async () => {
    // Standard fake timers for most tests
    jest.useFakeTimers();
    mockPrismaService = TestUtils.createMockPrismaService();
    mockEventPublisher = TestUtils.createMockDomainEventPublisher();

    // Mock specific Prisma methods used in tests
    mockPrismaService.db.conversation.findUnique = jest.fn();
    mockPrismaService.db.conversation.create = jest.fn();
    mockPrismaService.db.conversation.findFirst = jest.fn();
    mockPrismaService.db.conversation.update = jest.fn();
    mockPrismaService.db.conversation.findMany = jest.fn();
    (mockPrismaService.db.conversation as any).count = jest.fn();
    mockPrismaService.db.message.findMany = jest.fn();
    (mockPrismaService.db.message as any).count = jest.fn();
    (mockPrismaService.db.message as any).createMany = jest.fn();
    (mockPrismaService.db.message as any).deleteMany = jest.fn();
    mockPrismaService.db.message.create = jest.fn();
    mockPrismaService.db.artifact.findMany = jest.fn();
    (mockPrismaService.db.artifact as any).createMany = jest.fn();
    mockPrismaService.db.project.create = jest.fn();
    mockPrismaService.db.project.findFirst = jest.fn();
    (mockPrismaService.db as any).projectInitiative = {
      create: jest.fn(),
      findUnique: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: DOMAIN_EVENT_PUBLISHER_TOKEN, useValue: mockEventPublisher },
        {
          provide: ConversationValidation,
          useValue: {
            validateCategoryAndInitiationType: jest.fn(),
            validateProjectIdConsistency: jest.fn(),
            validateConversationBelongsToProject: jest.fn(),
          },
        },
        { provide: MessageService, useValue: mockMessageService },
        { provide: ArtifactService, useValue: mockArtifactService },
        {
          provide: ProjectService,
          useValue: { create: jest.fn(), findById: jest.fn() },
        },
        {
          provide: WorkflowTypeRegistryService,
          useValue: {
            getWorkflowConfig: jest.fn().mockReturnValue(null),
            isWorkflowTypeSupported: jest.fn().mockReturnValue(true),
            registerWorkflowType: jest.fn(),
            startWorkflowByType: jest
              .fn()
              .mockResolvedValue({ workflowId: 'new-workflow-id' }),
          },
        },
        {
          provide: EntityRegistryService,
          useValue: {
            registerEntity: jest.fn(),
            registerEntities: jest.fn(),
            lookupEntityTypes: jest.fn(),
          },
        },
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: TestUtils.createMockTemporalClient(),
        },
        {
          provide: ReportService,
          useValue: {
            getReportsByConversationId: jest.fn().mockResolvedValue([]),
          },
        },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
    messageService = module.get<MessageService>(MessageService);
    artifactService = module.get<ArtifactService>(ArtifactService);
    projectService = module.get<ProjectService>(ProjectService);

    // Save original method for restoration
    originalWaitForProjectConversation = (service as any)
      .waitForProjectConversation;

    // Mock waitForProjectConversation GLOBALLY to avoid waiting in most tests
    // This prevents timeouts in tests that don't care about the waiting logic
    (service as any).waitForProjectConversation = jest.fn().mockResolvedValue({
      data: [
        {
          id: 'new-conv-id',
          projectId: testIds.project,
          messages: [{ id: 'm1' }],
        },
      ],
      pagination: { total: 1 },
    });

    // Ensure $transaction executes callback with the mock db
    (mockPrismaService.db as any).$transaction = jest.fn(async (cb: any) =>
      cb(mockPrismaService.db),
    );

    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('Core Clone Logic', () => {
    const sourceConversationId = testIds.conversation;
    const organizationId = testIds.organization;
    const userId = testIds.user;
    const targetNodeId = 'gather_feedback';
    const cloneOptions = {
      targetNodeId,
      title: 'Cloned Conversation',
    };
    const workflowName = WorkflowName.InitiativeRefinement;

    const mockSourceConversation = {
      id: sourceConversationId,
      title: 'Original Conversation',
      projectId: testIds.project,
      organizationId,
      workflowId: testIds.workflow,
      workflowType: 'initiative_refinement',
      workflowAboutId: null as string | null,
      initiativeId: null as InitiativeId | null,
      status: ConversationStatus.InProgress,
      workflowName: 'initiative-refinement',
      initiatedBy: InitiationType.User,
      createdAt: new Date(),
      updatedAt: new Date(),
      version: 1,
      messages: [] as any[],
    };

    const mockMessages = [
      {
        id: 'msg-1',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        status: MessageStatus.Completed,
        userId: null as UserId | null,
        conversationId: sourceConversationId,
        parentMessageId: null as MessageId | null,
        createdAt: new Date(),
        type: 'SYSTEM',
        data: {
          type: 'QUESTIONS',
          nodeId: 'onboarding_clarify_concept',
          questions: ['What is your goal?'],
        },
      },
      {
        id: 'msg-2',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        status: MessageStatus.Completed,
        userId: userId,
        conversationId: sourceConversationId,
        parentMessageId: 'msg-1' as MessageId,
        createdAt: new Date(),
        type: 'USER',
        data: {
          type: 'user',
          message: 'Build a project management tool',
        },
      },
      {
        id: 'msg-3',
        workflowId: testIds.workflow,
        projectId: testIds.project,
        status: MessageStatus.Completed,
        userId: null as UserId | null,
        conversationId: sourceConversationId,
        parentMessageId: 'msg-2' as MessageId,
        createdAt: new Date(),
        type: 'SYSTEM',
        data: {
          type: 'ANALYSIS',
          nodeId: targetNodeId,
          analysis: { insights: ['Good project'] },
        },
      },
    ];

    beforeEach(() => {
      // Setup default mocks for core logic
      mockPrismaService.db.conversation.findUnique.mockResolvedValue(
        mockSourceConversation as any,
      );
      mockPrismaService.db.conversation.findFirst.mockResolvedValue(
        mockSourceConversation as any,
      );
      mockPrismaService.db.conversation.create.mockResolvedValue({
        ...mockSourceConversation,
        id: 'new-conv-id' as ConversationId,
        title: cloneOptions.title,
        workflowId: 'new-workflow-id' as WorkflowId,
        messages: [],
      } as any);
      mockPrismaService.db.conversation.update.mockResolvedValue({
        ...mockSourceConversation,
        id: 'new-conv-id' as ConversationId,
        workflowId: 'new-workflow-id' as WorkflowId,
        messages: [],
      } as any);

      (mockPrismaService.db.message as any).createMany.mockResolvedValue({
        count: mockMessages.length,
      });

      // Mock message service behavior
      (messageService as any).getMessagesByNodeId.mockResolvedValue(
        mockMessages,
      );
      (messageService as any).getMessages.mockResolvedValue([]);
      (
        messageService as any
      ).cloneMessagesForConversationWithOpenerHandling.mockResolvedValue({
        messagesCloned: mockMessages.length,
        openerDeleted: false,
        nodeIds: mockMessages
          .map((m) => (m.data as any)?.nodeId)
          .filter(Boolean),
      });

      // Mock artifact service behavior
      (artifactService as any).findByNodeIds.mockResolvedValue([]);
      (artifactService as any).createMany.mockResolvedValue(0);
    });

    it('should successfully clone a conversation up to target node', async () => {
      const result = await service.cloneConversation(
        sourceConversationId,
        organizationId,
        cloneOptions,
        userId,
        workflowName,
      );

      expect(mockPrismaService.db.conversation.create).toHaveBeenCalled();
      expect(
        (messageService as any).cloneMessagesForConversationWithOpenerHandling,
      ).toHaveBeenCalled();
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'conversation.created',
          aggregateId: 'new-conv-id',
        }),
      );
      expect(result.conversation.id).toBe('new-conv-id');
      expect(result.cloneMetadata).toEqual(
        expect.objectContaining({
          sourceConversationId,
          targetNodeId,
          messagesCloned: mockMessages.length,
        }),
      );
    });

    it('should clone artifacts based on extracted nodeIds', async () => {
      const mockArtifacts = [
        {
          id: 'artifact-1',
          data: {
            type: 'INSIGHT',
            nodeId: 'onboarding_clarify_concept',
          },
        },
      ];
      (artifactService as any).findByNodeIds.mockResolvedValue(mockArtifacts);
      (artifactService as any).createMany.mockResolvedValue(1);

      const result = await service.cloneConversation(
        sourceConversationId,
        organizationId,
        cloneOptions,
        userId,
        workflowName,
      );

      expect(artifactService.findByNodeIds).toHaveBeenCalledWith(
        expect.arrayContaining(['onboarding_clarify_concept', targetNodeId]),
        sourceConversationId,
        organizationId,
      );
      expect(artifactService.createMany).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            sourceId: 'new-conv-id',
            data: expect.objectContaining({
              nodeId: 'onboarding_clarify_concept',
            }),
          }),
        ]),
        expect.anything(),
      );
      expect(result.cloneMetadata.artifactsCloned).toBe(1);
    });

    it('should send skipToNode signal to position workflow', async () => {
      await service.cloneConversation(
        sourceConversationId,
        organizationId,
        cloneOptions,
        userId,
        workflowName,
      );

      expect(WorkflowSignalHelper.sendSkipToNode).toHaveBeenCalledWith(
        expect.anything(),
        'new-workflow-id',
        targetNodeId,
        expect.anything(),
      );
    });

    it('should handle errors gracefully when source conversation not found', async () => {
      mockPrismaService.db.conversation.findFirst.mockResolvedValue(null);

      await expect(
        service.cloneConversation(
          sourceConversationId,
          organizationId,
          cloneOptions,
          userId,
          workflowName,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Race Condition & Waiting Logic', () => {
    const projectId = testIds.project;
    const organizationId = testIds.organization;

    beforeEach(() => {
      // Disable fake timers for this block so we can use instant timeout mock
      jest.useRealTimers();
      jest.spyOn(global, 'setTimeout').mockImplementation((cb: any) => cb());

      // Restore original method for this block
      (service as any).waitForProjectConversation =
        originalWaitForProjectConversation.bind(service);

      // Mock project ownership validation which is called by getConversationsByProject
      mockPrismaService.db.project.findFirst.mockResolvedValue({
        id: projectId,
        organizationId,
      } as any);
    });

    it('should wait for project conversation creation with retries', async () => {
      // Simulate waiting: first calls empty, then found
      (mockPrismaService.db.conversation as any).count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1);

      mockPrismaService.db.conversation.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            id: 'found-conv',
            projectId,
            messages: [{ id: 'msg-1', createdAt: new Date() }],
            createdAt: new Date(),
            updatedAt: new Date(),
          } as any,
        ]);
      (mockPrismaService.db.message as any).count.mockResolvedValue(1);

      const result = await (service as any).waitForProjectConversation(
        projectId,
        organizationId,
      );

      expect(result.data).toHaveLength(1);
      expect(result.data[0].id).toBe('found-conv');
      // count called 3 times (polling)
      expect(
        (mockPrismaService.db.conversation as any).count,
      ).toHaveBeenCalledTimes(3);
      // findMany also called 3 times (in parallel with count via Promise.all)
      expect(mockPrismaService.db.conversation.findMany).toHaveBeenCalledTimes(
        3,
      );
      expect((mockPrismaService.db.message as any).count).toHaveBeenCalledTimes(
        1,
      );
    });

    it('should handle timeout when waiting for conversation', async () => {
      // Simulate never finding it
      mockPrismaService.db.conversation.findMany.mockResolvedValue([]);
      (mockPrismaService.db.conversation as any).count.mockResolvedValue(0);

      const result = await (service as any).waitForProjectConversation(
        projectId,
        organizationId,
      );

      expect(result.data).toHaveLength(0);
    });
  });

  describe('Workflow Interference Logic', () => {
    const sourceConversationId = testIds.conversation;
    const organizationId = testIds.organization;
    const userId = testIds.user;
    const targetNodeId = 'gather_feedback';

    beforeEach(() => {
      // Mock basic setup for this describe block
      mockPrismaService.db.conversation.findFirst.mockResolvedValue({
        id: sourceConversationId,
        organizationId,
        projectId: testIds.project,
        workflowId: testIds.workflow,
        status: ConversationStatus.InProgress,
        workflowName: 'onboarding',
        messages: [], // Ensure messages array is present
        createdAt: new Date(), // Required for mapToDto
        updatedAt: new Date(), // Required for mapToDto
      } as any);

      (projectService.create as jest.Mock).mockResolvedValue({
        id: 'new-project-id',
        organizationId,
      });

      mockPrismaService.db.project.findFirst.mockResolvedValue({
        id: 'new-project-id',
        organizationId,
      } as any);

      mockPrismaService.db.conversation.findMany.mockResolvedValue([
        {
          id: 'new-conv-id',
          projectId: 'new-project-id',
          messages: [{ id: 'm1' }],
        } as any,
      ]);

      (mockPrismaService.db.conversation as any).count.mockResolvedValue(1);

      // IMPORTANT: Mock the message cloning result for THIS block using the proper method
      (
        messageService as any
      ).cloneMessagesForConversationWithOpenerHandling.mockResolvedValue({
        messagesCloned: 2,
        messageIdMap: new Map(),
        nodeIds: [],
        openerDeleted: false,
      });

      (artifactService as any).findByNodeIds.mockResolvedValue([]);
      (artifactService as any).createMany.mockResolvedValue(0);
    });

    it('should preserve existing opener message if present', async () => {
      // Mock existing opener
      (messageService as any).getMessages.mockResolvedValue([
        { id: 'existing-opener', type: 'SYSTEM' },
      ]);

      await service.cloneConversation(
        sourceConversationId,
        organizationId,
        { targetNodeId, title: 'Clone' },
        userId,
        WorkflowName.Onboarding,
      );

      // Verify clone called with existing opener ID
      expect(
        (messageService as any).cloneMessagesForConversationWithOpenerHandling,
      ).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        'existing-opener',
      );

      // Verify deleteMessage NOT called
      expect(messageService.deleteMessage).not.toHaveBeenCalled();
    });

    it('creates the cloned project on behalf of the cloning user', async () => {
      (messageService as any).getMessages.mockResolvedValue([]);

      await service.cloneConversation(
        sourceConversationId,
        organizationId,
        { targetNodeId, title: 'Clone' },
        userId,
        WorkflowName.Onboarding,
      );

      expect(projectService.create).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId }),
        userId,
      );
    });

    it('should proceed normally if no existing opener', async () => {
      // Mock NO existing opener
      (messageService as any).getMessages.mockResolvedValue([]);

      await service.cloneConversation(
        sourceConversationId,
        organizationId,
        { targetNodeId, title: 'Clone' },
        userId,
        WorkflowName.Onboarding,
      );

      // Verify clone called with null opener ID
      expect(
        (messageService as any).cloneMessagesForConversationWithOpenerHandling,
      ).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(String),
        expect.any(String),
        null,
      );
    });
  });

  describe('Helper Logic Verification', () => {
    it('should correctly extract nodeIds from messages', () => {
      const messages = [
        { data: { nodeId: 'node1' } },
        { data: { other: 'data' } },
        { data: { nodeId: 'node2' } },
      ];
      const nodeIds = messages
        .map((m) => (m.data as any)?.nodeId)
        .filter(Boolean);
      expect(nodeIds).toEqual(['node1', 'node2']);
    });
  });
});
