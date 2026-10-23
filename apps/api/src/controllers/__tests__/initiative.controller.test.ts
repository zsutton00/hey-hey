import { OrganizationGuard } from '../../auth/guards/organization.guard';
import { ProjectAccessGuard } from '../../auth/guards/project-access.guard';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  ConversationStatus,
  InitiativeCreatorType,
  InitiativeResponseDto,
  InitiativeSourceType,
  WorkStatus,
  Priority,
  ProjectResponseDto,
} from '../../generated';
import { ConversationService } from '../../services/conversation.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { InitiativeLifecycleService } from '../../services/initiatives/initiative-lifecycle.service';
import { ProjectId, WorkflowId } from '../../types';
import * as TestUtils from '../../utils/testUtils';
import { InitiativeController } from '../initiative.controller';

const { testIds } = TestUtils;

describe('InitiativeController', () => {
  let controller: InitiativeController;

  const mockInitiativeService = {
    createForAdapter: jest.fn(),
    findAllForAdapter: jest.fn(),
    findOneForAdapter: jest.fn(),
    findByIdForAdapter: jest.fn(),
    updateForAdapter: jest.fn(),
    removeForAdapter: jest.fn(),
    linkProject: jest.fn(),
    unlinkProject: jest.fn(),
    getLinkedProjects: jest.fn(),
    getActiveRefinementConversation: jest.fn(),
    applyRefinementChanges: jest.fn(),
    clearActiveRefinementConversation: jest.fn(),
  };

  const mockConversationService = TestUtils.createMockConversationService();

  const mockInitiativeLifecycleService =
    TestUtils.createMockInitiativeLifecycleService();

  const mockTemporalClient = {
    workflow: {
      start: jest.fn(),
      getHandle: jest.fn(),
    },
  };

  const organizationId = testIds.organization;
  const initiativeId = testIds.initiative;
  const conversationId = testIds.conversation;
  const workflowId = testIds.workflow;
  const projectId = testIds.project;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [InitiativeController],
      providers: [
        {
          provide: InitiativeService,
          useValue: mockInitiativeService,
        },
        {
          provide: ConversationService,
          useValue: mockConversationService,
        },
        {
          provide: InitiativeLifecycleService,
          useValue: mockInitiativeLifecycleService,
        },
        {
          provide: 'TEMPORAL_CLIENT',
          useValue: mockTemporalClient,
        },
      ],
    })
      .overrideGuard(OrganizationGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ProjectAccessGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<InitiativeController>(InitiativeController);

    // Reset all mocks
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create an initiative successfully', async () => {
      const createDto = {
        name: 'Test Initiative',
        description: 'Test Description',
        organizationId,
        projectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
        tags: ['test'],
      };

      const mockResponse = {
        id: initiativeId,
        ...createDto,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        creatorType: InitiativeCreatorType.User,
        dueDate: null as string | null,
        reasoning: null as string | null,
        sourceConversationId: null as string | null,
      };

      mockInitiativeService.createForAdapter.mockResolvedValue(mockResponse);

      const result = await controller.create(createDto, organizationId);

      expect(mockInitiativeService.createForAdapter).toHaveBeenCalledWith(
        createDto,
        organizationId,
        projectId,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should forward projectId when linking to a project', async () => {
      const createDto = {
        name: 'Test Initiative',
        description: 'Test Description',
        projectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
        tags: ['test'],
      };

      const mockResponse = {
        id: initiativeId,
        ...createDto,
        organizationId,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        creatorType: InitiativeCreatorType.User,
        dueDate: null as string | null,
        reasoning: null as string | null,
        sourceConversationId: null as string | null,
      };

      mockInitiativeService.createForAdapter.mockResolvedValue(mockResponse);

      const result = await controller.create(createDto, organizationId);

      expect(mockInitiativeService.createForAdapter).toHaveBeenCalledWith(
        createDto,
        organizationId,
        projectId,
      );
      expect(result).toEqual(mockResponse);
    });

    it('should create initiative with sourceConversationId', async () => {
      const createDto = {
        name: 'Test Initiative',
        description: 'Test Description',
        sourceConversationId: conversationId,
        projectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
        tags: ['test'],
      };

      const mockResponse = {
        id: initiativeId,
        ...createDto,
        organizationId,
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        creatorType: InitiativeCreatorType.User,
        dueDate: null as string | null,
        reasoning: null as string | null,
      };

      mockInitiativeService.createForAdapter.mockResolvedValue(mockResponse);

      const result = await controller.create(createDto, organizationId);

      expect(mockInitiativeService.createForAdapter).toHaveBeenCalledWith(
        createDto,
        organizationId,
        projectId,
      );
      expect(result).toEqual(mockResponse);
      expect(result.sourceConversationId).toBe(conversationId);
    });

    it('should return validation error for invalid sourceConversationId', async () => {
      const createDto = {
        name: 'Test Initiative',
        description: 'Test Description',
        sourceConversationId: 'invalid-conversation-id',
        projectId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
      };

      const validationError = new Error(
        'Source conversation invalid-conversation-id not found in organization ' +
          organizationId,
      );

      mockInitiativeService.createForAdapter.mockRejectedValue(validationError);

      await expect(
        controller.create(createDto, organizationId),
      ).rejects.toThrow(
        'Source conversation invalid-conversation-id not found in organization',
      );

      expect(mockInitiativeService.createForAdapter).toHaveBeenCalledWith(
        createDto,
        organizationId,
        projectId,
      );
    });
  });

  describe('findAll', () => {
    it('should find all initiatives with default parameters', async () => {
      const projectId = 'project-default' as ProjectId;
      const mockInitiatives = [
        {
          id: 'initiative-1',
          name: 'Initiative 1',
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.Medium,
          tags: [] as string[],
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockInitiativeService.findAllForAdapter.mockResolvedValue(
        mockInitiatives,
      );

      const result = await controller.findAll(
        organizationId,
        undefined,
        undefined,
        undefined,
        projectId,
        undefined,
        undefined,
        undefined,
      );

      expect(mockInitiativeService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        {
          statuses: undefined,
          priority: undefined,
          tags: undefined,
          sourceType: { not: InitiativeSourceType.Plan },
          projectId,
          page: undefined,
          limit: undefined,
        },
      );
      expect(result).toEqual(mockInitiatives);
    });

    it('should find initiatives with query parameters', async () => {
      const mockInitiatives = [
        {
          id: 'initiative-1',
          name: 'High Priority Initiative',
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.High,
          tags: ['important'],
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockInitiativeService.findAllForAdapter.mockResolvedValue(
        mockInitiatives,
      );

      const result = await controller.findAll(
        organizationId,
        WorkStatus.Active,
        Priority.High,
        'important',
        'project-123' as ProjectId, // projectId
        '2',
        '5',
        undefined,
      );

      expect(mockInitiativeService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        {
          statuses: [WorkStatus.Active],
          priority: Priority.High,
          tags: ['important'],
          sourceType: { not: InitiativeSourceType.Plan },
          projectId: 'project-123',
          page: 2,
          limit: 5,
        },
      );
      expect(result).toEqual(mockInitiatives);
    });

    it('should handle multiple tags as array', async () => {
      const mockInitiatives: InitiativeResponseDto[] = [];

      mockInitiativeService.findAllForAdapter.mockResolvedValue(
        mockInitiatives,
      );

      const result = await controller.findAll(
        organizationId,
        undefined,
        undefined,
        ['tag1', 'tag2'],
        'project-xyz' as ProjectId,
        undefined,
        undefined,
        undefined,
      );

      expect(mockInitiativeService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        {
          statuses: undefined,
          priority: undefined,
          tags: ['tag1', 'tag2'],
          sourceType: { not: InitiativeSourceType.Plan },
          projectId: 'project-xyz',
          page: undefined,
          limit: undefined,
        },
      );
      expect(result).toEqual(mockInitiatives);
    });

    it('should filter initiatives by projectId', async () => {
      const projectId = 'project-123' as ProjectId;
      const mockInitiatives = [
        {
          id: 'initiative-1',
          name: 'Project Initiative',
          organizationId,
          status: WorkStatus.Active,
          priority: Priority.High,
          tags: ['project-related'],
          createdAt: '2023-01-01T00:00:00.000Z',
          updatedAt: '2023-01-01T00:00:00.000Z',
        },
      ];

      mockInitiativeService.findAllForAdapter.mockResolvedValue(
        mockInitiatives,
      );

      const result = await controller.findAll(
        organizationId,
        undefined,
        undefined,
        undefined,
        projectId,
        undefined,
        undefined,
        undefined,
      );

      expect(mockInitiativeService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        {
          statuses: undefined,
          priority: undefined,
          tags: undefined,
          sourceType: { not: InitiativeSourceType.Plan },
          projectId,
          page: undefined,
          limit: undefined,
        },
      );
      expect(result).toEqual(mockInitiatives);
    });

    it('should normalize comma-separated statuses', async () => {
      const projectId = 'project-123' as ProjectId;
      const mockInitiatives: InitiativeResponseDto[] = [];

      mockInitiativeService.findAllForAdapter.mockResolvedValue(
        mockInitiatives,
      );

      await controller.findAll(
        organizationId,
        `${WorkStatus.Active},${WorkStatus.Completed}`,
        undefined,
        undefined,
        projectId,
        undefined,
        undefined,
        undefined,
      );

      expect(mockInitiativeService.findAllForAdapter).toHaveBeenCalledWith(
        organizationId,
        {
          statuses: [WorkStatus.Active, WorkStatus.Completed],
          priority: undefined,
          tags: undefined,
          sourceType: { not: InitiativeSourceType.Plan },
          projectId,
          page: undefined,
          limit: undefined,
        },
      );
    });

    it('should throw BadRequestException when projectId is missing', async () => {
      await expect(
        controller.findAll(
          organizationId,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('findOne', () => {
    it('should find an initiative by id', async () => {
      const mockInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
        status: WorkStatus.Active,
        priority: Priority.Medium,
        tags: [] as string[],
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
      };

      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);

      const result = await controller.findOne(initiativeId, organizationId);

      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );
      expect(result).toEqual(mockInitiative);
    });

    it('should throw NotFoundException when initiative not found', async () => {
      mockInitiativeService.findOneForAdapter.mockResolvedValue(null);

      await expect(
        controller.findOne(initiativeId, organizationId),
      ).rejects.toThrow(NotFoundException);

      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );
    });
  });

  describe('update', () => {
    it('should update an initiative successfully', async () => {
      const updateDto = {
        name: 'Updated Initiative',
        status: WorkStatus.Active,
        priority: Priority.Critical,
      };

      const mockUpdatedInitiative = {
        id: initiativeId,
        ...updateDto,
        organizationId,
        tags: [] as string[],
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-02T00:00:00.000Z',
      };

      mockInitiativeService.updateForAdapter.mockResolvedValue(
        mockUpdatedInitiative,
      );

      const mockUser = TestUtils.createMockAuthenticatedUser();
      const result = await controller.update(
        initiativeId,
        updateDto,
        organizationId,
        mockUser.userId,
        mockUser.email,
        mockUser.name,
      );

      expect(mockInitiativeService.updateForAdapter).toHaveBeenCalledWith(
        initiativeId,
        updateDto,
        organizationId,
        mockUser.userId,
        mockUser.email,
        mockUser.name,
      );
      expect(result).toEqual(mockUpdatedInitiative);
    });
  });

  describe('remove', () => {
    it('should archive an initiative successfully', async () => {
      const mockArchivedInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
        status: WorkStatus.Active,
        priority: Priority.Medium,
        tags: [] as string[],
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        creatorType: InitiativeCreatorType.User,
        description: 'Test Description',
        dueDate: null as string | null,
        reasoning: null as string | null,
        sourceConversationId: null as string | null,
      };

      mockInitiativeService.removeForAdapter.mockResolvedValue(
        mockArchivedInitiative,
      );

      const result = await controller.remove(initiativeId, organizationId);

      expect(mockInitiativeService.removeForAdapter).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );
      expect(result).toEqual(mockArchivedInitiative);
    });
  });

  describe('linkProject', () => {
    const projectId = 'project-123' as ProjectId;

    it('should link a project to initiative successfully', async () => {
      const role = 'primary';
      const mockLinkResult = {
        id: 'link-123',
        projectId,
        initiativeId,
        role,
        createdAt: new Date(),
      };

      mockInitiativeService.linkProject.mockResolvedValue(mockLinkResult);

      const result = await controller.linkProject(
        initiativeId,
        projectId,
        organizationId,
        role,
      );

      expect(mockInitiativeService.linkProject).toHaveBeenCalledWith(
        initiativeId,
        projectId,
        organizationId,
        role,
      );

      expect(result).toEqual({
        success: true,
        message: 'Project linked to initiative successfully',
        data: mockLinkResult,
        initiativeId,
        projectId,
      });
    });

    it('should link project without role', async () => {
      const mockLinkResult = {
        id: 'link-123',
        projectId,
        initiativeId,
        role: null as string | null,
        createdAt: new Date(),
      };

      mockInitiativeService.linkProject.mockResolvedValue(mockLinkResult);

      const result = await controller.linkProject(
        initiativeId,
        projectId,
        organizationId,
      );

      expect(mockInitiativeService.linkProject).toHaveBeenCalledWith(
        initiativeId,
        projectId,
        organizationId,
        undefined,
      );

      expect(result).toEqual({
        success: true,
        message: 'Project linked to initiative successfully',
        data: mockLinkResult,
        initiativeId,
        projectId,
      });
    });
  });

  describe('unlinkProject', () => {
    const projectId = 'project-123' as ProjectId;

    it('should unlink a project from initiative successfully', async () => {
      const mockUnlinkResult = { count: 1 };

      mockInitiativeService.unlinkProject.mockResolvedValue(mockUnlinkResult);

      const result = await controller.unlinkProject(
        initiativeId,
        projectId,
        organizationId,
      );

      expect(mockInitiativeService.unlinkProject).toHaveBeenCalledWith(
        initiativeId,
        projectId,
        organizationId,
      );

      expect(result).toEqual({
        success: true,
        message: 'Project unlinked from initiative successfully',
        data: { deletedCount: 1 },
        initiativeId,
        projectId,
      });
    });
  });

  describe('getLinkedProjects', () => {
    it('should get all linked projects successfully', async () => {
      const mockProjectLinks = [
        {
          id: 'link-1',
          projectId: 'project-1',
          initiativeId,
          role: 'primary',
          project: {
            id: 'project-1',
            name: 'Project 1',
            organizationId,
          },
        },
        {
          id: 'link-2',
          projectId: 'project-2',
          initiativeId,
          role: 'supporting',
          project: {
            id: 'project-2',
            name: 'Project 2',
            organizationId,
          },
        },
      ];

      mockInitiativeService.getLinkedProjects.mockResolvedValue(
        mockProjectLinks,
      );

      const result = await controller.getLinkedProjects(
        initiativeId,
        organizationId,
      );

      expect(mockInitiativeService.getLinkedProjects).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );

      expect(result).toEqual({
        success: true,
        data: mockProjectLinks,
        initiativeId,
        count: 2,
      });
    });

    it('should handle empty linked projects list', async () => {
      const mockProjectLinks: ProjectResponseDto[] = [];

      mockInitiativeService.getLinkedProjects.mockResolvedValue(
        mockProjectLinks,
      );

      const result = await controller.getLinkedProjects(
        initiativeId,
        organizationId,
      );

      expect(result).toEqual({
        success: true,
        data: [],
        initiativeId,
        count: 0,
      });
    });
  });

  // Initiative Refinement Tests
  describe('startRefinement', () => {
    const mockInitiative = {
      id: initiativeId,
      name: 'Test Initiative',
      description: 'Test Description',
      organizationId,
      status: WorkStatus.RefiningDescription,
      priority: Priority.High,
      tags: [] as string[],
      createdAt: '2023-01-01T00:00:00.000Z',
      updatedAt: '2023-01-01T00:00:00.000Z',
    };

    it('should start refinement workflow when no active conversation exists', async () => {
      const body = {
        reasoning: 'Need to refine this initiative',
        projectId: testIds.project,
      };

      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        null,
      );
      mockInitiativeLifecycleService.createRefinementConversation.mockRejectedValue(
        new Error('Mock error from createRefinementConversation'),
      );

      const mockUser = TestUtils.createMockAuthenticatedUser();
      await expect(
        controller.startRefinement(
          initiativeId,
          organizationId,
          mockUser,
          body,
        ),
      ).rejects.toThrow(
        'Failed to create refinement conversation for initiative',
      );

      expect(mockInitiativeService.findByIdForAdapter).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );
      expect(
        mockInitiativeService.getActiveRefinementConversation,
      ).toHaveBeenCalledWith(initiativeId, organizationId);
    });

    it('should resume existing workflow when conversation exists and workflow is running', async () => {
      const body = { reasoning: 'Continue refinement' };
      const existingWorkflowId = 'existing-wf-123' as WorkflowId;

      const mockConversation = TestUtils.createMockConversation({
        id: conversationId,
        workflowId: existingWorkflowId,
        status: ConversationStatus.InProgress,
      });

      const mockWorkflowHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'RUNNING' },
        }),
      };

      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        conversationId,
      );
      mockConversationService.getConversation.mockResolvedValue(
        mockConversation,
      );
      mockTemporalClient.workflow.getHandle.mockReturnValue(mockWorkflowHandle);
      mockTemporalClient.workflow.start.mockResolvedValue(undefined);

      const mockUser = TestUtils.createMockAuthenticatedUser();
      const result = await controller.startRefinement(
        initiativeId,
        organizationId,
        mockUser,
        body,
      );

      expect(result).toEqual({
        conversationId: conversationId,
        workflowId: existingWorkflowId,
      });

      expect(mockTemporalClient.workflow.getHandle).toHaveBeenCalledWith(
        existingWorkflowId,
      );
      expect(mockWorkflowHandle.describe).toHaveBeenCalled();
      expect(mockTemporalClient.workflow.start).not.toHaveBeenCalled();
    });

    it('should start new workflow when existing workflow is not running', async () => {
      const body = { reasoning: 'Restart refinement', projectId };
      const existingWorkflowId = 'old-wf-123' as WorkflowId;

      const mockConversation = TestUtils.createMockConversation({
        id: conversationId,
        workflowId: existingWorkflowId,
        status: ConversationStatus.Completed,
      });

      const mockWorkflowHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'COMPLETED' },
        }),
      };

      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        conversationId,
      );
      mockConversationService.getConversation.mockResolvedValue(
        mockConversation,
      );
      mockTemporalClient.workflow.getHandle.mockReturnValue(mockWorkflowHandle);
      mockTemporalClient.workflow.start.mockResolvedValue(undefined);

      const mockUser = TestUtils.createMockAuthenticatedUser();
      const result = await controller.startRefinement(
        initiativeId,
        organizationId,
        mockUser,
        body,
      );

      expect(result.conversationId).toBe(conversationId);
      expect(result.workflowId).toMatch(/initiative-refinement-/);
      expect(mockTemporalClient.workflow.start).toHaveBeenCalledWith(
        'conversationFlowWorkflow',
        expect.objectContaining({
          args: [
            expect.objectContaining({
              flowId: 'initiative-refinement',
              organizationId,
              conversationId,
              userId: mockUser.userId,
            }),
          ],
          taskQueue: 'conversation-queue',
        }),
      );
    });

    it('should throw NotFoundException when initiative not found', async () => {
      mockInitiativeService.findByIdForAdapter.mockResolvedValue(null);

      const mockUser = TestUtils.createMockAuthenticatedUser();
      await expect(
        controller.startRefinement(initiativeId, organizationId, mockUser, {}),
      ).rejects.toThrow(NotFoundException);

      expect(mockInitiativeService.findByIdForAdapter).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );
    });
  });

  describe('getRefinementStatus', () => {
    it('should return active refinement status when conversation exists', async () => {
      const mockConversation = TestUtils.createMockConversation({
        id: conversationId,
        workflowId: workflowId,
        status: ConversationStatus.InProgress,
      });

      const mockWorkflowHandle = {
        describe: jest.fn().mockResolvedValue({
          status: { name: 'RUNNING' },
        }),
      };

      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        conversationId,
      );
      mockConversationService.getConversation.mockResolvedValue(
        mockConversation,
      );
      mockTemporalClient.workflow.getHandle.mockReturnValue(mockWorkflowHandle);

      const result = await controller.getRefinementStatus(
        initiativeId,
        organizationId,
      );

      expect(result).toEqual({
        hasActiveRefinement: true,
        conversationId: conversationId,
        workflowId: workflowId,
      });
    });

    it('should return no active refinement when no conversation exists', async () => {
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        null,
      );

      const result = await controller.getRefinementStatus(
        initiativeId,
        organizationId,
      );

      expect(result).toEqual({
        hasActiveRefinement: false,
      });
    });
  });

  describe('completeRefinement', () => {
    it('should complete refinement workflow successfully', async () => {
      const mockWorkflowHandle = {
        signal: jest.fn().mockResolvedValue(undefined),
      };

      const mockInitiative = {
        id: initiativeId,
        name: 'Test Initiative',
        organizationId,
        status: WorkStatus.RefiningDescription,
        priority: Priority.High,
        tags: [] as string[],
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
      };

      mockInitiativeService.findByIdForAdapter.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.getActiveRefinementConversation.mockResolvedValue(
        conversationId,
      );
      mockInitiativeService.applyRefinementChanges.mockResolvedValue(
        mockInitiative,
      );
      mockInitiativeService.clearActiveRefinementConversation.mockResolvedValue(
        undefined,
      );
      mockTemporalClient.workflow.getHandle.mockReturnValue(mockWorkflowHandle);

      const result = await controller.completeRefinement(
        initiativeId,
        organizationId,
        {},
      );

      expect(result).toEqual(mockInitiative);

      expect(
        mockInitiativeService.clearActiveRefinementConversation,
      ).toHaveBeenCalledWith(initiativeId, organizationId);
    });

    it('should throw error when no active refinement conversation exists', async () => {
      mockInitiativeService.findByIdForAdapter.mockResolvedValue(null);

      await expect(
        controller.completeRefinement(initiativeId, organizationId, {}),
      ).rejects.toThrow(`Initiative ${initiativeId} not found`);
    });
  });
});
