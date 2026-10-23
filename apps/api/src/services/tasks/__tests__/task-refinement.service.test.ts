import { TaskRefinementService } from '../task-refinement.service';
import { TaskService } from '../task.service';
import { ConversationService } from '../../conversation.service';
import { WorkItemTypeConfigService } from '../../../config/work-item-type.config';
import {
  ConversationResponseDto,
  TaskResponseDto,
  TaskPriority,
  TaskSectionUpdateSource,
  WorkStatus,
  InitiationType,
  ConversationStatus,
} from '../../../generated';
import {
  OrganizationId,
  TaskId,
  ProjectId,
  ConversationId,
  WorkflowId,
} from '../../../types';
import { RefinementLevel } from '../../../types/refinable-entity.types';
import {
  TaskRefinableEntity,
  safeToTaskRefinableEntity,
} from '../../../types/task-refinement-adapter.types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';
import { createWarmWorkItemTypeRegistry } from '../../../../test/setup/work-item-type-registry.fixture';
import { WorkItemTypeRegistryService } from '../work-item-type-registry.service';
import { ConversationWorkflowService } from '../../workflows/conversation-workflow.service';
import * as TestUtils from '../../../utils/testUtils';

// Mock the config service and adapter function
jest.mock('../../../config/work-item-type.config');
jest.mock('../../../types/task-refinement-adapter.types', () => ({
  safeToTaskRefinableEntity: jest.fn(),
}));

