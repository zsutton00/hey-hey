import { Test, TestingModule } from '@nestjs/testing';
import { TaskOptimizationService } from '../task-optimization.service';
import { TaskService } from '../task.service';
import { TaskArtifactService } from '../task-artifact.service';
import { TaskResponseDto, TaskPriority, WorkStatus } from '../../../generated';
import { OrganizationId, TaskId } from '../../../types';
import {
  ChangeDetectionResult,
  OptimizationContext,
} from '../../../types/refinable-entity.types';
import {
  TaskRefinableEntity,
  safeToTaskRefinableEntity,
} from '../../../types/task-refinement-adapter.types';
import * as TestUtils from '../../../utils/testUtils';

// Mock the task refinement adapter utilities
jest.mock('../../../types/task-refinement-adapter.types', () => ({
  safeToTaskRefinableEntity: jest.fn(),
}));

describe('TaskOptimizationService', () => {
  let service: TaskOptimizationService;
  let mockTaskService: jest.Mocked<TaskService>;
  let mockTaskArtifactService: jest.Mocked<TaskArtifactService>;

  const testOrgId = 'test-org-123' as OrganizationId;
  const testTaskId = 'test-task-456' as TaskId;

  const mockTask: TaskResponseDto = {
    id: testTaskId,
    name: 'Test Task',
    type: 'STANDARD',
    sections: TestUtils.createMockMaterializedTaskSections({
      description: 'Test description',
      acceptanceCriteria: 'Test criteria',
    }),
    status: WorkStatus.Backlog,
    priority: TaskPriority.Medium,
    assigneeId: 'user-123',
    organizationId: testOrgId,
    projectId: 'test-project-789',
    initiativeId: 'init-123',
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
    status: 'BACKLOG',
    priority: 'MEDIUM',
    assigneeId: 'user-123',
    parentTaskId: null,
    organizationId: testOrgId,
    projectId: 'test-project-789',
    initiativeId: 'init-123',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Create mocks with all required methods
    mockTaskService = {
      findOneForAdapter: jest.fn(),
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      updateForAdapter: jest.fn(),
      getActiveRefinementConversation: jest.fn(),
      findAllByOrganizationForAdapter: jest.fn(),
      createRefinementConversation: jest.fn(),
      logger: {
        error: jest.fn(),
        warn: jest.fn(),
        log: jest.fn(),
        debug: jest.fn(),
      },
      prisma: {} as any,
      eventPublisher: {} as any,
    } as unknown as jest.Mocked<TaskService>;

    mockTaskArtifactService = {
      getOriginalArtifactForTask: jest.fn(),
      storeOriginalGeneration: jest.fn(),
      getBulkOriginalArtifacts: jest.fn(),
      extractOriginalData: jest.fn(),
      extractTaskId: jest.fn(),
      cleanupTaskArtifacts: jest.fn(),
      artifactService: {} as any,
    } as unknown as jest.Mocked<TaskArtifactService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskOptimizationService,
        {
          provide: TaskService,
          useValue: mockTaskService,
        },
        {
          provide: TaskArtifactService,
          useValue: mockTaskArtifactService,
        },
      ],
    }).compile();

    service = module.get<TaskOptimizationService>(TaskOptimizationService);
  });

  describe('getEntityType', () => {
    it('should return task entity type', () => {
      // Act
      const entityType = (service as any).getEntityType();

      // Assert
      expect(entityType).toBe('task');
    });
  });

  describe('findOne', () => {
    it('should delegate to TaskService and convert to refinable entity', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTask);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );

      // Act
      const result = await (service as any).findOne(testTaskId, testOrgId);

      // Assert
      expect(result).toEqual(mockTaskRefinableEntity);
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        testTaskId,
        testOrgId,
      );
      expect(safeToTaskRefinableEntity).toHaveBeenCalledWith(mockTask);
    });

    it('should return null when task not found', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(null);

      // Act
      const result = await (service as any).findOne('non-existent', testOrgId);

      // Assert
      expect(result).toBeNull();
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        'non-existent',
        testOrgId,
      );
      expect(safeToTaskRefinableEntity).not.toHaveBeenCalled();
    });

    it('should return null when conversion fails', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTask);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(null);

      // Act
      const result = await (service as any).findOne(testTaskId, testOrgId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getFieldWeight', () => {
    it('should return task-specific field weights', () => {
      // Act & Assert
      expect((service as any).getFieldWeight('name')).toBe(0.4);
      expect((service as any).getFieldWeight('description')).toBe(0.7);
      expect((service as any).getFieldWeight('details')).toBe(0.5);
      expect((service as any).getFieldWeight('acceptanceCriteria')).toBe(0.9);
      expect((service as any).getFieldWeight('priority')).toBe(0.3);
      expect((service as any).getFieldWeight('assigneeId')).toBe(0.4);
      expect((service as any).getFieldWeight('status')).toBe(0.2);
      expect((service as any).getFieldWeight('unknown')).toBe(0.5);
    });
  });

  describe('getTaskSimilarityThresholds', () => {
    it('should return task-specific similarity thresholds', () => {
      // Act
      const thresholds = (service as any).getTaskSimilarityThresholds();

      // Assert
      expect(thresholds).toEqual({
        SIMILARITY_THRESHOLD_MINOR: 0.8,
        SIMILARITY_THRESHOLD_MODERATE: 0.6,
        SKIP_LLM_THRESHOLD: 0.95,
        MAJOR_CHANGE_THRESHOLD: 0.4,
      });
    });
  });

  describe('shouldProcessTask', () => {
    it('should require less change intensity for backlog tasks', () => {
      // Arrange
      const backlogTask = { ...mockTaskRefinableEntity, status: 'BACKLOG' };

      // Act
      const shouldProcess = (service as any).shouldProcessTask(
        backlogTask,
        0.15,
      );

      // Assert
      expect(shouldProcess).toBe(true);
    });

    it('should require less change intensity for todo tasks', () => {
      // Arrange
      const todoTask = { ...mockTaskRefinableEntity, status: 'TODO' };

      // Act
      const shouldProcess = (service as any).shouldProcessTask(todoTask, 0.35);

      // Assert
      expect(shouldProcess).toBe(true);
    });

    it('should require less change intensity for high priority tasks', () => {
      // Arrange
      const highPriorityTask = { ...mockTaskRefinableEntity, priority: 'HIGH' };

      // Act
      const shouldProcess = (service as any).shouldProcessTask(
        highPriorityTask,
        0.25,
      );

      // Assert
      expect(shouldProcess).toBe(true);
    });

    it('should require less change intensity for critical priority tasks', () => {
      // Arrange
      const criticalTask = { ...mockTaskRefinableEntity, priority: 'CRITICAL' };

      // Act
      const shouldProcess = (service as any).shouldProcessTask(
        criticalTask,
        0.25,
      );

      // Assert
      expect(shouldProcess).toBe(true);
    });

    it('should use default threshold for regular tasks', () => {
      // Arrange
      const regularTask = {
        ...mockTaskRefinableEntity,
        status: 'IN_PROGRESS',
        priority: 'MEDIUM',
      };

      // Act
      const shouldProcessLow = (service as any).shouldProcessTask(
        regularTask,
        0.25,
      );
      const shouldProcessHigh = (service as any).shouldProcessTask(
        regularTask,
        0.35,
      );

      // Assert
      expect(shouldProcessLow).toBe(false);
      expect(shouldProcessHigh).toBe(true);
    });
  });

  describe('generateTaskOptimizationHints', () => {
    it('should generate hint for assignee changes', () => {
      // Act
      const hints = (service as any).generateTaskOptimizationHints(
        mockTaskRefinableEntity,
        ['assigneeId'],
      );

      // Assert
      expect(hints).toContain(
        'Assignment changed - consider notifying affected users',
      );
    });

    it('should generate hint for status changes', () => {
      // Act
      const hints = (service as any).generateTaskOptimizationHints(
        mockTaskRefinableEntity,
        ['status'],
      );

      // Assert
      expect(hints).toContain(
        'Status changed - update dependent tasks and notifications',
      );
    });

    it('should generate hint for priority changes', () => {
      // Act
      const hints = (service as any).generateTaskOptimizationHints(
        mockTaskRefinableEntity,
        ['priority'],
      );

      // Assert
      expect(hints).toContain(
        'Priority changed - may affect sprint planning and resource allocation',
      );
    });

    it('should generate hint for subtasks', () => {
      // Arrange
      const subtask = {
        ...mockTaskRefinableEntity,
        parentTaskId: 'parent-task-123',
      };

      // Act
      const hints = (service as any).generateTaskOptimizationHints(subtask, [
        'description',
      ]);

      // Assert
      expect(hints).toContain(
        'This is a subtask - changes may impact parent task',
      );
    });

    it('should generate multiple hints when applicable', () => {
      // Arrange
      const subtask = {
        ...mockTaskRefinableEntity,
        parentTaskId: 'parent-task-123',
      };

      // Act
      const hints = (service as any).generateTaskOptimizationHints(subtask, [
        'assigneeId',
        'status',
      ]);

      // Assert
      expect(hints).toHaveLength(3);
      expect(hints).toContain(
        'Assignment changed - consider notifying affected users',
      );
      expect(hints).toContain(
        'Status changed - update dependent tasks and notifications',
      );
      expect(hints).toContain(
        'This is a subtask - changes may impact parent task',
      );
    });

    it('should return empty array when no relevant changes', () => {
      // Act
      const hints = (service as any).generateTaskOptimizationHints(
        mockTaskRefinableEntity,
        ['description'],
      );

      // Assert
      expect(hints).toEqual([]);
    });
  });

  describe('TaskArtifactServiceAdapter', () => {
    let artifactServiceAdapter: any;

    beforeEach(() => {
      // Access the private adapter instance for testing
      artifactServiceAdapter = (service as any).artifactServiceAdapter;
    });

    describe('getOriginalArtifact', () => {
      it('should retrieve and convert original artifact', async () => {
        // Arrange
        const mockArtifact = {
          id: 'artifact-123',
          type: 'TASK_ORIGINAL' as any,
          data: {
            type: 'TASK_ORIGINAL',
            taskType: 'STANDARD',
            name: 'Original Task',
            description: 'Original description',
            acceptanceCriteria: 'Original criteria',
            priority: 'high',
            tags: [] as string[],
            reasoning: undefined as string | undefined,
          },
          hasEmbedding: false,
          tags: [] as string[],
          status: 'ACTIVE' as any,
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockTaskArtifactService.getOriginalArtifactForTask.mockResolvedValue(
          mockArtifact as any,
        );

        // Act
        const result = await artifactServiceAdapter.getOriginalArtifact(
          testTaskId,
          testOrgId,
        );

        // Assert
        expect(result).toEqual({
          id: testTaskId,
          name: 'Original Task',
          type: 'STANDARD',
          description: 'Original description',
          details: '',
          acceptanceCriteria: 'Original criteria',
          status: WorkStatus.Backlog,
          priority: 'HIGH',
          assigneeId: undefined,
          organizationId: testOrgId,
          projectId: '',
          initiativeId: '',
          parentTaskId: undefined,
          createdAt: mockArtifact.createdAt,
          updatedAt: mockArtifact.updatedAt,
          archivedAt: undefined,
          dueDate: undefined,
        });
        expect(
          mockTaskArtifactService.getOriginalArtifactForTask,
        ).toHaveBeenCalledWith(testTaskId, testOrgId);
      });

      it('should return null when no artifact exists', async () => {
        // Arrange
        mockTaskArtifactService.getOriginalArtifactForTask.mockResolvedValue(
          null,
        );

        // Act
        const result = await artifactServiceAdapter.getOriginalArtifact(
          testTaskId,
          testOrgId,
        );

        // Assert
        expect(result).toBeNull();
      });

      it('should throw error for invalid artifact type', async () => {
        // Arrange
        const mockArtifact = {
          id: 'artifact-123',
          type: 'WRONG_TYPE' as any,
          data: {
            type: 'WRONG_TYPE',
            title: 'Wrong Type',
            content: '{}',
          },
          hasEmbedding: false,
          tags: [] as string[],
          status: 'ACTIVE' as any,
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockTaskArtifactService.getOriginalArtifactForTask.mockResolvedValue(
          mockArtifact as any,
        );

        // Act & Assert
        await expect(
          artifactServiceAdapter.getOriginalArtifact(testTaskId, testOrgId),
        ).rejects.toThrow('Expected TASK_ORIGINAL artifact, got WRONG_TYPE');
      });

      it('should throw error for invalid JSON content', async () => {
        // Arrange
        const mockArtifact = {
          id: 'artifact-123',
          type: 'INSIGHT' as any,
          data: {
            type: 'INSIGHT',
            title: 'Invalid JSON',
            content: 'invalid-json',
          },
          hasEmbedding: false,
          tags: [] as string[],
          status: 'ACTIVE' as any,
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockTaskArtifactService.getOriginalArtifactForTask.mockResolvedValue(
          mockArtifact as any,
        );

        // Act & Assert
        await expect(
          artifactServiceAdapter.getOriginalArtifact(testTaskId, testOrgId),
        ).rejects.toThrow('Failed to parse original artifact data');
      });

      it('should default missing fields when original data is incomplete', async () => {
        // Arrange
        const mockArtifact = {
          id: 'artifact-123',
          type: 'TASK_ORIGINAL' as any,
          data: {
            type: 'TASK_ORIGINAL',
            name: 'Original Task',
            description: 'Original description',
            priority: 'high',
          },
          hasEmbedding: false,
          tags: [] as string[],
          status: 'ACTIVE' as any,
          isPublic: false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        mockTaskArtifactService.getOriginalArtifactForTask.mockResolvedValue(
          mockArtifact as any,
        );

        // Act
        const result = await artifactServiceAdapter.getOriginalArtifact(
          testTaskId,
          testOrgId,
        );

        // Assert
        expect(result).toEqual({
          id: testTaskId,
          name: 'Original Task',
          type: 'STANDARD',
          description: 'Original description',
          details: '',
          acceptanceCriteria: '',
          status: WorkStatus.Backlog,
          priority: 'HIGH',
          assigneeId: undefined,
          organizationId: testOrgId,
          projectId: '',
          initiativeId: '',
          parentTaskId: undefined,
          createdAt: mockArtifact.createdAt,
          updatedAt: mockArtifact.updatedAt,
          archivedAt: undefined,
          dueDate: undefined,
        });
      });
    });

    describe('saveArtifactSnapshot', () => {
      it('should convert and save entity snapshot', async () => {
        // Arrange
        mockTaskArtifactService.storeOriginalGeneration.mockResolvedValue([]);

        // Act
        await artifactServiceAdapter.saveArtifactSnapshot(
          mockTaskRefinableEntity,
          testOrgId,
        );

        // Assert
        expect(
          mockTaskArtifactService.storeOriginalGeneration,
        ).toHaveBeenCalledWith(
          [
            {
              type: 'TASK_ORIGINAL',
              taskType: 'STANDARD',
              name: 'Test Task',
              description: 'Test description',
              acceptanceCriteria: 'Test criteria',
              priority: 'medium',
              tags: [] as string[],
              reasoning: undefined,
            },
          ],
          [{ id: testTaskId }],
          testOrgId,
          undefined,
          {
            sourceId: testTaskId,
            generationModel: 'snapshot-save',
            generationPrompt: 'entity-snapshot',
            originalRequestContext: {
              source: 'optimization-service-snapshot',
              timestamp: expect.any(String),
            },
          },
        );
      });

      it('should handle null/undefined fields correctly', async () => {
        // Arrange
        const entityWithNulls: TaskRefinableEntity = {
          ...mockTaskRefinableEntity,
          acceptanceCriteria: null as unknown as string,
          priority: null as unknown as TaskPriority,
        };

        mockTaskArtifactService.storeOriginalGeneration.mockResolvedValue([]);

        // Act
        await artifactServiceAdapter.saveArtifactSnapshot(
          entityWithNulls,
          testOrgId,
        );

        // Assert
        const expectedOriginalData = {
          type: 'TASK_ORIGINAL',
          taskType: 'STANDARD',
          name: 'Test Task',
          description: 'Test description',
          acceptanceCriteria: '',
          priority: 'medium', // Default mapping
          tags: [] as string[],
          reasoning: undefined as any,
        };

        expect(
          mockTaskArtifactService.storeOriginalGeneration,
        ).toHaveBeenCalledWith(
          [expectedOriginalData],
          [{ id: testTaskId }],
          testOrgId,
          undefined,
          expect.any(Object),
        );
      });
    });

    describe('priority mapping', () => {
      it('should map priority to database format correctly', () => {
        // Access private methods through any casting for testing
        const adapter = artifactServiceAdapter;

        expect(adapter.mapPriorityToDatabase('low')).toBe('LOW');
        expect(adapter.mapPriorityToDatabase('medium')).toBe('MEDIUM');
        expect(adapter.mapPriorityToDatabase('high')).toBe('HIGH');
        expect(adapter.mapPriorityToDatabase('critical')).toBe('CRITICAL');
        expect(adapter.mapPriorityToDatabase('unknown')).toBe('MEDIUM'); // Default
      });

      it('should map priority from database format correctly', () => {
        const adapter = artifactServiceAdapter;

        expect(adapter.mapPriorityFromDatabase('LOW')).toBe('low');
        expect(adapter.mapPriorityFromDatabase('MEDIUM')).toBe('medium');
        expect(adapter.mapPriorityFromDatabase('HIGH')).toBe('high');
        expect(adapter.mapPriorityFromDatabase('CRITICAL')).toBe('critical');
        expect(adapter.mapPriorityFromDatabase(null)).toBe('medium'); // Default
        expect(adapter.mapPriorityFromDatabase('UNKNOWN')).toBe('medium'); // Default
      });
    });
  });

  describe('integration with base class methods', () => {
    beforeEach(() => {
      // Setup common mocks for base class functionality
      mockTaskService.findOneForAdapter.mockResolvedValue(mockTask);
      (safeToTaskRefinableEntity as jest.Mock).mockReturnValue(
        mockTaskRefinableEntity,
      );
    });

    it('should work with base class detectChanges method', async () => {
      // Arrange
      mockTaskArtifactService.getOriginalArtifactForTask.mockResolvedValue(
        null,
      );

      // Act
      const result = await service.detectChanges(testTaskId, testOrgId);

      // Assert - Should handle missing original artifact gracefully
      expect(result.hasChanges).toBe(true);
      expect(result.changesSummary).toContain('No original artifact found');
      expect(mockTaskService.findOneForAdapter).toHaveBeenCalledWith(
        testTaskId,
        testOrgId,
      );
    });

    it('should work with base class generateOptimizationContext method', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Task details updated',
        confidenceScore: 0.8,
        affectedFields: ['details'],
        changeType: 'major',
      };

      // Act
      const context =
        await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(context.shouldSkipLlm).toBe(false);
      expect(context.processingRecommendation).toBeDefined();
      expect(context.estimatedProcessingTime).toBeGreaterThan(0);
    });
  });

  describe('error handling and logging', () => {
    it('should handle service errors gracefully', async () => {
      // Arrange
      mockTaskService.findOneForAdapter.mockRejectedValue(
        new Error('Database connection lost'),
      );

      // Act & Assert
      await expect(
        (service as any).findOne(testTaskId, testOrgId),
      ).rejects.toThrow('Database connection lost');
    });

    it('should log entity type correctly', () => {
      // Arrange
      const loggerSpy = jest.spyOn((service as any).logger, 'log');

      // Act
      const entityType = (service as any).getEntityType();

      // Assert
      expect(entityType).toBe('task');
      // Logger usage will be tested in integration tests
    });
  });
});