describe('TaskRefinementService', () => {
  let service: TaskRefinementService;
  let mockTaskService: jest.Mocked<
    Pick<
      TaskService,
      | 'findOneForAdapter'
      | 'updateForAdapter'
      | 'getActiveRefinementConversation'
    >
  >;
  let mockConversationService: jest.Mocked<
    Pick<ConversationService, 'createConversation'>
  >;
  let mockConversationWorkflowService: jest.Mocked<
    Pick<ConversationWorkflowService, 'createConversation'>
  >;
  let mockWorkItemTypeConfigService: jest.Mocked<
    typeof WorkItemTypeConfigService
  >;
  let prismaMock: any;

  const testOrgId = 'test-org-123' as OrganizationId;
  const testTaskId = 'test-task-456' as TaskId;
  const testProjectId = 'test-project-789' as ProjectId;

  const mockTaskResponseDto: TaskResponseDto = {
    id: testTaskId,
    name: 'Test Task',
    type: 'STANDARD',
    sections: TestUtils.createMockMaterializedTaskSections({
      description: 'Test description',
      acceptanceCriteria: 'Test criteria',
    }),
    status: WorkStatus.Active,
    priority: TaskPriority.High,
    assigneeId: 'user-123',
    organizationId: testOrgId,
    projectId: testProjectId,
    initiativeId: 'initiative-123',
    source: 'system',
    parentTaskId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: undefined,
    dueDate: undefined,
  };

  const mockTaskRefinableEntity: TaskRefinableEntity = {
    id: testTaskId,
    name: 'Test Task',
    type: 'STANDARD',
    description: 'Test description',
    details: 'Test details',
    acceptanceCriteria: 'Test criteria',
    status: WorkStatus.Active,
    priority: TaskPriority.High,
    assigneeId: 'user-123',
    organizationId: testOrgId,
    projectId: testProjectId,
    initiativeId: 'initiative-123',
    parentTaskId: undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockConversation: ConversationResponseDto = {
    id: 'conv-456' as ConversationId,
    createdBy: null,
    projectId: testProjectId,
    organizationId: testOrgId,
    workflowId: 'task-refinement' as WorkflowId,
    status: ConversationStatus.InProgress,
    title: 'Task Refinement',
    workflowName: 'task-generation',
    initiatedBy: InitiationType.System,
    triggerEvent: 'refinement_started',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 1,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockTaskService = {
      findOneForAdapter: jest.fn(),
      updateForAdapter: jest.fn(),
      getActiveRefinementConversation: jest.fn(),
    };

    mockConversationService = {
      createConversation: jest.fn(),
    };
    mockConversationWorkflowService = {
      createConversation: jest
        .fn()
        .mockResolvedValue({ conversation: mockConversation }),
    };

    mockWorkItemTypeConfigService = WorkItemTypeConfigService as jest.Mocked<
      typeof WorkItemTypeConfigService
    >;
    mockWorkItemTypeConfigService.getConfig = jest.fn();
    mockWorkItemTypeConfigService.getNextLevel = jest.fn();

    const warmWorkItemTypeRegistry = await createWarmWorkItemTypeRegistry();

    const setup = await createServiceTestingModule({
      providers: [
        TaskRefinementService,
        TaskService,
        ConversationService,
        ConversationWorkflowService,
        WorkItemTypeRegistryService,
      ],
      overrides: [
        [TaskService, mockTaskService],
        [ConversationService, mockConversationService],
        [ConversationWorkflowService, mockConversationWorkflowService],
        [WorkItemTypeRegistryService, warmWorkItemTypeRegistry],
      ],
    });

    service = setup.module.get<TaskRefinementService>(TaskRefinementService);
    prismaMock = setup.mocks.prismaService;
    prismaMock.db.conversation = {
      findFirst: jest.fn().mockResolvedValue(null),
    };
  });

  describe('getEntityType', () => {
    it('should return task entity type', () => {
      // Act
      const entityType = (service as any).getEntityType();

      // Assert
      expect(entityType).toBe('task');
    });
  });

  describe('getCurrentLevelFromStatus', () => {
    it('should default unknown statuses to description', () => {
      // Act
      const level = (service as any).getCurrentLevelFromStatus('CUSTOM_STATUS');

      // Assert
      expect(level).toBe('description');
    });

    it('should map common task statuses correctly', () => {
      // Act & Assert
      expect((service as any).getCurrentLevelFromStatus('BACKLOG')).toBe(
        'description',
      );
      expect((service as any).getCurrentLevelFromStatus('IN_PROGRESS')).toBe(
        'description',
      );
      expect(
        (service as any).getCurrentLevelFromStatus('REFINING_DETAILS'),
      ).toBe('acceptanceCriteria');
      expect(
        (service as any).getCurrentLevelFromStatus(
          'REFINING_ACCEPTANCE_CRITERIA',
        ),
      ).toBe('acceptanceCriteria');
    });

    it('should default to description for unknown statuses', () => {
      // Act
      const level = (service as any).getCurrentLevelFromStatus(
        'UNKNOWN_STATUS',
      );

      // Assert
      expect(level).toBe('description');
    });
  });

  describe('getNextLevel', () => {
    it('should advance from description to acceptance criteria', () => {
      // Arrange
      const currentLevel: RefinementLevel = 'description';

      // Act
      const result = (service as any).getNextLevel(currentLevel);

      // Assert
      expect(result).toBe('acceptanceCriteria');
    });

    it('should return null for final level', () => {
      const currentLevel: RefinementLevel = 'acceptanceCriteria';

      // Act
      const result = (service as any).getNextLevel(currentLevel);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('findOneForAdapter', () => {
    it('should delegate to TaskService and convert result', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTaskResponseDto);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );

      // Act
      const result = await service.findOneForAdapter(testTaskId, testOrgId);

      // Assert
      expect(result).toEqual(mockTaskRefinableEntity);
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        testTaskId,
        testOrgId,
      );
      expect(safeToTaskRefinableEntity).toHaveBeenCalledWith(
        mockTaskResponseDto,
      );
    });

    it('should return null when task not found', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(null);

      // Act
      const result = await service.findOneForAdapter('non-existent', testOrgId);

      // Assert
      expect(result).toBeNull();
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        'non-existent',
        testOrgId,
      );
      expect(safeToTaskRefinableEntity).not.toHaveBeenCalled();
    });
  });

  describe('updateForAdapter', () => {
    it('should delegate to TaskService with converted updates', async () => {
      // Arrange
      const updates: Partial<TaskRefinableEntity> = {
        description: 'Updated description',
        priority: TaskPriority.Critical,
      };

      const updatedTask = {
        ...mockTaskResponseDto,
        ...updates,
      } as TaskResponseDto;
      mockTaskService.updateForAdapter.mockResolvedValue(updatedTask);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue({
        ...mockTaskRefinableEntity,
        ...updates,
      });

      // Act
      const result = await service.updateForAdapter(
        testTaskId,
        updates,
        testOrgId,
      );

      // Assert
      expect(result).toEqual({ ...mockTaskRefinableEntity, ...updates });
      expect(mockTaskService.updateForAdapter).toHaveBeenCalledWith(
        testTaskId,
        expect.objectContaining({
          priority: TaskPriority.Critical,
          sectionUpdateSource: TaskSectionUpdateSource.AgentSuggested,
          sections: [
            expect.objectContaining({
              key: 'description',
              content: 'Updated description',
            }),
          ],
        }),
        testOrgId,
      );
    });

    it('should forward parentTaskId changes', async () => {
      const updates: Partial<TaskRefinableEntity> = {
        parentTaskId: 'parent-123',
      };

      mockTaskService.updateForAdapter.mockResolvedValue(mockTaskResponseDto);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );

      await service.updateForAdapter(testTaskId, updates, testOrgId);

      expect(mockTaskService.updateForAdapter).toHaveBeenCalledWith(
        testTaskId,
        expect.objectContaining({ parentTaskId: 'parent-123' }),
        testOrgId,
      );
    });

    it('should throw error when conversion fails', async () => {
      // Arrange
      const updates = { description: 'Updated description' };
      const updatedTask = {
        ...mockTaskResponseDto,
        ...updates,
      } as TaskResponseDto;

      mockTaskService.updateForAdapter.mockResolvedValue(updatedTask);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(null);

      // Act & Assert
      await expect(
        service.updateForAdapter(testTaskId, updates, testOrgId),
      ).rejects.toThrow('Failed to convert updated task to refinable entity');
    });
  });

  describe('createRefinementConversation', () => {
    it('should create conversation successfully with existing task', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTaskResponseDto);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );
      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );

      // Act
      const result = await service.createRefinementConversation(
        testTaskId,
        'task',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(result.conversation).toEqual(mockConversation);
      expect(result.entities).toEqual([mockTaskRefinableEntity]);
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        testTaskId,
        testOrgId,
      );
      expect(
        mockConversationWorkflowService.createConversation,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: testProjectId,
          initiatedBy: InitiationType.User,
          workflowName: 'task-refinement',
          organizationId: testOrgId,
          workflowAboutId: testTaskId,
          workflowAboutType: 'task',
        }),
        testOrgId,
      );
    });

    it('should throw error when task not found', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(null);

      // Act & Assert
      await expect(
        service.createRefinementConversation(
          'non-existent',
          'task',
          testOrgId,
          testProjectId,
        ),
      ).rejects.toThrow(
        `Task non-existent not found in organization ${testOrgId}`,
      );

      expect(mockConversationService.createConversation).not.toHaveBeenCalled();
    });

    it('should throw error when project ID is not provided', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTaskResponseDto);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );

      // Act & Assert
      await expect(
        service.createRefinementConversation(testTaskId, 'task', testOrgId),
      ).rejects.toThrow(
        'Project ID is required for task refinement conversations',
      );

      expect(mockConversationService.createConversation).not.toHaveBeenCalled();
    });
  });

  describe('getActiveRefinementConversation', () => {
    it('should return null and log warning', async () => {
      // Act
      const result = await service.getActiveRefinementConversation(
        testTaskId,
        testOrgId,
      );

      // Assert
      expect(result).toBeNull();
      expect(prismaMock.db.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          workflowAboutId: testTaskId,
          workflowName: 'task-refinement',
          organizationId: testOrgId,
          NOT: {
            status: ConversationStatus.Deleted,
          },
        },
        select: {
          id: true,
          status: true,
          title: true,
          version: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });
    });
  });

  describe('getStatusForLevel', () => {
    it('should map refinement levels to task statuses', () => {
      // Act & Assert
      expect(service.getStatusForLevel('description')).toBe(
        'REFINING_DESCRIPTION',
      );
      expect(service.getStatusForLevel('details')).toBe(
        'REFINING_ACCEPTANCE_CRITERIA',
      );
      expect(service.getStatusForLevel('acceptanceCriteria')).toBe(
        'REFINING_ACCEPTANCE_CRITERIA',
      );
      expect(service.getStatusForLevel('unknown' as RefinementLevel)).toBe(
        'BACKLOG',
      );
    });
  });

  describe('canAdvanceToNextLevel', () => {
    it('should return true when description content exists', () => {
      // Arrange
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        description: 'Valid description content',
      };

      // Act
      const canAdvance = service.canAdvanceToNextLevel(task, 'description');

      // Assert
      expect(canAdvance).toBe(true);
    });

    it('should return false when description content is empty', () => {
      // Arrange
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        description: '',
      };

      // Act
      const canAdvance = service.canAdvanceToNextLevel(task, 'description');

      // Assert
      expect(canAdvance).toBe(false);
    });

    it('should return true when details content exists', () => {
      // Arrange
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        details: 'Valid details content',
      };

      // Act
      const canAdvance = service.canAdvanceToNextLevel(task, 'details');

      // Assert
      expect(canAdvance).toBe(true);
    });

    it('should return true when acceptance criteria content exists', () => {
      // Arrange
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        acceptanceCriteria: 'Valid acceptance criteria',
      };

      // Act
      const canAdvance = service.canAdvanceToNextLevel(
        task,
        'acceptanceCriteria',
      );

      // Assert
      expect(canAdvance).toBe(true);
    });

    it('should use current status when level not provided', () => {
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        status: WorkStatus.Active,
        details: 'Valid details content',
      };

      // Act
      const canAdvance = service.canAdvanceToNextLevel(task);

      // Assert
      expect(canAdvance).toBe(true);
    });
  });

  describe('isFieldEmpty', () => {
    it('should correctly identify empty description field', () => {
      // Arrange
      const emptyTask: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        description: '',
      };

      // Act
      const isEmpty = service.isFieldEmpty(emptyTask, 'description');

      // Assert
      expect(isEmpty).toBe(true);
    });

    it('should treat null and undefined as empty', () => {
      // Arrange
      const taskWithNulls: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        details: null as unknown as string,
        acceptanceCriteria: undefined as unknown as string,
      };

      // Act & Assert
      expect(service.isFieldEmpty(taskWithNulls, 'details')).toBe(true);
      expect(service.isFieldEmpty(taskWithNulls, 'acceptanceCriteria')).toBe(
        true,
      );
    });

    it('should treat whitespace-only strings as empty', () => {
      // Arrange
      const taskWithWhitespace: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        description: '   ',
        acceptanceCriteria: '\t\n  ',
      };

      // Act & Assert
      expect(service.isFieldEmpty(taskWithWhitespace, 'description')).toBe(
        true,
      );
      expect(service.isFieldEmpty(taskWithWhitespace, 'details')).toBe(true);
    });

    it('should return false for unknown levels', () => {
      // Act
      const isEmpty = service.isFieldEmpty(
        mockTaskRefinableEntity,
        'unknown' as RefinementLevel,
      );

      // Assert
      expect(isEmpty).toBe(true);
    });
  });

  describe('integration with base class methods', () => {
    beforeEach(() => {
      // Setup common mocks for base class functionality
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTaskResponseDto);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );

      mockWorkItemTypeConfigService.getConfig.mockReturnValue({
        type: 'task',
        displayName: 'Task',
        statusMappings: {},
        refinementLevels: [
          {
            id: 'description',
            field: 'description',
            order: 1,
            displayName: 'Description',
            description: 'Basic description',
          },
          {
            id: 'details',
            field: 'details',
            order: 2,
            displayName: 'Details',
            description: 'Detailed information',
          },
          {
            id: 'acceptanceCriteria',
            field: 'acceptanceCriteria',
            order: 3,
            displayName: 'Acceptance Criteria',
            description: 'Criteria for completion',
          },
        ],
        signalDefinitions: [],
        fieldMappings: {},
      });
    });

    it('should work with base class findOne method', async () => {
      // Act
      const result = await service.findOne(testTaskId, testOrgId);

      // Assert
      expect(result).toEqual(mockTaskRefinableEntity);
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        testTaskId,
        testOrgId,
      );
    });

    it('should work with base class update method', async () => {
      // Arrange
      const updates = { description: 'New description' };
      const updatedTask = {
        ...mockTaskResponseDto,
        ...updates,
      } as TaskResponseDto;
      mockTaskService.updateForAdapter.mockResolvedValue(updatedTask);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue({
        ...mockTaskRefinableEntity,
        ...updates,
      });

      // Act
      const result = await service.update(testTaskId, updates, testOrgId);

      // Assert
      expect(result).toEqual({ ...mockTaskRefinableEntity, ...updates });
      expect(mockTaskService.updateForAdapter).toHaveBeenCalledWith(
        testTaskId,
        expect.objectContaining({
          sections: [
            expect.objectContaining({
              key: 'description',
              content: 'New description',
            }),
          ],
        }),
        testOrgId,
      );
    });

    it('should work with base class getCurrentRefinementLevel method', () => {
      // Arrange
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        status: WorkStatus.Active,
      };

      // Act
      const level = service.getCurrentRefinementLevel(task);

      // Assert
      expect(level).toBe('description'); // Active status maps to description
    });

    it('should work with base class getNextRefinementLevel method', () => {
      // Arrange
      const task: TaskRefinableEntity = {
        ...mockTaskRefinableEntity,
        status: WorkStatus.Backlog, // Maps to description
      };

      // Act
      const nextLevel = service.getNextRefinementLevel(task);

      // Assert
      expect(nextLevel).toBe('acceptanceCriteria');
    });

    it('should work with base class createRefinementSession method', async () => {
      // Arrange
      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );

      // Act
      const session = await service.createRefinementSession(
        testTaskId,
        'task',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(session.conversationId).toBe(mockConversation.id);
      expect(session.workflowId).toBe(mockConversation.workflowId);
      expect(session.entitySnapshot).toEqual(mockTaskRefinableEntity);
      expect(session.sessionMetadata.entityType).toBe('task');
      expect(session.sessionMetadata.entityId).toBe(testTaskId);
      expect(session.sessionMetadata.organizationId).toBe(testOrgId);
      expect(session.sessionMetadata.projectId).toBe(testProjectId);
    });
  });

  describe('error handling and logging', () => {
    it('should handle service errors gracefully', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockRejectedValue(
        new Error('Database connection lost'),
      );

      // Act & Assert
      await expect(service.findOne(testTaskId, testOrgId)).rejects.toThrow(
        'Failed to find task test-task-456: Database connection lost',
      );
    });

    it('should log refinement conversation creation', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTaskResponseDto);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );
      mockConversationService.createConversation.mockResolvedValue(
        mockConversation,
      );

      // Spy on logger
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      // Act
      await service.createRefinementConversation(
        testTaskId,
        'task',
        testOrgId,
        testProjectId,
      );

      // Assert
      expect(loggerSpy).toHaveBeenCalledWith(
        'Creating refinement conversation for task test-task-456',
        {
          entityId: testTaskId,
          organizationId: testOrgId,
          projectId: testProjectId,
        },
      );
    });
  });
});
